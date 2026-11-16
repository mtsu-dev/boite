import { describe, expect, test } from 'bun:test';
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
});
