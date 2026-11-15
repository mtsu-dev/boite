import { afterEach, expect, spyOn, test } from 'bun:test';
import type { ThreadActivity, Turn } from '@boite/contracts';
import { QUESTION_GRACE_MS } from '../src/agents/projects.ts';
import { EVENT_HEADER, EVENT_PROMPT_MAX, NOTICE_BATCH_MS } from '../src/agents/runtime.ts';
import { cutAnswer, DEFERRED_ANSWER, TURN_PACE_MS } from '../src/agents/wake-pace.ts';
import { connect } from '../src/client.ts';
import { makeAgent, scripted, settled, turnsOf } from './agent-fixture.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

const cores: TestCore[] = [];
const restores: (() => void)[] = [];
afterEach(async () => { for (const h of cores.splice(0)) await h.stop(); for (const restore of restores.splice(0)) restore(); });

interface Held { key: string; text: string; at: number; notBefore: number; paced?: string; tries?: number }

/**
 * A mochi with the project of its `worker` thread, which it follows. Its wakes
 * end `[quiet]` unless `speak` is set; a thread's prompt with HOLD runs until
 * released, one with FAIL-ME fails.
 */
async function setup() {
  const state = { speak: false };
  const driver = scripted(ctx => ctx.prompt.includes(EVENT_HEADER)
    ? { text: state.speak ? 'Thread done: the user should look at it.' : '[quiet] read the events' }
    : { text: `Answered ${ctx.prompt}`, hold: ctx.prompt.includes('HOLD'), status: ctx.prompt.includes('FAIL-ME') ? 'error' : 'done' });
  restores.push(driver.restore);
  const h = await startTestCore(); cores.push(h);
  const owner = await h.connect();
  const { threadId: worker } = await echoThread(h, owner, 'Worker');
  const project = h.core.threads.require(worker).projectId!;
  const { agent, threadId: self } = await makeAgent(h, owner, { projectIds: [project] });
  h.core.workforce.watch({ agentId: agent.id, watchThreadId: worker, watched: true });
  const pending = () => (h.core.agentRuntime as unknown as { pending: Map<string, { facts: Held[] }> }).pending.get(agent.id)?.facts ?? [];
  const turnFacts = () => pending().filter(fact => fact.key.startsWith('turn:'));
  const hurry = () => { for (const fact of pending()) fact.notBefore = 0; (h.core.agentRuntime as unknown as { tick(): void }).tick(); };
  const wakes = () => turnsOf(h, self).filter(turn => turn.execution?.operation === 'event');
  const run = async (prompt: string) => {
    const count = turnsOf(h, worker).length;
    await owner.call('turns.start', { threadId: worker, prompt });
    await waitFor(() => turnsOf(h, worker).length > count && settled(h, worker));
    return turnsOf(h, worker).at(-1)!;
  };
  return { h, owner, agent, self, worker, state, driver, pending, turnFacts, hurry, wakes, run };
}

test('ten [quiet] turns of a followed thread wake its mochi once per step, one fact per thread, and a wake that speaks brings the first step back', async () => {
  const { h, self, state, turnFacts, hurry, wakes, run } = await setup();
  const before = wakes().length;
  const delays: number[] = [];
  for (let pair = 0; pair < 5; pair++) {
    const first = await run(`Build ${pair}a`);
    await waitFor(() => turnFacts().some(fact => fact.key === `turn:${first.id}`));
    const due = turnFacts()[0]!;
    delays.push(due.notBefore - due.at);
    // The thread's next turn takes the place of the one that waits, and waits no longer than it did.
    const second = await run(`Build ${pair}b`);
    await waitFor(() => turnFacts().some(fact => fact.key === `turn:${second.id}`));
    expect(turnFacts()).toHaveLength(1);
    expect(turnFacts()[0]).toMatchObject({ at: due.at, notBefore: due.notBefore });
    hurry();
    await waitFor(() => wakes().length === before + pair + 1 && settled(h, self));
    expect(wakes().at(-1)!.quiet).toBe(true);
  }
  expect(delays).toEqual([TURN_PACE_MS[0], TURN_PACE_MS[1], TURN_PACE_MS[2], TURN_PACE_MS[3], TURN_PACE_MS[3]]);
  expect(wakes()).toHaveLength(before + 5);
  // A wake that speaks: the thread's next turn waits the first step again.
  state.speak = true;
  await run('Build more');
  hurry();
  await waitFor(() => wakes().length === before + 6 && settled(h, self));
  expect(wakes().at(-1)!.quiet).toBeFalsy();
  const next = await run('Build again');
  await waitFor(() => turnFacts().some(fact => fact.key === `turn:${next.id}`));
  expect(turnFacts()[0]!.notBefore - turnFacts()[0]!.at).toBe(TURN_PACE_MS[0]);
}, 30_000);

test('a failure, a question and a merged pull request keep their own delay whatever the thread\'s pace', async () => {
  const { h, agent, worker, self, turnFacts, pending, hurry, wakes, run } = await setup();
  const before = wakes().length;
  for (let step = 0; step < 3; step++) {
    await run(`Build ${step}`);
    await waitFor(() => turnFacts().length === 1);
    hurry();
    await waitFor(() => wakes().length === before + step + 1 && settled(h, self));
  }
  const paced = await run('Build paced');
  await waitFor(() => turnFacts().some(fact => fact.key === `turn:${paced.id}`));
  expect(turnFacts()[0]!.notBefore - turnFacts()[0]!.at).toBe(TURN_PACE_MS[3]);
  // A failure replaces nothing and waits only the batch delay.
  const failed = await run('FAIL-ME now');
  await waitFor(() => turnFacts().some(fact => fact.key === `turn:${failed.id}`));
  const failure = turnFacts().find(fact => fact.key === `turn:${failed.id}`)!;
  expect(failure.paced).toBeUndefined();
  expect(failure.notBefore - failure.at).toBe(NOTICE_BATCH_MS);
  expect(turnFacts()).toHaveLength(2);
  // A question in a followed thread waits the batch delay, a merged pull request what its notice asks.
  const asker = await connect(h.url, h.core.agents.tokenFor(worker));
  try {
    const { questionId } = await asker.call('questions.ask', { threadId: worker, text: 'Merge now?', options: ['Yes', 'No'] });
    await waitFor(() => pending().some(fact => fact.key === `ask:${questionId}`));
    const ask = pending().find(fact => fact.key === `ask:${questionId}`)!;
    expect(ask.notBefore - ask.at).toBeLessThanOrEqual(QUESTION_GRACE_MS);
    expect(ask.notBefore - ask.at).toBeLessThan(TURN_PACE_MS[3]);
  } finally { asker.close(); }
  const profile = h.core.workforce.records.get('profile', agent.id);
  expect(h.core.workforce.projects.notify(profile, `pr-merged:${worker}`, `Pull request of thread ${worker} merged.`, 0, [worker])).toBe(true);
  const merged = pending().find(fact => fact.key === `pr-merged:${worker}`)!;
  expect(merged.notBefore - merged.at).toBe(0);
}, 30_000);

test('a turn after which the thread goes on by itself is not told: next turn sent meanwhile, autonomous operation, goal at work', async () => {
  const { h, self, worker, owner, driver, turnFacts, hurry, wakes, run } = await setup();
  // The user's next message (a queued one, sent by the app once the turn ended) starts before the fact is due:
  // the fact waits while the thread works, and the turn it stops on takes its place.
  const before = wakes().length;
  const first = await run('first');
  await waitFor(() => turnFacts().some(fact => fact.key === `turn:${first.id}`));
  await owner.call('turns.start', { threadId: worker, prompt: 'HOLD then this' });
  await waitFor(() => driver.held.length === 1);
  const second = turnsOf(h, worker).at(-1)!;
  hurry();
  await Bun.sleep(700);
  expect(wakes()).toHaveLength(before);
  driver.release();
  await waitFor(() => settled(h, worker) && turnFacts().some(fact => fact.key === `turn:${second.id}`));
  expect(turnFacts()).toHaveLength(1);
  hurry();
  await waitFor(() => wakes().length === before + 1 && settled(h, self));
  const prompt = driver.prompts.get(self)!.at(-1)!;
  expect(prompt).toContain(`turn:${second.id}`);
  expect(prompt).not.toContain(`turn:${first.id}`);

  // Held, so the facts stay where the test reads them.
  h.core.workforce.setLimits({ paused: true });
  const told = spyOn(h.core.agentRuntime, 'fact');
  const keys = () => told.mock.calls.map(([, fact]) => fact.key);  // The same turn, as the operations that run by themselves would have ended it.
  const finished = h.core.journal.getTurn(second.id)!;
  const as = (id: string, operation?: NonNullable<Turn['execution']>['operation']) => ({ ...finished, id, execution: operation ? { ...finished.execution!, operation } : finished.execution } as Turn);
  const emit = async (turn: Turn) => { h.core.bus.emit('turn.finished', turn); await Bun.sleep(0); };
  await emit(as('trn_pull_request', 'pull-request'));
  // A letter from another agent: the thread answers it by letter. One from the mochi itself is told (`agents-projects.test.ts`).
  await emit(as('trn_coordination', 'coordination'));
  await emit(as('trn_background', 'background'));
  const goal = spyOn(h.core.activity, 'get').mockReturnValue({ goal: { status: 'active' } } as ThreadActivity);
  try {
    await emit(as('trn_goal'));
    goal.mockReturnValue({ goal: { status: 'active', review: { phase: 'reviewing' } } } as ThreadActivity);
    await emit(as('trn_reviewed'));
  } finally { goal.mockRestore(); }
  await emit({ ...as('trn_pull_request_failed', 'pull-request'), status: 'error' });
  expect(keys()).not.toContain('turn:trn_pull_request');
  expect(keys()).not.toContain('turn:trn_coordination');
  expect(keys()).not.toContain('turn:trn_goal');
  // A background job's end, a goal waiting on its reviewer and any failure are where the thread stopped.
  expect(keys()).toEqual(expect.arrayContaining(['turn:trn_background', 'turn:trn_reviewed', 'turn:trn_pull_request_failed']));
  expect(turnFacts().map(fact => fact.key)).toContain('turn:trn_pull_request_failed');
  told.mockRestore();
}, 30_000);

test('a routine carries the latest fact of each thread under the event cap and counts the threads it leaves out', async () => {
  const { h, owner, agent, self, worker } = await setup();
  const config = await owner.call('agents.runtime.get', { agentId: agent.id });
  await owner.call('agents.runtime.configure', { agentId: agent.id, expectedRevision: h.core.workforce.records.get('profile', agent.id).revision, config: { ...config, eventWakes: false } });
  const runtime = h.core.agentRuntime;
  runtime.fact(agent.id, { urgent: false, key: 'turn:old', text: 'THREAD_0_OLD', threadIds: [], paced: 'thr_0' });
  for (let i = 0; i < 80; i++) runtime.fact(agent.id, { urgent: false, key: `turn:${i}`, text: `THREAD_${i}_LATEST ${'x'.repeat(400)}`, threadIds: [], paced: `thr_${i}` });
  // A paced fact replaced the one of its thread: 80 wait.
  expect(runtime.facts(agent.id)).toHaveLength(80);
  // Two facts of one thread: the routine carries the latest.
  runtime.fact(agent.id, { urgent: false, key: 'checks:older', text: 'WORKER_OLDER', threadIds: [worker] });
  runtime.fact(agent.id, { urgent: false, key: 'checks:latest', text: 'WORKER_LATEST', threadIds: [worker] });
  runtime.fact(agent.id, { urgent: false, key: 'note', text: 'UNTHREADED_NOTE', threadIds: [] });
  const turn = runtime.start(agent, { kind: 'routine', label: 'Morning', prompt: 'Catch up.' });
  await waitFor(() => settled(h, self));
  const prompt = h.core.journal.listMessages(self).find(m => m.turnId === turn.id && m.role === 'system')!.parts.flatMap(p => p.type === 'text' ? [p.text] : []).join('');
  const events = prompt.slice(prompt.indexOf(EVENT_HEADER));
  expect(events.length).toBeLessThanOrEqual(EVENT_PROMPT_MAX);
  expect(events).toContain('UNTHREADED_NOTE');
  expect(events).toContain('WORKER_LATEST');
  expect(events).not.toContain('WORKER_OLDER');
  expect(events).toContain('THREAD_79_LATEST');
  expect(events).not.toContain('THREAD_0_OLD');
  expect(events).not.toContain('THREAD_0_LATEST');
  const listed = [...events.matchAll(/THREAD_(\d+)_LATEST/g)].length;
  expect(events).toContain(`${80 - listed} other threads changed too and are not listed here: \`boite threads\``);
  expect(runtime.facts(agent.id)).toHaveLength(0);
}, 30_000);

test('a fact for the next routine quotes the start of the answer and says where the rest is', async () => {
  const { h, owner, agent } = await setup();
  const long = `${'word '.repeat(200)}END`;
  const cut = cutAnswer(long, 'thr_worker');
  expect(cut).toBe(`${long.slice(0, DEFERRED_ANSWER - 3)}... (the rest: boite threads read thr_worker)`);
  expect(cutAnswer('Short answer.', 'thr_worker')).toBe('Short answer.');
  // A deferred fact keeps the brief, one that wakes the mochi the whole text.
  const runtime = h.core.agentRuntime;
  runtime.fact(agent.id, { urgent: true, key: 'turn:urgent', text: 'WHOLE', brief: 'BRIEF', threadIds: [] });
  expect(runtime.facts(agent.id).find(f => f.key === 'turn:urgent')!.text).toBe('WHOLE');
  const config = await owner.call('agents.runtime.get', { agentId: agent.id });
  await owner.call('agents.runtime.configure', { agentId: agent.id, expectedRevision: h.core.workforce.records.get('profile', agent.id).revision, config: { ...config, eventWakes: false } });
  runtime.fact(agent.id, { urgent: false, key: 'turn:later', text: 'WHOLE', brief: 'BRIEF', threadIds: [] });
  expect(runtime.facts(agent.id).find(f => f.key === 'turn:later')!.text).toBe('BRIEF');
}, 30_000);
