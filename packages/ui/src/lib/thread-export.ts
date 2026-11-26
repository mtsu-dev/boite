import { MESSAGE_PAGE_MAX, RpcErrorCode, lightPageFlags, type CoreInfo, type Message, type MessagePart, type ThreadSummary } from '@boite/contracts';
import MarkdownIt from 'markdown-it';
import { browserDownload, saveAttachment } from './attachment-save';
import { escapeHtml } from './chat-links';
import { RpcFailure, type Client } from './client';
import { activeLocale } from './i18n.svelte';
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

export interface ExportProgress {
  phase: 'pages' | 'messages' | 'tools';
  done: number;
  total?: number;
}

export interface DownloadResult {
  /** Absolute path written into Downloads on desktop, undefined in browser/share flows. */
  path?: string;
  /** True when the user dismissed the mobile share sheet without saving. */
  cancelled?: boolean;
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
export async function loadAllThreadMessages(
  client: Client,
  threadId: string,
  options?: ExportOptions,
  signal?: AbortSignal,
  features?: CoreInfo['features'],
  onProgress?: (progress: ExportProgress) => void,
): Promise<Message[]> {
  const pageFlags = features
    ? lightPageFlags(features)
    : ({ compactImages: true, compactFiles: true, compactTools: true, compactToolParts: true } as const);
  const flags = { ...pageFlags, limit: MESSAGE_PAGE_MAX } as const;
  signal?.throwIfAborted();
  const tail = await client.call('threads.get', { threadId, ...flags });
  const pages = [tail.messages];
  onProgress?.({ phase: 'pages', done: pages.length });
  const seen = new Set<string>();
  let before = tail.messagesBefore;
  while (before) {
    signal?.throwIfAborted();
    if (pages.length >= HISTORY_PAGE_LIMIT || seen.has(before)) throw new Error(strings.threadExport.incompleteHistory);
    seen.add(before);
    const page = await client.call('messages.list', { threadId, before, ...flags });
    pages.push(page.messages);
    onProgress?.({ phase: 'pages', done: pages.length });
    before = page.before;
  }
  const messages = pages.reverse().flat();
  function omitted(message: Message): boolean {
    return message.parts.some(part => (part.type === 'text' || part.type === 'thinking' && options?.includeThinking) && !!part.omitted);
  }
  for (const [from, message] of messages.entries()) {
    if (!omitted(message)) continue;
    signal?.throwIfAborted();
    onProgress?.({ phase: 'messages', done: from + 1, total: messages.length });
    // Keep heavy tool parts deferred while asking for complete prose so a message with
    // large tool inputs/documents does not exceed RPC_MAX_FRAME_BYTES.
    let { messages: [full] } = await client.call('messages.list', { threadId, ...flags, from, limit: 1, fullText: true });
    if (full?.id === message.id && omitted(full)) {
      // Older cores ignore `fullText`; fall back to disabling `compactToolParts` for this single message.
      ({ messages: [full] } = await client.call('messages.list', { threadId, ...flags, from, limit: 1, compactToolParts: false }));
    }
    if (full?.id !== message.id || omitted(full)) {
      throw new Error(fill(strings.threadExport.incompleteMessage, { id: message.id }));
    }
    messages[from] = full;
  }
  if (options?.includeTools || options?.includeDiffs) await loadDeferredTools(client, threadId, messages, signal, onProgress);
  signal?.throwIfAborted();
  return messages;
}

function deferredTools(messages: Message[]) {
  const list: { messageId: string; parts: MessagePart[]; partIndex: number; tool: Tool }[] = [];
  for (const [index, message] of messages.entries()) {
    let parts: MessagePart[] | undefined;
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type !== 'tool' || !part.outputDeferred && !part.inputDeferred && !part.documentsDeferred) continue;
      if (!parts) messages[index] = { ...message, parts: parts = [...message.parts] };
      list.push({ messageId: message.id, parts, partIndex, tool: part });
    }
  }
  return list;
}

/** Pages carry previews. Fetch each deferred call independently to stay within the RPC page budget. */
async function loadDeferredTools(
  client: Client,
  threadId: string,
  messages: Message[],
  signal?: AbortSignal,
  onProgress?: (progress: ExportProgress) => void,
): Promise<void> {
  const list = deferredTools(messages);
  const total = list.length;
  if (total === 0) return;
  let cursor = 0;
  let done = 0;
  let failed = false;
  onProgress?.({ phase: 'tools', done: 0, total });
  async function read(): Promise<void> {
    while (cursor < total) {
      if (failed) return;
      const entry = list[cursor++]!;
      signal?.throwIfAborted();
      const ref = { threadId, messageId: entry.messageId, toolId: entry.tool.toolId };
      try {
        const { part } = await client.call('messages.toolPart', ref);
        entry.parts[entry.partIndex] = part;
      } catch (error) {
        if (!(error instanceof RpcFailure) || error.code !== RpcErrorCode.MethodNotFound || entry.tool.inputDeferred || entry.tool.documentsDeferred) throw error;
        signal?.throwIfAborted();
        const { output } = await client.call('messages.toolOutput', ref);
        entry.parts[entry.partIndex] = { ...entry.tool, output, outputDeferred: undefined };
      }
      done += 1;
      onProgress?.({ phase: 'tools', done, total });
    }
  }
  await Promise.all(Array.from({ length: Math.min(TOOL_READ_CONCURRENCY, total) }, () => read().catch(error => {
    failed = true;
    throw error;
  })));
}

type Content =
  | { kind: 'markdown' | 'attachment' | 'diff' | 'question' | 'error'; text: string }
  | { kind: 'details'; title: string; text: string };

function editPaths(part: Tool, changes: readonly { path: string }[]): string[] {
  const paths = new Set<string>();
  for (const change of changes) if (change.path) paths.add(change.path);
  for (const doc of part.documents ?? []) if (doc.kind === 'diff' && doc.path) paths.add(doc.path);
  if (typeof part.input === 'object' && part.input && !Array.isArray(part.input)) {
    const fields = part.input as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'target_file', 'filename']) {
      if (typeof fields[key] === 'string' && fields[key]) paths.add(fields[key]);
    }
  }
  return [...paths];
}

function toolContent(part: Tool, options: ExportOptions): Content[] {
  if (!options.includeTools && !options.includeDiffs) return [];
  const doc = strings.threadExport.doc;
  const changes = turnDiffs([part]);
  const input = extractInputPatches(part.input, part.inputText);
  const output = extractToolPatches(part.output);
  const content: Content[] = [];
  if (options.includeTools) {
    const isEdit = changes.length > 0 || part.documents?.some(document => document.kind === 'diff');
    const details: string[] = [];
    if (part.summary) details.push(part.summary);
    else if (isEdit) {
      const paths = editPaths(part, changes);
      if (paths.length) details.push(paths.join(', '));
    }
    if (!isEdit && input.rest) details.push(`${doc.input}:\n${input.rest}`);
    if (output.rest) details.push(`${doc.output}:\n${output.rest}`);
    for (const attached of part.documents ?? []) {
      if (attached.kind === 'markdown' && attached.text) {
        details.push(attached.title ? `${attached.title}\n${attached.text}` : attached.text);
      } else if (attached.kind === 'image') {
        details.push(`${attached.alt || doc.attachment} (${attached.mimeType})`);
      }
    }
    content.push({ kind: 'details', title: `${part.name} (${part.status})`, text: details.filter(Boolean).join('\n\n') });
  }
  if (options.includeDiffs && part.status === 'done') {
    const patches = new Set([...changes.map(diffText), ...input.patches, ...output.patches]);
    for (const patch of patches) if (patch) content.push({ kind: 'diff', text: patch });
  }
  return content;
}

function questionText(part: Question): string {
  const doc = strings.threadExport.doc;
  const lines = [part.text];
  if (part.options.length) lines.push('', ...part.options.map(option => `- ${option.label}${option.description ? `: ${option.description}` : ''}`));
  if (part.answer) {
    const { optionIds, text, attachments, value } = part.answer;
    const answers = optionIds.map(id => part.options.find(option => option.id === id)?.label ?? id);
    if (text) answers.push(text);
    if (value !== undefined && !answers.length) answers.push(JSON.stringify(value));
    for (const file of attachments ?? []) answers.push(`${file.name || doc.attachment} (${file.mimeType})`);
    if (answers.length) lines.push('', `${doc.answer}: ${answers.join('\n')}`);
  }
  return lines.join('\n');
}

function contentOf(message: Message, options: ExportOptions): Content[] {
  const doc = strings.threadExport.doc;
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
        return [{ kind: 'attachment', text: `${name || doc.attachment} (${part.mimeType})` }];
      }
      case 'tool': return toolContent(part, options);
      case 'question': return [{ kind: 'question', text: questionText(part) }];
      case 'thinking': return options.includeThinking ? [{ kind: 'details', title: doc.thinking, text: part.text }] : [];
      case 'error': return part.message ? [{ kind: 'error', text: part.message }] : [];
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
  const doc = strings.threadExport.doc;
  const model = meta?.modelName ?? thread.model;
  return [
    ...(meta?.projectName ? [`${doc.project}: ${meta.projectName}`] : []),
    `${doc.model}: ${model ? `${model} (${thread.providerId})` : thread.providerId}`,
    ...(thread.branch ? [`${doc.branch}: ${thread.branch}`] : []),
    `${doc.exported}: ${new Date().toISOString()}`,
  ];
}

function speaker(message: Message): string {
  const doc = strings.threadExport.doc;
  return message.role === 'user' ? doc.user : message.role === 'assistant' ? doc.assistant : doc.system;
}

function htmlCloser(block: string): string | null {
  const first = block.trimStart();
  if (first.startsWith('<!--')) return '-->';
  if (first.startsWith('<![CDATA[')) return ']]>';
  if (first.startsWith('<?')) return '?>';
  if (/^<![a-z]/i.test(first)) return '>';
  const tag = /^<(pre|script|style|textarea)(?:[\s>]|$)/i.exec(first);
  return tag ? `</${tag[1]!.toLowerCase()}>` : null;
}

function closeBlock(text: string): string {
  if (!/^ {0,3}(?:`{3,}|~{3,}|<)/m.test(text)) return text;
  // An outdented heading ends lists and quotes. Only an unclosed fence or
  // CommonMark raw HTML block (types 1-5) can swallow the next exported message.
  let out = text;
  for (let step = 0; step < 2; step++) {
    const last = markdownBlocks.parse(`${out}\n\n# Next message`, {}).at(-1);
    if (last?.type === 'fence' && last.level === 0) {
      out = `${out}${out.endsWith('\n') ? '' : '\n'}${last.markup}`;
      continue;
    }
    if (last?.type === 'html_block' && last.content.includes('# Next message')) {
      const closer = htmlCloser(last.content);
      if (closer) {
        out = `${out}${out.endsWith('\n') ? '' : '\n'}${closer}`;
        continue;
      }
    }
    break;
  }
  return out;
}

function codeFence(text: string, language = ''): string {
  let longest = 2;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function markdownContent(content: Content): string {
  const doc = strings.threadExport.doc;
  switch (content.kind) {
    case 'markdown': return closeBlock(content.text);
    case 'question': return `**${doc.question}**\n\n${content.text.split('\n').map(line => `> ${markdownLabel(line)}`).join('\n')}`;
    case 'error': return `**${doc.error}**\n\n${content.text.split('\n').map(line => `> ${markdownLabel(line)}`).join('\n')}`;
    case 'attachment': return `- ${markdownLabel(content.text)}`;
    case 'details': {
      const summary = `<summary>${escapeHtml(singleLine(content.title))}</summary>`;
      // Blank lines around a fenced block prevent CommonMark Type 6 HTML blocks from
      // terminating on blank lines inside reasoning or tool output.
      return content.text
        ? `<details>\n${summary}\n\n${codeFence(content.text)}\n\n</details>`
        : `<details>\n${summary}\n</details>`;
    }
    case 'diff': return codeFence(content.text, 'diff');
  }
}

export function exportThreadMarkdown(thread: ThreadSummary, messages: readonly Message[], options: ExportOptions, meta?: ExportMeta): string {
  const doc = strings.threadExport.doc;
  const sections = [`# ${markdownLabel(thread.title) || doc.conversation}`, metadata(thread, meta).map(markdownLabel).join(' · ')];
  for (const message of messages) {
    const content = contentOf(message, options);
    if (!content.length) continue;
    sections.push(`## ${speaker(message)} · ${new Date(message.createdAt).toISOString()}`, ...content.map(markdownContent));
  }
  return `${sections.join('\n\n')}\n`;
}

function stripHtmlLinks(html: string): string {
  // Drop dead internal chat anchors (#thread, #file) and their data-* attributes.
  const withoutInternal = html.replace(/<a\b[^>]*\bhref="#(?:thread|file)"[^>]*>([\s\S]*?)<\/a>/g, '$1');
  // Strip external anchors so standalone HTML carries no clickable external links, keeping URLs as plain text.
  return withoutInternal.replace(/<a\b[^>]*\bhref="([^#"][^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_match, href: string, label: string) => {
    const plain = label.replace(/<[^>]+>/g, '').trim();
    if (!plain) return href;
    return plain === href ? label : `${label} (${href})`;
  });
}

function htmlContent(content: Content): string {
  const doc = strings.threadExport.doc;
  switch (content.kind) {
    case 'markdown': return stripHtmlLinks(renderMarkdown(content.text));
    case 'question': return `<p><strong>${escapeHtml(doc.question)}</strong></p><pre class="question">${escapeHtml(content.text)}</pre>`;
    case 'error': return `<p class="error"><strong>${escapeHtml(doc.error)}:</strong> ${escapeHtml(content.text)}</p>`;
    case 'attachment': return `<p class="attachment">${escapeHtml(content.text)}</p>`;
    case 'details': return `<details><summary>${escapeHtml(content.title)}</summary><pre>${escapeHtml(content.text)}</pre></details>`;
    case 'diff': return `<pre><code class="language-diff">${escapeHtml(content.text)}</code></pre>`;
  }
}

export function exportThreadHtml(thread: ThreadSummary, messages: readonly Message[], options: ExportOptions, meta?: ExportMeta): string {
  const doc = strings.threadExport.doc;
  const title = escapeHtml(singleLine(thread.title) || doc.conversation);
  const lang = escapeHtml(activeLocale());
  const sections = messages.flatMap(message => {
    const content = contentOf(message, options);
    if (!content.length) return [];
    const stamp = new Date(message.createdAt).toISOString();
    return [`<section><header><h2>${escapeHtml(speaker(message))}</h2><time datetime="${stamp}">${stamp}</time></header>\n${content.map(htmlContent).join('\n')}\n</section>`];
  });
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --surface: #fff; --ink: #1d1d24; --muted: #545461; --line: #dcdce4; --code: #f3f3f7; --danger: #b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --surface: #17171c; --ink: #eeeef2; --muted: #b8b8c4; --line: #3a3a44; --code: #24242c; --danger: #fda29b; }
  }
  body { margin: 0; background: var(--surface); color: var(--ink); font: 16px/1.65 system-ui, sans-serif; }
  main { max-width: 74ch; margin: auto; padding: clamp(1rem, 4vw, 3rem); overflow-wrap: anywhere; }
  h1 { font-size: clamp(1.6rem, 5vw, 2.4rem); line-height: 1.15; margin: 0; }
  .metadata, time, .attachment { color: var(--muted); font-size: .875rem; }
  .error { color: var(--danger); }
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
  @media print {
    :root { --surface: #fff; --ink: #000; --muted: #444; --line: #ccc; --code: #f5f5f5; --danger: #900; }
    main { max-width: none; padding: 0; }
    section > header { break-after: avoid; }
    pre, details { break-inside: avoid; }
  }
</style>
</head>
<body><main>
<h1>${title}</h1>
<p class="metadata">${metadata(thread, meta).map(escapeHtml).join(' · ')}</p>
${sections.join('\n')}
</main></body>
</html>\n`;
}

const EXPORT_SLUG_MAX_BYTES = 180;

export function exportFilename(title: string, format: ExportOptions['format'], now = new Date()): string {
  const cleaned = title.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const encoder = new TextEncoder();
  let slug = '';
  let bytes = 0;
  let chars = 0;
  for (const ch of cleaned) {
    const next = encoder.encode(ch).byteLength;
    if (chars >= 60 || bytes + next > EXPORT_SLUG_MAX_BYTES) break;
    slug += ch;
    bytes += next;
    chars += 1;
  }
  slug = slug.replace(/-$/, '');
  return `${slug || 'conversation'}-${now.toISOString().slice(0, 10)}.${format === 'markdown' ? 'md' : 'html'}`;
}

export async function downloadExport(filename: string, content: string, mimeType: string): Promise<DownloadResult> {
  if (desktopShell()) {
    const bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > DESKTOP_EXPORT_MAX_MIB * 1024 * 1024) {
      throw new Error(fill(strings.threadExport.desktopTooLarge, { limit: String(DESKTOP_EXPORT_MAX_MIB) }));
    }
    const saved = await saveAttachment(filename, bytes, false, { export: true });
    return saved ? { path: saved.path } : {};
  }
  const file = new File([content], filename, { type: mimeType });
  // Touch browsers and mobile WebViews hand exported files to the native share sheet when available.
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return {};
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { cancelled: true };
    }
  }
  const url = URL.createObjectURL(file);
  const revoke = URL.revokeObjectURL.bind(URL);
  try {
    browserDownload(url, filename);
  } finally {
    window.setTimeout(() => revoke(url), 60_000);
  }
  return {};
}
