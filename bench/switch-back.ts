/**
 * What the core sends an agent when a thread goes from account A to account B
 * and back to A, on a temporary core with a scripted echo agent. Each turn's
 * answer is a text of `answerChars` and one tool output of `toolChars`. The
 * line printed gives the UTF-8 bytes of the prompt of the turn back on A and
 * whether that turn resumed A's native session. Bytes, not tokens: no
 * tokenizer runs here.
 * Run: bun run bench/switch-back.ts [turnsOnA=10] [turnsOnB=3] [answerChars=4000] [toolChars=8000]
 */
import type { TurnContext } from '../packages/core/src/drivers/types.ts';
import { setDriver } from '../packages/core/src/drivers/index.ts';
import { echoThread, startTestCore, waitFor } from '../packages/core/test/harness.ts';

const arg = (at: number, fallback: number): number => Number(process.argv[2 + at] ?? fallback);
const turnsOnA = arg(0, 10), turnsOnB = arg(1, 3), answerChars = arg(2, 4000), toolChars = arg(3, 8000);
const harness = await startTestCore();
const seen: TurnContext[] = [];
const restore = setDriver('echo', {
  protocol: 'echo',
  startTurn(ctx) {
    seen.push(ctx);
    const id = ctx.emit.startMessage('assistant');
    const letter = String.fromCharCode(97 + seen.length % 26);
    ctx.emit.part(id, 0, { type: 'tool', toolId: `call-${seen.length}`, name: 'Read', input: { turn: seen.length }, status: 'done', output: letter.repeat(toolChars) });
    ctx.emit.part(id, 1, { type: 'text', text: `answer ${seen.length} `.padEnd(answerChars, letter) });
    ctx.emit.complete(id, 'complete');
    return { stop() {}, done: Promise.resolve({ status: 'done', sessionId: ctx.sessionId ?? `native-${ctx.account.id}-${seen.length}`, usage: null }) };
  },
});
try {
  const client = await harness.connect();
  const { threadId, accountId } = await echoThread(harness, client);
  harness.core.journal.putAccount({ ...harness.core.accounts.require(accountId), id: 'bench-second', label: 'Second' });
  const run = async (prompt: string): Promise<TurnContext> => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => harness.core.journal.getTurn(turn.id)?.finishedAt != null, 10_000);
    return seen.at(-1)!;
  };
  const request = (index: number): string => `request ${index}: `.padEnd(400, 'r');
  for (let index = 0; index < turnsOnA; index++) await run(request(index));
  await client.call('threads.update', { threadId, accountId: 'bench-second', model: 'echo' });
  const toB = await run(request(turnsOnA));
  for (let index = 1; index < turnsOnB; index++) await run(request(turnsOnA + index));
  await client.call('threads.update', { threadId, accountId, model: 'echo' });
  const back = await run('back on the first account');
  const bytes = (ctx: TurnContext): number => Buffer.byteLength(ctx.prompt, 'utf8');
  console.log(JSON.stringify({
    turnsOnA, turnsOnB, answerChars, toolChars,
    switchToB: { promptBytes: bytes(toB), resumed: toB.sessionId !== null },
    backToA: { promptBytes: bytes(back), resumed: back.sessionId !== null, sessionId: back.sessionId },
  }));
} finally {
  restore();
  await harness.stop();
}
