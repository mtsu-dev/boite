import { MESSAGE_PAGE_MAX, RpcErrorCode, type Message, type MessagePart, type ThreadSummary } from '@boite/contracts';
import MarkdownIt from 'markdown-it';
import { browserDownload, saveAttachment } from './attachment-save';
import { escapeHtml } from './chat-links';
import { RpcFailure, type Client } from './client';
import { renderMarkdown } from './markdown';
import { desktopShell } from './shell-platform';
import { fill, strings } from './strings';
import { diffText, extractInputPatches, extractToolPatches } from './thread-export-diffs';
import { turnDiffs } from './turn-files';

export interface ExportOptions {
  format: 'markdown' | 'html';
  includeTools: boolean;
  includeDiffs: boolean;
  includeThinking?: boolean;
}

interface ExportMeta {
  projectName?: string | null;
  modelName?: string | null;
}

type Tool = Extract<MessagePart, { type: 'tool' }>;
type Question = Extract<MessagePart, { type: 'question' }>;

const HISTORY_PAGE_LIMIT = 10_000;
const TOOL_READ_CONCURRENCY = 4;
const DESKTOP_EXPORT_MAX_MIB = 64; // MAX_EXPORT_BYTES in the shell's attachments.rs.
const markdownBlocks = new MarkdownIt('commonmark').disable('inline');

/** Read the current tail, then walk backwards without changing the open subscription. */
export async function loadAllThreadMessages(client: Client, threadId: string, options?: ExportOptions, signal?: AbortSignal): Promise<Message[]> {
  const flags = { compactImages: true, compactFiles: true, compactTools: true, compactToolParts: true, limit: MESSAGE_PAGE_MAX } as const;
  signal?.throwIfAborted();
  const tail = await client.call('threads.get', { threadId, ...flags });
  const pages = [tail.messages];
  const seen = new Set<string>();
  let before = tail.messagesBefore;
  while (before) {
    signal?.throwIfAborted();
    if (pages.length >= HISTORY_PAGE_LIMIT || seen.has(before)) throw new Error('Could not read the complete conversation history');
    seen.add(before);
    const page = await client.call('messages.list', { threadId, before, ...flags });
    pages.push(page.messages);
    before = page.before;
  }
  const messages = pages.reverse().flat();
  function omitted(message: Message): boolean {
    return message.parts.some(part => (part.type === 'text' || part.type === 'thinking' && options?.includeThinking) && !!part.omitted);
  }
  for (const [from, message] of messages.entries()) {
    if (!omitted(message)) continue;
    signal?.throwIfAborted();
    const { messages: [full] } = await client.call('messages.list', { threadId, ...flags, from, limit: 1, compactToolParts: false });
    if (full?.id !== message.id || omitted(full)) throw new Error(`Could not read the complete message ${message.id}`);
    messages[from] = full;
  }
  if (options?.includeTools || options?.includeDiffs) await loadDeferredTools(client, threadId, messages, signal);
  signal?.throwIfAborted();
  return messages;
}

function* deferredTools(messages: Message[]) {
  for (const [index, message] of messages.entries()) {
    let parts: MessagePart[] | undefined;
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type !== 'tool' || !part.outputDeferred && !part.inputDeferred && !part.documentsDeferred) continue;
      if (!parts) messages[index] = { ...message, parts: parts = [...message.parts] };
      yield { messageId: message.id, parts, partIndex, tool: part };
    }
  }
}

/** Pages carry previews. Fetch each deferred call independently to stay within the RPC page budget. */
async function loadDeferredTools(client: Client, threadId: string, messages: Message[], signal?: AbortSignal): Promise<void> {
  const reads = deferredTools(messages);
  let failed = false;
  async function read(): Promise<void> {
    for (const { messageId, parts, partIndex, tool } of reads) {
      if (failed) return;
      signal?.throwIfAborted();
      const ref = { threadId, messageId, toolId: tool.toolId };
      try {
        const { part } = await client.call('messages.toolPart', ref);
        parts[partIndex] = part;
      } catch (error) {
        if (!(error instanceof RpcFailure) || error.code !== RpcErrorCode.MethodNotFound || tool.inputDeferred || tool.documentsDeferred) throw error;
        signal?.throwIfAborted();
        const { output } = await client.call('messages.toolOutput', ref);
        parts[partIndex] = { ...tool, output, outputDeferred: undefined };
      }
    }
  }
  await Promise.all(Array.from({ length: TOOL_READ_CONCURRENCY }, () => read().catch(error => {
    failed = true;
    throw error;
  })));
}

type Content =
  | { kind: 'markdown' | 'attachment' | 'diff' | 'question'; text: string }
  | { kind: 'details'; title: string; text: string };

function toolContent(part: Tool, options: ExportOptions): Content[] {
  if (!options.includeTools && !options.includeDiffs) return [];
  const changes = turnDiffs([part]);
  const input = extractInputPatches(part.input, part.inputText);
  const output = extractToolPatches(part.output);
  const content: Content[] = [];
  if (options.includeTools) {
    const isEdit = changes.length > 0 || part.documents?.some(document => document.kind === 'diff');
    const details = [part.summary];
    if (!isEdit && input.rest) details.push(`Input:\n${input.rest}`);
    if (output.rest) details.push(`Output:\n${output.rest}`);
    content.push({ kind: 'details', title: `${part.name} (${part.status})`, text: details.filter(Boolean).join('\n\n') });
  }
  if (options.includeDiffs) {
    const patches = new Set([...changes.map(diffText), ...input.patches, ...output.patches]);
    for (const patch of patches) if (patch) content.push({ kind: 'diff', text: patch });
  }
  return content;
}

function questionText(part: Question): string {
  const lines = [part.text];
  if (part.options.length) lines.push('', ...part.options.map(option => `- ${option.label}${option.description ? `: ${option.description}` : ''}`));
  if (part.answer) {
    const { optionIds, text, attachments, value } = part.answer;
    const answers = optionIds.map(id => part.options.find(option => option.id === id)?.label ?? id);
    if (text) answers.push(text);
    if (value !== undefined && !answers.length) answers.push(JSON.stringify(value));
    for (const file of attachments ?? []) answers.push(`${file.name || 'Attachment'} (${file.mimeType})`);
    if (answers.length) lines.push('', `Answer: ${answers.join('\n')}`);
  }
  return lines.join('\n');
}

function contentOf(message: Message, options: ExportOptions): Content[] {
  return message.parts.flatMap((part): Content[] => {
    switch (part.type) {
      case 'text': {
        const text = part.displayText ?? part.text;
        return text ? [{ kind: 'markdown', text }] : [];
      }
      case 'file':
      case 'image':
      case 'artifact': {
        const name = part.type === 'image' ? part.alt : part.name;
        return [{ kind: 'attachment', text: `${name || 'Attachment'} (${part.mimeType})` }];
      }
      case 'tool': return toolContent(part, options);
      case 'question': return [{ kind: 'question', text: questionText(part) }];
      case 'thinking': return options.includeThinking ? [{ kind: 'details', title: 'Thinking', text: part.text }] : [];
      default: return [];
    }
  });
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function markdownLabel(value: string): string {
  return escapeHtml(singleLine(value)).replace(/[\\`*_[\]#~]/g, '\\$&');
}

function metadata(thread: ThreadSummary, meta: ExportMeta | undefined): string[] {
  const model = meta?.modelName ?? thread.model;
  return [
    ...(meta?.projectName ? [`Project: ${meta.projectName}`] : []),
    `Model: ${model ? `${model} (${thread.providerId})` : thread.providerId}`,
    ...(thread.branch ? [`Branch: ${thread.branch}`] : []),
    `Exported: ${new Date().toISOString()}`,
  ];
}

function speaker(message: Message): string {
  return message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
}

function closeFence(text: string): string {
  if (!/^ {0,3}(?:`{3,}|~{3,})/m.test(text)) return text;
  // An outdented heading ends lists and quotes. Only a fence that consumes it
  // can also consume the heading of the next exported message.
  const last = markdownBlocks.parse(`${text}\n\n# Next message`, {}).at(-1);
  return last?.type === 'fence' && last.level === 0 ? `${text}${text.endsWith('\n') ? '' : '\n'}${last.markup}` : text;
}

function markdownContent(content: Content): string {
  switch (content.kind) {
    case 'markdown': return closeFence(content.text);
    case 'question': return `**Question**\n\n${content.text.split('\n').map(line => `> ${markdownLabel(line)}`).join('\n')}`;
    case 'attachment': return `- ${markdownLabel(content.text)}`;
    case 'details': return `<details>\n<summary>${escapeHtml(singleLine(content.title))}</summary>\n<pre>${escapeHtml(content.text)}</pre>\n</details>`;
    case 'diff': {
      let longest = 2;
      for (const match of content.text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
      const fence = '`'.repeat(longest + 1);
      return `${fence}diff\n${content.text}\n${fence}`;
    }
  }
}

export function exportThreadMarkdown(thread: ThreadSummary, messages: readonly Message[], options: ExportOptions, meta?: ExportMeta): string {
  const sections = [`# ${markdownLabel(thread.title) || 'Conversation'}`, metadata(thread, meta).map(markdownLabel).join(' · ')];
  for (const message of messages) {
    const content = contentOf(message, options);
    if (!content.length) continue;
    sections.push(`## ${speaker(message)} · ${new Date(message.createdAt).toISOString()}`, ...content.map(markdownContent));
  }
  return `${sections.join('\n\n')}\n`;
}

function htmlContent(content: Content): string {
  switch (content.kind) {
    case 'markdown': return renderMarkdown(content.text).replace(/<a href="[^#"][^"]*"[^>]*>([\s\S]*?)<\/a>/g, '$1');
    case 'question': return `<p><strong>Question</strong></p><pre class="question">${escapeHtml(content.text)}</pre>`;
    case 'attachment': return `<p class="attachment">${escapeHtml(content.text)}</p>`;
    case 'details': return `<details><summary>${escapeHtml(content.title)}</summary><pre>${escapeHtml(content.text)}</pre></details>`;
    case 'diff': return `<pre><code class="language-diff">${escapeHtml(content.text)}</code></pre>`;
  }
}

export function exportThreadHtml(thread: ThreadSummary, messages: readonly Message[], options: ExportOptions, meta?: ExportMeta): string {
  const title = escapeHtml(singleLine(thread.title) || 'Conversation');
  const sections = messages.flatMap(message => {
    const content = contentOf(message, options);
    if (!content.length) return [];
    const stamp = new Date(message.createdAt).toISOString();
    return [`<section><header><h2>${speaker(message)}</h2><time datetime="${stamp}">${stamp}</time></header>\n${content.map(htmlContent).join('\n')}\n</section>`];
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --surface: #fff; --ink: #1d1d24; --muted: #545461; --line: #dcdce4; --code: #f3f3f7; --link: #4e368c; }
  @media (prefers-color-scheme: dark) {
    :root { --surface: #17171c; --ink: #eeeef2; --muted: #b8b8c4; --line: #3a3a44; --code: #24242c; --link: #c9b7ff; }
  }
  body { margin: 0; background: var(--surface); color: var(--ink); font: 16px/1.65 system-ui, sans-serif; }
  main { max-width: 74ch; margin: auto; padding: clamp(1rem, 4vw, 3rem); overflow-wrap: anywhere; }
  h1 { font-size: clamp(1.6rem, 5vw, 2.4rem); line-height: 1.15; margin: 0; }
  .metadata, time, .attachment { color: var(--muted); font-size: .875rem; }
  section { border-top: 1px solid var(--line); margin-top: 1.5rem; padding-top: 1rem; }
  section > header { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 1rem; }
  section > header h2 { font-size: 1rem; margin: 0; }
  pre, details { background: var(--code); border: 1px solid var(--line); border-radius: .5rem; padding: .75rem; }
  details + details { margin-top: .5rem; }
  details pre { padding: 0; border: 0; margin-bottom: 0; white-space: pre-wrap; }
  .question { white-space: pre-wrap; }
  pre { overflow: auto; }
  table { display: block; overflow: auto; border-collapse: collapse; }
  th, td { border: 1px solid var(--line); padding: .3rem .6rem; }
  a { color: var(--link); }
</style>
</head>
<body><main>
<h1>${title}</h1>
<p class="metadata">${metadata(thread, meta).map(escapeHtml).join(' · ')}</p>
${sections.join('\n')}
</main></body>
</html>\n`;
}

export function exportFilename(title: string, format: ExportOptions['format'], now = new Date()): string {
  const slug = Array.from(title.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')).slice(0, 60).join('').replace(/-$/, '');
  return `${slug || 'conversation'}-${now.toISOString().slice(0, 10)}.${format === 'markdown' ? 'md' : 'html'}`;
}

export async function downloadExport(filename: string, content: string, mimeType: string): Promise<void> {
  if (desktopShell()) {
    const bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > DESKTOP_EXPORT_MAX_MIB * 1024 * 1024) {
      throw new Error(fill(strings.threadExport.desktopTooLarge, { limit: String(DESKTOP_EXPORT_MAX_MIB) }));
    }
    await saveAttachment(filename, bytes, false, { export: true });
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const revoke = URL.revokeObjectURL.bind(URL);
  try {
    browserDownload(url, filename);
  } finally {
    window.setTimeout(() => revoke(url), 1000);
  }
}
