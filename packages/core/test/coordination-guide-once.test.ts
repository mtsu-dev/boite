import { afterEach, beforeEach, expect, test } from 'bun:test';
import { SHORT_ANSWERS } from '../src/agent-guide.ts';
import { setDriver } from '../src/drivers/index.ts';
import { echoDriver } from '../src/drivers/echo.ts';
import { CAPACITY_CONTINUE_PROMPT, CAPACITY_RETRY } from '../src/threads/turn-attempts.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let h: TestCore;
beforeEach(async () => { h = await startTestCore({ boiteGuide: true }); });
afterEach(async () => { await h.stop(); });

const GUIDE = 'Boite coordination';

test('the coordination guide goes once a native session: again when it changes, after a compaction, a failed turn or a new account, and in a continuation', async () => {
  const owner = await h.connect();
  h.core.settings.set({ shortAnswers: true });
  const { threadId } = await echoThread(h, owner);
  const prompts: string[] = [];
  let continuation = null as string | null;
  let directive = 'Hello';
  const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
    prompts.push(ctx.prompt);
    if (ctx.prompt.includes('Continue me')) continuation = ctx.continuation?.().prompt ?? null;
    // Echo plays the directive of this turn alone: a fresh session's prompt also carries the history.
    const play = ctx.turn.execution?.operation === 'compact' || ctx.prompt === CAPACITY_CONTINUE_PROMPT ? ctx.prompt : directive;
    return echoDriver.startTurn({ ...ctx, prompt: play });
  } });
  const run = async (prompt: string, play = 'Hello') => {
    directive = play;
    const turn = await owner.call('turns.start', { threadId, prompt });
    await waitFor(() => ['done', 'error'].includes(h.core.journal.listTurns(threadId).find(t => t.id === turn.id)?.status ?? ''));
    return prompts.at(-1)!;
  };
  const pause = (paused: boolean) => { h.core.coordination.configure(threadId, { ...h.core.coordination.config(threadId), paused }); };
  try {
    const first = await run('First');
    expect(first).toContain(GUIDE);
    // Twenty turns of one session: the guide rode on every one of them before.
    const guide = h.core.coordination.instructions(threadId);
    expect(first).toContain(guide);
    const before = prompts.length;
    for (let index = 2; index <= 20; index++) {
      const prompt = await run(`Turn ${index}`);
      expect(prompt).not.toContain(GUIDE);
      // What changes with each message stays on every turn.
      expect(prompt).toContain(SHORT_ANSWERS);
      expect(prompt).toContain(`Turn ${index}`);
    }
    const sent = [first, ...prompts.slice(before)].reduce((sum, prompt) => sum + prompt.length, 0);
    const saved = 19 * guide.length;
    console.log(`20 turns: ${sent} characters of prompts, ${sent + saved} with the guide on each (${guide.length} characters, about ${Math.ceil(guide.length / 4)} tokens): ${saved} characters saved, about ${Math.ceil(saved / 4)} tokens`);
    // The native session holds it, so a driver's fresh start is the one that must carry it.
    expect(await run('Continue me')).not.toContain(GUIDE);
    expect(continuation).toContain(guide);
    // The text changes: paused by the user, then resumed.
    pause(true);
    expect(await run('Paused')).toContain('Boite coordination (paused by the user)');
    expect(await run('Still paused')).not.toContain(GUIDE);
    pause(false);
    expect(await run('Resumed')).toContain(`${GUIDE}:`);
    expect(await run('Unchanged')).not.toContain(GUIDE);
    // The agent compacted by itself during the turn: the summary does not hold the guide.
    await run('Long work', '[compact]');
    expect(await run('After auto compaction')).toContain(GUIDE);
    expect(await run('Held again')).not.toContain(GUIDE);
    await owner.call('threads.compact', { threadId });
    await waitFor(() => h.core.journal.listTurns(threadId).some(t => t.execution?.operation === 'compact' && t.status === 'done'));
    expect(await run('After compaction')).toContain(GUIDE);
    expect(await run('Held once more')).not.toContain(GUIDE);
    // A turn that failed while carrying a changed guide may never have handed it over: the session is not marked.
    pause(true);
    expect(await run('Fails', '[error]')).toContain('(paused by the user)');
    expect(await run('After the failure')).toContain('(paused by the user)');
    expect(await run('Quiet again')).not.toContain(GUIDE);
    // A retry at capacity continues on a short prompt: what the session held before stands, the change comes next.
    pause(false);
    const delays = CAPACITY_RETRY.delaysMs;
    CAPACITY_RETRY.delaysMs = [40, 40, 40];
    try { await run('Busy model', 'first half [capacity:1] second half'); } finally { CAPACITY_RETRY.delaysMs = delays; }
    expect(prompts.at(-1)).toBe(CAPACITY_CONTINUE_PROMPT);
    expect(await run('After the capacity wait')).toContain(`${GUIDE}:`);
    expect(await run('Settled')).not.toContain(GUIDE);
    // Another account is another native session.
    const spare = await owner.call('accounts.add', { providerId: 'echo', label: 'Spare' });
    await owner.call('threads.update', { threadId, accountId: spare.id });
    expect(await run('On the spare account')).toContain(GUIDE);
    expect(await run('Settled on the spare')).not.toContain(GUIDE);
  } finally { restore(); }
}, 60_000);
