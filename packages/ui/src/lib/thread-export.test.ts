import { expect, vi } from 'vitest';
import type { Message, ThreadSummary } from '@boite/contracts';
import { test } from '../test/fake-client';
import { longThread } from './fake-client/threads-seed';
import { exportFilename, exportThreadHtml, exportThreadMarkdown, loadAllThreadMessages, type ExportOptions } from './thread-export';

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

test('export reads every page of a long conversation in order for a paired device', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0, long: true });
  client.becomes('session');
  const call = vi.spyOn(client, 'call');
  const all = await loadAllThreadMessages(client, 't-long');
  expect(all.map(message => message.id)).toEqual(longThread().messages.map(message => message.id));
  expect(call.mock.calls.filter(([method]) => method === 'messages.list')).toHaveLength(1);
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
