import { afterEach, expect, test } from 'bun:test';
import type { Message, MessagePart } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let h: TestCore;
afterEach(async () => { await h?.stop(); });

test('thread stats count every compaction and prompt of the conversation, not tool output that names one', async () => {
  h = await startTestCore();
  const owner = await h.connect();
  const { threadId } = await echoThread(h, owner);
  const message = (id: string, role: Message['role'], createdAt: number, parts: MessagePart[]): Message =>
    ({ id, threadId, turnId: `trn_${id}`, role, state: 'complete', createdAt, parts });
  const compaction: MessagePart = { type: 'compaction', trigger: 'auto', preTokens: 201_200, postTokens: 13_400 };
  h.core.journal.putMessage(message('p1', 'user', 1_000, [{ type: 'text', text: 'fix the badge' }]));
  // Two compactions inside one turn's answer, and a tool whose output quotes the JSON of one.
  h.core.journal.putMessage(message('a1', 'assistant', 2_000, [
    compaction,
    { type: 'tool', toolId: 'tool-1', name: 'Bash', input: { command: 'rg compaction' }, output: '{"type":"compaction","trigger":"auto"}', status: 'done', startedAt: 2_000, finishedAt: 2_100 },
    { ...compaction, trigger: 'manual' },
    { type: 'tool', toolId: 'tool-2', name: 'mcp__store__put', input: { data: { type: 'compaction' } }, output: 'ok', status: 'done', startedAt: 2_200, finishedAt: 2_300 },
  ]));
  h.core.journal.putMessage(message('s1', 'system', 3_000, [{ type: 'text', text: '/compact', displayText: 'Automatic compaction' }]));
  h.core.journal.putMessage(message('a2', 'assistant', 4_000, [compaction]));
  h.core.journal.putMessage(message('p2', 'user', 5_000, [{ type: 'text', text: 'the "type":"compaction" bit?' }]));

  const before = await owner.call('threads.stats', { threadId });
  expect(before).toEqual({ threadId, compactions: 3, prompts: 2 });
  const { grant } = await owner.call('pairing.grant', {});
  const paired = await connect(h.url, '', { grant });
  const agent = await connect(h.url, h.core.agents.tokenFor(threadId));
  try {
    expect(await paired.call('threads.stats', { threadId })).toEqual(before);
    expect(await thrown(agent.call('threads.stats', { threadId }))).toThrow('threads.stats');
    expect(await thrown(owner.call('threads.stats', { threadId: 'thr_missing' }))).toThrow('thr_missing');
  } finally { paired.close(); agent.close(); owner.close(); }
});
