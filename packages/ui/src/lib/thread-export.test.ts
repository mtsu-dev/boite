import { expect, onTestFinished, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import type { Message, ThreadSummary } from '@boite/contracts';
import { test } from '../test/fake-client';
import { longThread } from './fake-client/threads-seed';
import { downloadExport, exportFilename, exportThreadHtml, exportThreadMarkdown, loadAllThreadMessages, type ExportOptions } from './thread-export';

const thread: ThreadSummary = { ...longThread(), title: 'Fix auth flow', branch: 'fix/auth' };
const clean: ExportOptions = { format: 'markdown', includeTools: false, includeDiffs: false };
const messages: Message[] = [
  {
    id: 'question', threadId: thread.id, turnId: 'turn', role: 'user', state: 'complete', createdAt: 0,
    parts: [
      { type: 'text', text: 'Can you fix this?', displayText: '**Can you fix this?**' },
      { type: 'file', name: 'log.txt', mimeType: 'text/plain', data: 'raw-attachment-data' },
    ],
  },
  {
    id: 'answer', threadId: thread.id, turnId: 'turn', role: 'assistant', state: 'complete', createdAt: 1000,
    parts: [
      { type: 'thinking', text: 'private thought' },
      { type: 'tool', toolId: 'read', name: 'Read', status: 'done', input: { file_path: 'auth.ts' }, output: 'read result' },
      { type: 'tool', toolId: 'edit', name: 'Edit', status: 'done', input: { old_string: 'old line', new_string: 'new line' }, output: 'updated', documents: [
        { kind: 'diff', path: 'auth.ts', oldText: 'old line\n', newText: 'new line\n' },
      ] },
      { type: 'text', text: 'Fixed.' },
    ],
  },
];

test('the formats include chronological text and attachment names, with each optional part independently controlled', () => {
  for (const format of [exportThreadMarkdown, exportThreadHtml]) {
    const meta = { projectName: 'Boite', modelName: 'Echo 1' };
    const short = format(thread, messages, clean, meta);
    expect(short).toContain('Project: Boite');
    expect(short).toContain('Model: Echo 1 (echo)');
    expect(short).toContain('Branch: fix/auth');
    expect(short).toContain('1970-01-01T00:00:01.000Z');
    expect(short.indexOf('Can you fix this?')).toBeLessThan(short.indexOf('Fixed.'));
    expect(short).toContain('log.txt (text/plain)');
    expect(short).not.toMatch(/raw-attachment-data|private thought|read result|new line/);

    const tools = format(thread, messages, { ...clean, includeTools: true });
    expect(tools).toContain('<details>');
    expect(tools).toContain('read result');
    expect(tools).not.toMatch(/new line|private thought/);

    const diffs = format(thread, messages, { ...clean, includeDiffs: true });
    expect(diffs).toContain('--- auth.ts\n+++ auth.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line');
    expect(diffs).not.toContain('read result');

    const all = format(thread, messages, { ...clean, includeTools: true, includeDiffs: true, includeThinking: true });
    expect(all).toContain('<summary>Thinking</summary>');
    expect(all).toContain('private thought');
    expect(all).toContain('read result');
    expect(all).toContain('+new line');
  }
});

test('standalone HTML renders Markdown while treating executable markup as text', () => {
  const attack = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const message: Message = { ...messages[1]!, parts: [
    { type: 'text', text: `**Hello**\n\n${attack}\n\n[unsafe](javascript:alert(1))\n\n![pixel](https://example.com/pixel)` },
    { type: 'tool', toolId: 'bad', name: '<iframe>', status: 'done', input: null, output: attack },
  ] };
  const html = exportThreadHtml({ ...thread, title: attack }, [message], { ...clean, includeTools: true });
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('prefers-color-scheme: dark');
  expect(html).toContain('<strong>Hello</strong>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.title).toBe(attack);
  expect(doc.querySelector('script, img, iframe, link, [onerror], a[href]:not([href^="#"])')).toBeNull();
  expect(doc.querySelector('details pre')?.textContent).toContain(attack);
});

test('diff-only export keeps patch lines and leaves surrounding tool logs out', () => {
  const patch = ['diff --git a/auth.ts b/auth.ts', 'index 123..456 100644', '--- a/auth.ts', '+++ b/auth.ts', '@@ -1 +1 @@', '-old', '+new'].join('\n');
  const second = '*** Begin Patch\n*** Add File: notes.txt\n+note\n*** End Patch';
  const message: Message = { ...messages[1]!, parts: [
    { type: 'tool', toolId: 'shell', name: 'Bash', status: 'done', input: 'git diff', output: `before log\n${patch}\n unrelated log\n${second}\nafter log` },
  ] };
  for (const format of [exportThreadMarkdown, exportThreadHtml]) {
    const diffs = format(thread, [message], { ...clean, includeDiffs: true });
    expect(diffs).toContain(patch);
    expect(diffs).toContain(second);
    expect(diffs).not.toMatch(/log|git diff/);
    const tools = format(thread, [message], { ...clean, includeTools: true });
    expect(tools).toContain('unrelated log');
    expect(tools).not.toContain('+new');
  }
});

test('Codex file changes and shell patches respect the diff option independently of tool details', () => {
  const patch = '@@ -1 +1 @@\n-old\n+new';
  const shellPatch = '*** Begin Patch\n*** Add File: notes.txt\n+shell notes\n*** End Patch';
  const message: Message = { ...messages[1]!, parts: [
    { type: 'tool', toolId: 'patch', name: 'ApplyPatch', status: 'done', input: { changes: [
      { path: 'auth.ts', kind: { type: 'update' }, diff: patch },
      { path: 'readme.md', kind: { type: 'add' }, diff: 'new readme\n' },
    ] }, output: null },
    { type: 'tool', toolId: 'shell', name: 'Bash', status: 'done', input: { command: `apply_patch <<'PATCH'\n${shellPatch}\nPATCH`, cwd: '/repo' }, output: 'Succeeded' },
  ] };
  for (const format of [exportThreadMarkdown, exportThreadHtml]) {
    const diffs = format(thread, [message], { ...clean, includeDiffs: true });
    expect(diffs).toContain(`--- auth.ts\n+++ auth.ts\n${patch}`);
    expect(diffs).toContain('+new readme');
    expect(diffs).toContain(shellPatch);
    expect(diffs).not.toMatch(/Succeeded|apply_patch/);
    const tools = format(thread, [message], { ...clean, includeTools: true });
    expect(tools).toContain('auth.ts');
    expect(tools).toContain('Succeeded');
    expect(tools).not.toMatch(/-old|\+new|new readme|shell notes/);
  }
});

test('interrupted fences end before the next part or message', () => {
  const interrupted: Message = { ...messages[1]!, parts: [
    { type: 'text', text: '````ts\nconst value = "```";' },
    { type: 'text', text: '~~~sh\necho hi' },
  ] };
  const markdown = exportThreadMarkdown(thread, [interrupted, messages[0]!], clean);
  expect(markdown).toContain('const value = "```";\n````\n\n~~~sh\necho hi\n~~~\n\n## User');
});

test('closed fences in lists and quotes preserve the next message in CommonMark', () => {
  const md = new MarkdownIt('commonmark');
  for (const text of ['- ```ts\n  const answer = 1;\n  ```', '> - ```ts\n>   const answer = 1;\n>   ```']) {
    const message: Message = { ...messages[1]!, parts: [{ type: 'text', text }] };
    const markdown = exportThreadMarkdown(thread, [message, messages[0]!], clean);
    expect(md.render(markdown)).toContain('<h2>User ·');
    expect(markdown).toContain(`${text}\n\n## User`);
  }
});

test('question-only messages include the prompt, choices and answer in both formats', () => {
  const message: Message = { ...messages[1]!, parts: [
    { type: 'question', questionId: 'policy', text: 'Which policy? <script>', allowText: true, multiple: false,
      options: [{ id: 'retry', label: 'Retry' }, { id: 'pause', label: 'Pause', description: 'Wait for help' }],
      answer: { optionIds: ['pause'], text: 'Check the logs first.' } },
  ] };
  for (const format of [exportThreadMarkdown, exportThreadHtml]) {
    const result = format(thread, [message], clean);
    expect(result).toContain('Which policy? &lt;script&gt;');
    expect(result).toContain('Retry');
    expect(result).toContain('Wait for help');
    expect(result).toMatch(/Answer:[\s\S]*Pause[\s\S]*Check the logs first/);
  }
});

test('export reads every page of a long conversation in order for a paired device', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0, long: true });
  client.becomes('session');
  const call = vi.spyOn(client, 'call');
  const all = await loadAllThreadMessages(client, 't-long');
  expect(all.map(message => message.id)).toEqual(longThread().messages.map(message => message.id));
  expect(call.mock.calls.filter(([method]) => method === 'messages.list')).toHaveLength(1);
});

test('export reads full prose when a page omitted part of the text', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const original = client.call.bind(client);
  const snapshot = await client.call('threads.get', { threadId: 't-trace' });
  const full: Message = { ...messages[1]!, parts: [{ type: 'text', text: 'Complete answer' }] };
  const preview: Message = { ...full, parts: [{ type: 'text', text: 'Complete', omitted: 7 }] };
  const call = vi.spyOn(client, 'call').mockImplementation((method, params) => {
    if (method === 'threads.get') return Promise.resolve({ ...snapshot, messages: [messages[0]!, preview], messagesBefore: null });
    if (method === 'messages.list') return Promise.resolve({ messages: [full], before: null });
    return original(method, params);
  });
  const exported = await loadAllThreadMessages(client, 't-trace');
  expect(exported[1]).toEqual(full);
  expect(call).toHaveBeenCalledWith('messages.list', expect.objectContaining({ from: 1, limit: 1, compactToolParts: false }));
});

test('export fetches every deferred tool part without filtering by tool name', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const original = client.call.bind(client);
  const tools = Array.from({ length: 26 }, (_, index) => ({
    type: 'tool' as const, toolId: `tool-${index}`, name: index % 2 ? 'Read' : 'Bash', status: 'done' as const,
    input: { path: 'preview' }, output: '', inputDeferred: true as const, outputDeferred: true as const, documentsDeferred: true as const,
  }));
  const patch = '--- auth.ts\n+++ auth.ts\n@@ -1 +1 @@\n-old\n+new';
  const snapshot = await client.call('threads.get', { threadId: 't-trace' });
  const call = vi.spyOn(client, 'call').mockImplementation((method, params) => {
    if (method === 'threads.get') return Promise.resolve({ ...snapshot, messages: [{ ...messages[1], parts: tools }] });
    const toolId = 'toolId' in params ? params.toolId : '';
    if (method === 'messages.toolPart') return Promise.resolve({ part: { type: 'tool', toolId, name: 'Bash', status: 'done', input: { path: 'full' }, output: toolId === 'tool-25' ? patch : `result ${toolId}` } });
    return original(method, params);
  });
  const options = { ...clean, includeDiffs: true };
  const exported = await loadAllThreadMessages(client, 't-trace', options);
  expect(call.mock.calls.filter(([method]) => method === 'messages.toolPart')).toHaveLength(26);
  expect(exported[0]?.parts.at(-1)).toMatchObject({ input: { path: 'full' }, output: patch });
  expect(exportThreadMarkdown(thread, exported, options)).toContain(patch);
});

test('a core that returns the same cursor cannot hang or silently export half a conversation', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0, long: true });
  const original = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation((method, params) => method === 'messages.list'
    ? Promise.resolve({ messages: [], before: (params as { before: string }).before }) as ReturnType<typeof client.call>
    : original(method, params));
  await expect(loadAllThreadMessages(client, 't-long')).rejects.toThrow('complete conversation history');
});

test('filenames keep readable Unicode, discard path separators and fall back for an empty stem', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  expect(exportFilename(' Fix Auth / Flow ', 'markdown', now)).toBe('fix-auth-flow-2026-11-25.md');
  expect(exportFilename('Résumé\\日本語', 'html', now)).toBe('resume-日本語-2026-11-25.html');
  expect(exportFilename('..\\ /', 'markdown', now)).toBe('conversation-2026-11-25.md');
});

test('desktop downloads mark exports and refuse an oversized body before IPC', async () => {
  const invoke = vi.fn().mockResolvedValue({ path: 'conversation.md', opened: false });
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  const largeBody = new Uint8Array(0);
  Object.defineProperty(largeBody, 'byteLength', { value: 64 * 1024 * 1024 + 1 });
  const encode = TextEncoder.prototype.encode;
  const encoding = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, value) {
    return value === 'oversized export' ? largeBody : encode.call(this, value);
  });
  onTestFinished(() => { encoding.mockRestore(); vi.unstubAllGlobals(); });

  await expect(downloadExport('conversation.md', 'oversized export', 'text/markdown')).rejects.toThrow('64 MiB');
  expect(invoke).not.toHaveBeenCalled();
  await downloadExport('conversation.md', '# Conversation', 'text/markdown');
  expect(invoke).toHaveBeenCalledWith('save_attachment', new TextEncoder().encode('# Conversation'), {
    headers: { 'x-boite-export': '1', 'x-boite-name': 'conversation.md', 'x-boite-open': '0' },
  });
});

test('exportFilename caps multibyte Unicode titles in UTF-8 bytes below filesystem limits', () => {
  const title = '𝐀'.repeat(60);
  const name = exportFilename(title, 'html', new Date('2026-11-25T10:00:00Z'));
  expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(200);
  expect(name.endsWith('-2026-11-25.html')).toBe(true);
});
