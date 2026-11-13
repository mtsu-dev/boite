/**
 * What a change of selection costs, on a temporary core with an echo agent
 * that records every prompt it is given: `turns` turns before the change,
 * then one on another effort, one on another account and one back on the
 * first. Prints the characters each agent was sent, which the change must not
 * move, the messages the journal holds, and the bytes of the thread a client
 * reads (`threads.get`) and of the journal's turn rows.
 * Run: bun run bench/switch-notice.ts [turns=20]
 */
import type { TurnContext, TurnResult } from '../packages/core/src/drivers/types.ts';
import { setDriver } from '../packages/core/src/drivers/index.ts';
import { echoThread, startTestCore, waitFor } from '../packages/core/test/harness.ts';

const turns = Number(process.argv[2] ?? 20);
const harness = await startTestCore();
const seen: TurnContext[] = [];
const restore = setDriver('echo', {
  protocol: 'echo',
  startTurn(ctx) {
    seen.push(ctx);
    const id = ctx.emit.startMessage('assistant');
    ctx.emit.part(id, 0, { type: 'text', text: `answer ${seen.length}: ${'word '.repeat(60)}` });
    ctx.emit.complete(id, 'complete');
    return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
  },
});
try {
  const client = await harness.connect();
  const { threadId, accountId } = await echoThread(harness, client);
  const journal = harness.core.journal;
  journal.putAccount({ ...harness.core.accounts.require(accountId), id: 'second-account', label: 'Second' });
  const run = async (prompt: string): Promise<number> => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => journal.getTurn(turn.id)?.finishedAt != null);
    return seen.at(-1)!.prompt.length;
  };
  await client.call('threads.update', { threadId, model: 'echo', effort: 'low' });
  for (let index = 0; index < turns; index++) await run(`request ${index}`);
  await client.call('threads.update', { threadId, effort: 'high' });
  const effort = await run('on another effort');
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  const account = await run('on another account');
  await client.call('threads.update', { threadId, accountId, model: 'echo' });
  const back = await run('back on the first account');

  const page = await client.call('threads.get', { threadId });
  const rows = journal.db.query('SELECT * FROM turns WHERE thread_id = ?').all(threadId) as Record<string, unknown>[];
  const dividers = page.turns.filter(turn => 'switched' in turn && turn.switched != null).length;
  console.log(JSON.stringify({
    turns: page.turns.length,
    messages: page.messages.length,
    dividers,
    promptChars: { effort, account, back },
    threadGetBytes: Buffer.byteLength(JSON.stringify(page)),
    turnRowBytes: rows.reduce((sum, row) => sum + Object.values(row).reduce<number>((size, value) => size + (value === null ? 0 : Buffer.byteLength(String(value))), 0), 0),
  }));
} finally {
  restore();
  await harness.stop();
}
