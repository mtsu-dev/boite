import { expect, onTestFinished, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import { extractToolPatches, projectToolDiffs, RpcErrorCode, type Message, type ThreadSummary } from '@boite/contracts';
import { test } from '../test/fake-client';
import { RpcFailure, type Client } from './client';
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

test('export reads full prose with fullText first and falls back for older cores', async ({ createClient }) => {
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
  expect(call).toHaveBeenCalledWith('messages.list', expect.objectContaining({ from: 1, limit: 1, compactToolParts: true, fullText: true, omitThinking: true }));

  // Older core ignores fullText and keeps returning omitted until compactToolParts: false.
  call.mockImplementation((method, params) => {
    if (method === 'threads.get') return Promise.resolve({ ...snapshot, messages: [messages[0]!, preview], messagesBefore: null });
    if (method === 'messages.list') {
      const compact = (params as { compactToolParts?: boolean }).compactToolParts;
      return Promise.resolve({ messages: [compact === false ? full : preview], before: null });
    }
    return original(method, params);
  });
  const legacy = await loadAllThreadMessages(client, 't-trace');
  expect(legacy[1]).toEqual(full);
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

async function mockLegacyToolRead(client: Client, deferred?: 'inputDeferred' | 'documentsDeferred') {
  const message: Message = { ...messages[1]!, threadId: 't-trace', parts: [{
    type: 'tool', toolId: 'read', name: 'Read', status: 'done', input: { file_path: 'auth.ts' }, output: 'preview',
    outputDeferred: true, ...(deferred && { [deferred]: true }),
  }] };
  const ref = { threadId: message.threadId, messageId: message.id, toolId: 'read' };
  const snapshot = await client.call('threads.get', { threadId: ref.threadId });
  const original = client.call.bind(client);
  const missingMethod = new RpcFailure({ code: RpcErrorCode.MethodNotFound, message: 'Unknown method messages.toolPart' });
  const call = vi.spyOn(client, 'call').mockImplementation((method, params) => {
    if (method === 'threads.get') return Promise.resolve({ ...snapshot, messages: [message], messagesBefore: null });
    if (method === 'messages.toolPart') return Promise.reject(missingMethod);
    if (method === 'messages.toolOutput') return Promise.resolve({ output: 'complete output' });
    return original(method, params);
  });
  return { call, ref, missingMethod };
}

test('export reads from an old core when only tool output is deferred', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const { call, ref } = await mockLegacyToolRead(client);
  const exported = await loadAllThreadMessages(client, ref.threadId, { ...clean, includeTools: true });
  expect(call).toHaveBeenCalledWith('messages.toolPart', ref);
  expect(call).toHaveBeenCalledWith('messages.toolOutput', ref);
  expect(exported[0]?.parts[0]).toMatchObject({ input: { file_path: 'auth.ts' }, output: 'complete output' });
  expect(exported[0]?.parts[0]).not.toHaveProperty('outputDeferred', true);
});

test.for(['inputDeferred', 'documentsDeferred'] as const)('export refuses the old core fallback with %s', async (deferred, { createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const { call, ref, missingMethod } = await mockLegacyToolRead(client, deferred);
  let caught: unknown;
  try {
    await loadAllThreadMessages(client, ref.threadId, { ...clean, includeTools: true, includeDiffs: true });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain('"Read"');
  expect((caught as Error).message).toContain(ref.messageId);
  expect((caught as Error).cause).toBe(missingMethod);
  expect(call.mock.calls.some(([method]) => method === 'messages.toolOutput')).toBe(false);
});

test('diff-only export skips failed deferred tool calls, requests diffsOnly and names oversized tools that fail to hydrate', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const snapshot = await client.call('threads.get', { threadId: 't-trace' });
  const failedTool: Message = {
    ...messages[1]!, id: 'm-diff-only', threadId: 't-trace', parts: [
      { type: 'tool', toolId: 't-err', name: 'Bash', status: 'error', input: 'git diff', output: null, outputDeferred: true },
    ],
  };
  const original = client.call.bind(client);
  const call = vi.spyOn(client, 'call').mockImplementation((method, params) => {
    if (method === 'threads.get') return Promise.resolve({ ...snapshot, messages: [failedTool], messagesBefore: null });
    return original(method, params);
  });
  await loadAllThreadMessages(client, 't-trace', { ...clean, includeDiffs: true });
  expect(call.mock.calls.some(([method]) => method === 'messages.toolPart')).toBe(false);

  const oversized: Message = {
    ...messages[1]!, id: 'm-oversized', threadId: 't-trace', parts: [
      { type: 'tool', toolId: 't-big', name: 'Write', status: 'done', input: { file_path: 'huge.bin' }, output: null, documentsDeferred: true },
    ],
  };
  const frameError = new RpcFailure({ code: RpcErrorCode.Refused, message: 'response exceeds 16777216 serialized UTF-8 bytes' });
  call.mockImplementation((method, params) => {
    if (method === 'threads.get') return Promise.resolve({ ...snapshot, messages: [oversized], messagesBefore: null });
    if (method === 'messages.toolPart') return Promise.reject(frameError);
    return original(method, params);
  });
  await expect(loadAllThreadMessages(client, 't-trace', { ...clean, includeDiffs: true })).rejects.toThrow(/"Write".*m-oversized.*16777216/);
  expect(call).toHaveBeenCalledWith('messages.toolPart', { threadId: 't-trace', messageId: 'm-oversized', toolId: 't-big', diffsOnly: true });
  await expect(loadAllThreadMessages(client, 't-trace', { ...clean, includeDiffs: true }, undefined, { deferredToolParts: true })).rejects.toThrow(/older Boite core.*Update Boite/i);
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

test('desktop downloads mark exports, return the saved path and refuse an oversized body before IPC', async () => {
  const invoke = vi.fn().mockResolvedValue({ path: '/home/user/Downloads/conversation.md', opened: false });
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
  const saved = await downloadExport('conversation.md', '# Conversation', 'text/markdown');
  expect(saved).toEqual({ path: '/home/user/Downloads/conversation.md' });
  expect(invoke).toHaveBeenCalledWith('save_attachment', new TextEncoder().encode('# Conversation'), {
    headers: { 'x-boite-export': '1', 'x-boite-name': 'conversation.md', 'x-boite-open': '0' },
  });
});

test('exportFilename caps multibyte Unicode titles in UTF-8 bytes below filesystem limits', () => {
  const title = '𠮷'.repeat(60);
  const name = exportFilename(title, 'html', new Date('2026-11-25T10:00:00Z'));
  expect(name).toBe(`${'𠮷'.repeat(45)}-2026-11-25.html`);
});

test('multi-paragraph details and unclosed HTML blocks keep CommonMark structure intact', () => {
  const md = new MarkdownIt('commonmark');
  const tricky: Message = { ...messages[1]!, parts: [
    { type: 'thinking', text: 'First idea\n\n# Not a heading\n* item _x_\n</details>\n```' },
    { type: 'text', text: '<!-- unclosed comment' },
    { type: 'text', text: '<pre>unclosed pre' },
  ] };
  const markdown = exportThreadMarkdown(thread, [tricky, messages[0]!], { ...clean, includeThinking: true });
  const rendered = md.render(markdown);
  expect(rendered).not.toContain('<h1>Not a heading</h1>');
  expect(rendered).not.toContain('<li>item');
  expect(rendered).toContain('* item _x_');
  expect(rendered).toContain('&lt;/details&gt;');
  expect(rendered).toContain('<h2>User ·');
  expect(rendered).toContain('Can you fix this?');
});

test('edit metadata, trailing-newline diffs, failed tool diffs, errors and standalone HTML cleanup behave consistently', () => {
  const trailingDiff = { kind: 'diff' as const, path: 'newline.ts', oldText: 'const a = 1;', newText: 'const a = 1;\n' };
  const contentAndNewline = { kind: 'diff' as const, path: 'both.ts', oldText: 'old', newText: 'new\n' };
  const removedNewlineOnEdit = { kind: 'diff' as const, path: 'drop-nl.ts', oldText: 'old\n', newText: 'new' };
  const contextEofChange = { kind: 'diff' as const, path: 'ctx-eof.ts', oldText: 'x\nlast', newText: 'y\nlast\n' };
  const appendAfterNoNl = { kind: 'diff' as const, path: 'append.ts', oldText: 'a\nlast', newText: 'a\nlast\nextra\n' };
  const gapEofChange = { kind: 'diff' as const, path: 'gap-eof.ts', oldText: '1\n2\n3\n4\n5\nlast', newText: 'ONE\n2\n3\n4\n5\nlast\n' };
  const addedNewline = { kind: 'diff' as const, path: 'empty-add.ts', oldText: '', newText: '\n' };
  const removedNewline = { kind: 'diff' as const, path: 'empty-del.ts', oldText: '\n', newText: '' };
  const msg: Message = { ...messages[1]!, parts: [
    { type: 'tool', toolId: 'edit-path', name: 'Edit', status: 'done', input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }, output: null,
      documents: [trailingDiff, contentAndNewline, removedNewlineOnEdit, contextEofChange, appendAfterNoNl, gapEofChange, addedNewline, removedNewline] },
    { type: 'tool', toolId: 'failed-patch', name: 'Bash', status: 'error', input: 'git diff', output: '--- bad.ts\n+++ bad.ts\n@@ -1 +1 @@\n-x\n+y' },
    { type: 'error', message: 'Provider timeout' },
    { type: 'text', text: 'See `thr_abcdef123456` and [docs](https://example.com/docs).' },
  ] };
  const toolsMd = exportThreadMarkdown(thread, [msg], { ...clean, includeTools: true });
  expect(toolsMd).toContain('newline.ts');
  expect(toolsMd).toContain('src/app.ts');
  expect(toolsMd).toContain('Provider timeout');

  const diffsMd = exportThreadMarkdown(thread, [msg], { ...clean, includeDiffs: true });
  expect(diffsMd).toContain('--- newline.ts\n+++ newline.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n\\ No newline at end of file\n+const a = 1;');
  expect(diffsMd).toContain('--- both.ts\n+++ both.ts\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new');
  expect(diffsMd).toContain('--- drop-nl.ts\n+++ drop-nl.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n\\ No newline at end of file');
  expect(diffsMd).toContain('--- ctx-eof.ts\n+++ ctx-eof.ts\n@@ -1,2 +1,2 @@\n-x\n+y\n-last\n\\ No newline at end of file\n+last');
  expect(diffsMd).toContain('--- append.ts\n+++ append.ts\n@@ -1,2 +1,3 @@\n a\n-last\n\\ No newline at end of file\n+last\n+extra');
  expect(diffsMd).toContain('--- gap-eof.ts\n+++ gap-eof.ts\n@@ -1,4 +1,4 @@\n-1\n+ONE\n 2\n 3\n 4\n@@ -6,1 +6,1 @@\n-last\n\\ No newline at end of file\n+last');
  expect(diffsMd).toContain('--- empty-add.ts\n+++ empty-add.ts\n@@ -0,0 +1,1 @@\n+');
  expect(diffsMd).toContain('--- empty-del.ts\n+++ empty-del.ts\n@@ -1,1 +0,0 @@\n-');
  expect(diffsMd).not.toContain('bad.ts');

  const html = exportThreadHtml(thread, [msg], { ...clean, includeTools: true });
  expect(html).toContain('@media print');
  expect(html).toContain('Provider timeout');
  expect(html).toContain('docs (https://example.com/docs)');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('a[href="#thread"], a[href="#file"], [data-file-path], a[href]:not([href^="#"])')).toBeNull();
});

test('patch extraction stays linear on unclosed Begin Patch headers, ignores unclosed blocks before valid patches, and separates header-only git diffs', () => {
  const realPatch = '--- ok.ts\n+++ ok.ts\n@@ -1 +1 @@\n-old\n+new';
  const unclosed = `${'*** Begin Patch\nnoise line\n'.repeat(10_000)}${realPatch}`;
  const extracted = extractToolPatches(unclosed);
  expect(extracted.patches).toEqual([realPatch]);

  const validBeginPatch = '*** Begin Patch\n*** Update File: a.ts\n@@\n-before\n+after\n*** End Patch';
  const unclosedThenValid = `*** Begin Patch\nsecret tool log line\nmore noise\n${validBeginPatch}\ntrailing log`;
  const isolated = extractToolPatches(unclosedThenValid);
  expect(isolated.patches).toEqual([validBeginPatch]);
  expect(isolated.rest).toContain('secret tool log line');
  const diffProjected = projectToolDiffs({
    type: 'tool', toolId: 't-unclosed', name: 'Bash', status: 'done', input: null, output: unclosedThenValid,
  });
  expect(diffProjected.output).toBe(validBeginPatch);

  const headerOnly = 'diff --git a/empty.txt b/empty.txt\nnew file mode 100644';
  const projected = projectToolDiffs({
    type: 'tool', toolId: 't-sep', name: 'Bash', status: 'done', input: null,
    output: `log\n${headerOnly}\nother log\n${realPatch}\n`,
  });
  expect(projected.output).toBe(`${headerOnly}\n\n${realPatch}`);
  expect(extractToolPatches(projected.output).patches).toEqual([headerOnly, realPatch]);
});

test('export omits tool parts on the wire when tools are unchecked and omits running tools for diff-only exports', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const call = vi.spyOn(client, 'call');
  await loadAllThreadMessages(client, 't-trace', clean);
  expect(call).toHaveBeenCalledWith('threads.get', expect.objectContaining({ threadId: 't-trace', omitTools: true, omitThinking: true }));

  call.mockClear();
  await loadAllThreadMessages(client, 't-trace', { ...clean, includeDiffs: true });
  expect(call).toHaveBeenCalledWith('threads.get', expect.objectContaining({ threadId: 't-trace', omitTools: 'running', omitThinking: true }));
});
