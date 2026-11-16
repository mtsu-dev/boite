import { describe, expect, test } from 'bun:test';
import { secretMask } from '@boite/contracts';
import { assistant, claudeThread, harness, init, runTurn, scripted, sdk, success, useClaudeHarness } from './fixtures/claude-query.ts';

useClaudeHarness();

const SESSION = 'sess-notices';

/** The four integrity notices, with the fields CLI 2.1.325 declares for each. */
const NOTICES = [
  { type: 'system', subtype: 'session_writes_lost', error_code: 'ENOSPC', lost: ['transcript', 'global_config'], transcript_session_ids: [SESSION], uuid: 'n1', session_id: SESSION },
  { type: 'system', subtype: 'file_attachments_missing', message_uuid: 'm-1', sent_count: 3, missing: [{ file_uuid: 'f-1', reason: 'download' }, { file_uuid: 'f-2', reason: 'too_large' }], uuid: 'n2', session_id: SESSION },
  { type: 'system', subtype: 'instruction_size_warning', total_chars: 52_000, total_limit_chars: 40_000, file_count: 3, largest_chars: 45_000, uuid: 'n3', session_id: SESSION },
  { type: 'system', subtype: 'mirror_error', error: 'append timed out', key: { projectKey: 'proj', sessionId: SESSION, subpath: 'agent-1' }, uuid: 'n4', session_id: SESSION },
];

describe('claude integrity notices', () => {
  test('each notice is a line of the thread and the turn goes on', async () => {
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    scripted(() => undefined, (fake) => {
      fake.emit(init(SESSION));
      fake.emit(assistant(SESSION, [{ type: 'text', text: 'before' }]));
      for (const notice of NOTICES) fake.emit(sdk(notice));
      fake.emit(sdk({ ...(assistant(SESSION, [{ type: 'text', text: 'went on' }]) as { message: object }), message: { id: 'msg_2', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'went on' }] } }));
      fake.emit(success(SESSION));
    });

    expect(await runTurn(client, threadId, 'go')).toBe('done');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages[1]?.parts ?? [];
    expect(parts.filter(part => part.type !== 'text' || part.text !== '')).toEqual([
      expect.objectContaining({ type: 'text', text: 'before' }),
      { type: 'notice', notice: { kind: 'writes_lost', cause: 'disk_full', transcript: true },
        detail: 'session_writes_lost: ENOSPC; lost transcript, global_config; sessions sess-notices' },
      { type: 'notice', notice: { kind: 'attachments_missing', missing: 2, sent: 3 },
        detail: 'file_attachments_missing: message m-1; f-1 (download), f-2 (too_large)' },
      { type: 'notice', notice: { kind: 'instructions_large', chars: 52_000, limit: 40_000, files: 3 },
        detail: 'instruction_size_warning: 52000 chars in 3 files, limit 40000; largest 45000' },
      { type: 'notice', notice: { kind: 'mirror_failed' },
        detail: 'mirror_error: append timed out; project proj, session sess-notices, agent-1' },
      expect.objectContaining({ type: 'text', text: 'went on' }),
    ]);
  });

  test('a notice the CLI writes as it exits, after the turn ended, shows in the thread and starts nothing', async () => {
    harness.core.settings.set({ warmProcessMinutes: 0 });
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    let exits = 0;
    scripted((fake) => {
      // The CLI's documented order: the last result, then this frame as it exits once the core closed its input.
      const end = fake.end.bind(fake);
      fake.end = () => { if (exits++ === 0) fake.emit(sdk(NOTICES[0])); end(); };
    }, (fake) => {
      fake.emit(init(SESSION));
      fake.emit(assistant(SESSION, [{ type: 'text', text: 'answer' }]));
      fake.emit(success(SESSION));
    });

    const shown = client.next('message.started', message => message.threadId === threadId && message.parts.some(part => part.type === 'notice'), 10000);
    expect(await runTurn(client, threadId, 'go')).toBe('done');
    const message = await shown;
    expect(exits).toBeGreaterThan(0);

    const thread = await client.call('threads.get', { threadId });
    expect(thread.turns.map(turn => turn.status)).toEqual(['done']);
    expect(thread.messages.map(entry => entry.role)).toEqual(['user', 'assistant', 'system']);
    expect(thread.messages.at(-1)).toMatchObject({
      id: message.id, role: 'system', state: 'complete', turnId: thread.turns[0]!.id,
      parts: [{ type: 'notice', notice: { kind: 'writes_lost', cause: 'disk_full', transcript: true },
        detail: 'session_writes_lost: ENOSPC; lost transcript, global_config; sessions sess-notices' }],
    });
  }, 15_000);

  test('a secret of the thread in a notice written at exit is masked in the stored message and the event', async () => {
    harness.core.settings.set({ warmProcessMinutes: 0 });
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    const value = 'sk-notice-0123456789abcdef';
    harness.core.secrets.masks.add(`thread:${threadId}`, 'test:notice', 'API_KEY', new TextEncoder().encode(value));
    let exits = 0;
    scripted((fake) => {
      const end = fake.end.bind(fake);
      fake.end = () => { if (exits++ === 0) fake.emit(sdk({ ...NOTICES[3], error: `append to https://store.example/?key=${value} timed out` })); end(); };
    }, (fake) => {
      fake.emit(init(SESSION));
      fake.emit(success(SESSION));
    });

    const shown = client.next('message.started', message => message.threadId === threadId && message.parts.some(part => part.type === 'notice'), 10000);
    expect(await runTurn(client, threadId, 'go')).toBe('done');
    const sent = await shown;
    const stored = (await client.call('threads.get', { threadId })).messages.find(message => message.id === sent.id);
    for (const message of [sent, stored]) {
      const detail = JSON.stringify(message?.parts);
      expect(detail).not.toContain(value);
      expect(detail).toContain(`append to https://store.example/?key=${secretMask('API_KEY')} timed out`);
    }
  }, 15_000);
});
