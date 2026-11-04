import { afterEach, describe, expect, test } from 'bun:test';
import type { ThreadSummary } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { Core } from '../src/core.ts';
import { WAKE_TIMING } from '../src/threads/scheduled-wakes.ts';
import { scriptedClaude, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';
import { answerEach, assistant, calls, claudeThread, harness, init, queries, runTurn, scripted, sdk, success, toolResult, useClaudeHarness } from './fixtures/claude-query.ts';

useClaudeHarness();

const timing = { ...WAKE_TIMING };
afterEach(() => { Object.assign(WAKE_TIMING, timing); });

/** A turn whose agent calls ScheduleWakeup, answered as CLI 2.1.318 answers it, then a CLI that answers every later prompt. */
function schedules(sessionId: string, inSeconds: number): void {
  scripted((fake) => {
    // Only the first CLI armed the wake; any later one answers the prompts it gets.
    if (queries.length > 1) return;
    fake.emit(init(sessionId));
    fake.emit(assistant(sessionId, [{ type: 'tool_use', id: 'toolu_wake', name: 'ScheduleWakeup', input: { delaySeconds: 60, prompt: 'check the CI again', reason: 'watching CI' } }]));
    fake.emit(toolResult(sessionId, 'toolu_wake', `Next wakeup scheduled for 13:55:00 (in ${inSeconds}s). If you owe the user a status update this tick, give it now.`));
    fake.emit(assistant(sessionId, [{ type: 'text', text: 'armed' }]));
    fake.emit(success(sessionId));
  }, (fake, prompt, index) => { if (fake !== queries[0] || index > 0) answerEach(sessionId)(fake, prompt, index); });
}

async function row(threadId: string): Promise<ThreadSummary> {
  const client = await harness.connect();
  const found = (await client.call('threads.list', {})).find(thread => thread.id === threadId);
  client.close();
  if (!found) throw new Error(`no thread ${threadId}`);
  return found;
}

describe('ScheduleWakeup in a Boite thread', () => {
  test('the wake an agent schedules opens its turn after the CLI that armed it closed', async () => {
    WAKE_TIMING.graceMs = 200;
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    schedules('sess-wake', 1);
    expect(await runTurn(client, threadId, 'pace yourself on the CI')).toBe('done');
    // The thread names its pending wake, and warmProcessMinutes 0 closes the CLI with its own timer.
    expect((await row(threadId)).wake).toMatchObject({ prompt: 'check the CI again', reason: 'watching CI', at: expect.any(Number) });
    await waitFor(() => (queries[0] as unknown as { ended: boolean }).ended);
    const woke = await client.next('turn.finished', (turn) => turn.threadId === threadId, 10_000);
    expect(woke.status).toBe('done');
    expect(woke.execution?.operation).toBe('resume');
    expect(calls.at(-1)!.prompts.at(-1)).toContain('check the CI again');
    expect((await row(threadId)).wake).toBeNull();
  });

  test('a wake survives a core restart and the next core opens it', async () => {
    WAKE_TIMING.graceMs = 60_000;
    WAKE_TIMING.startDelayMs = 50;
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    schedules('sess-wake-restart', 1);
    expect(await runTurn(client, threadId, 'pace yourself on the CI')).toBe('done');
    expect(harness.core.journal.getSetting('scheduled-wakes')).toMatchObject({ [threadId]: { wake: { prompt: 'check the CI again' } } });
    // The first core stops pacing: what fires now is the next core's.
    harness.core.wakes.close();
    const restarted = new Core({ dataDir: harness.dataDir, token: harness.token });
    // The scripted CLI stands in for the installed one, as it does for the first core.
    scriptedClaude({ core: restarted } as TestCore);
    try {
      await waitFor(() => restarted.journal.listTurns(threadId).some(turn => turn.execution?.operation === 'resume' && turn.status === 'done'), 10_000);
      expect(restarted.wakes.of(threadId)).toBeNull();
    } finally { await restarted.close(); }
  }, 20_000);

  test('a warm CLI that fires the wake itself consumes it, so the core opens no second turn', async () => {
    WAKE_TIMING.graceMs = 300;
    harness.core.settings.set({ warmProcessMinutes: 5 });
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    const sessionId = 'sess-wake-warm';
    schedules(sessionId, 1);
    expect(await runTurn(client, threadId, 'pace yourself on the CI')).toBe('done');
    const at = (await row(threadId)).wake!.at;
    const woke = client.next('turn.finished', (turn) => turn.threadId === threadId, 10_000);
    const fake = queries[0]!;
    fake.emit(sdk({ type: 'command_lifecycle', state: 'started', wakeup_source: 'loop_wakeup', scheduled_for: at, session_id: sessionId }));
    fake.emit(init(sessionId));
    fake.emit(assistant(sessionId, [{ type: 'text', text: 'WOKE' }]));
    fake.emit(success(sessionId));
    fake.emit(sdk({ type: 'command_lifecycle', state: 'completed', session_id: sessionId }));
    const turn = await woke;
    expect(turn.execution?.operation).toBe('background');
    const messages = harness.core.journal.listMessages(threadId).filter((m) => m.turnId === turn.id);
    expect(messages[0]?.parts[0]).toMatchObject({ type: 'text', displayText: 'Scheduled wake' });
    expect(messages[1]?.parts).toEqual([{ type: 'text', text: 'WOKE' }]);
    expect((await row(threadId)).wake).toBeNull();
    // Past the time and the grace: the core's own timer had nothing left to fire.
    await Bun.sleep(1_500);
    expect(harness.core.journal.listTurns(threadId).map(t => t.execution?.operation ?? 'prompt')).toEqual(['prompt', 'background']);
    expect(calls[0]!.prompts).toHaveLength(1);
  });

  test('Stop cancels the pending wake', async () => {
    WAKE_TIMING.graceMs = 200;
    const client = await harness.connect();
    const threadId = await claudeThread(client);
    schedules('sess-wake-stop', 1);
    expect(await runTurn(client, threadId, 'pace yourself on the CI')).toBe('done');
    expect((await row(threadId)).wake).not.toBeNull();
    // The owner sees it at a terminal, with when it is due.
    let out = '';
    expect(await runCli(['thread', 'show', threadId, '--core', harness.url], { out: text => { out += text; }, err: () => undefined, env: { BOITE_TOKEN: harness.token }, cwd: harness.dataDir })).toBe(0);
    await Bun.sleep(5);
    expect(out).toMatch(/wake: due \d{4}-\d\d-\d\dT[\d:.]+Z \(watching CI\)/);
    await client.call('turns.stop', { threadId });
    expect((await row(threadId)).wake).toBeNull();
    await Bun.sleep(1_500);
    expect(harness.core.journal.listTurns(threadId)).toHaveLength(1);
  });
});
