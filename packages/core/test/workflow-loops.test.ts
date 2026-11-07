import { afterEach, expect, test } from 'bun:test';
import { DEFAULT_DELEGATION_CONFIG, conditionHolds } from '@boite/contracts';
import type { DelegationConfig, WorkflowPlan, WorkflowRun } from '@boite/contracts';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnContext, TurnResult } from '../src/drivers/types.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

const cores: TestCore[] = [];
const restores: (() => void)[] = [];
afterEach(async () => { for (const h of cores.splice(0)) await h.stop(); for (const restore of restores.splice(0)) restore(); });

/** Every turn answers at once from `reply`, which sees the prompt and how many turns its thread had before. */
function scripted(reply: (ctx: TurnContext, turn: number) => string) {
  const prompts: { threadId: string; prompt: string }[] = [];
  restores.push(setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    const turn = prompts.filter(p => p.threadId === ctx.thread.id).length;
    prompts.push({ threadId: ctx.thread.id, prompt: ctx.prompt });
    let resolve!: (value: TurnResult) => void;
    const done = new Promise<TurnResult>(r => { resolve = r; });
    queueMicrotask(() => {
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: reply(ctx, turn) });
      ctx.emit.complete(id, 'complete');
      resolve({ status: 'done', sessionId: `session:${ctx.thread.id}`, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null } });
    });
    return { done, stop() {} };
  } }));
  return prompts;
}

async function setup() {
  const h = await startTestCore(); cores.push(h);
  const owner = await h.connect();
  const { threadId } = await echoThread(h, owner, 'Parent');
  const thread = h.core.threads.require(threadId);
  const config: DelegationConfig = { ...DEFAULT_DELEGATION_CONFIG, enabled: true, profiles: [
    { id: 'fast', name: 'Fast', providerId: 'echo', accountId: thread.accountId, model: thread.model!, effort: null },
  ] };
  await owner.call('delegation.configure', { threadId, config });
  return { h, owner, threadId };
}

async function settled(h: TestCore, threadId: string, runId: string): Promise<WorkflowRun> {
  await waitFor(() => ['done', 'failed', 'stopped'].includes(h.core.workflows.get(threadId, runId).status), 3000);
  return h.core.workflows.get(threadId, runId);
}

const verdict = (value: string) => '```json\n' + JSON.stringify({ verdict: value, notes: `notes ${value}` }) + '\n```';
const TASK = /Task, supplied as JSON data:\n([^\n]*)/;
const taskOf = (prompt: string) => { const m = TASK.exec(prompt); return m ? JSON.parse(m[1]!) as string : ''; };

const LOOP = (max: number): WorkflowPlan => ({ name: 'Fix until approved', steps: [
  { id: 'plan', profile: 'fast', task: 'Plan.' },
  { id: 'fix', profile: 'fast', task: 'Fix per {{plan}}.' },
  { id: 'review', profile: 'fast', after: ['fix'], task: 'Review.', output: { verdict: 'string', notes: 'string' },
    repeat: { from: 'fix', until: { path: 'review.verdict', equals: 'APPROVE' }, max } },
  { id: 'report', profile: 'fast', task: 'Report {{review.verdict}}.' },
] });

test('a loop runs its steps again in their own conversations, told why, until its condition holds', async () => {
  const prompts = scripted((ctx, turn) => {
    if (!ctx.thread.parentThreadId) return 'noted';
    const task = taskOf(ctx.prompt);
    return task === 'Review.' ? verdict(turn === 0 ? 'CHANGES' : 'APPROVE') : 'ok';
  });
  const { h, owner, threadId } = await setup();
  const run = await owner.call('workflows.start', { threadId, plan: LOOP(4), requestId: 'loop' });
  const done = await settled(h, threadId, run.id);
  expect([done.status, done.error]).toEqual(['done', null]);
  const node = (id: string) => done.nodes.find(n => n.id === id)!;
  // The steps before the loop and after it run once; the loop's steps twice, in the same conversations.
  expect(['plan', 'fix', 'review', 'report'].map(id => [id, node(id).round ?? 1, node(id).spent ?? 0])).toEqual([['plan', 1, 0], ['fix', 2, 1], ['review', 2, 1], ['report', 1, 0]]);
  const fixThread = node('fix').instances[0]!.threadId!;
  expect(node('fix').previous![0]!.threadId).toBe(fixThread);
  const fixPrompts = prompts.filter(p => p.threadId === fixThread);
  expect(fixPrompts).toHaveLength(2);
  expect(fixPrompts[1]!.prompt).toStartWith('This workflow loop runs another round, round 2 of 4, because review.verdict = "APPROVE" did not hold');
  expect(fixPrompts[1]!.prompt).toContain('notes CHANGES');
  expect(prompts.filter(p => p.threadId === node('review').instances[0]!.threadId)).toHaveLength(2);
  expect(node('report').instances[0]!.task).toBe('Report APPROVE.');
  // Usage of both rounds stays with each step, and the summary says which round ended the loop.
  expect(node('fix').instances[0]!.usage?.inputTokens).toBe(20);
  await waitFor(() => prompts.some(p => p.threadId === threadId && p.prompt.includes('Boite workflow done')));
  expect(prompts.find(p => p.threadId === threadId && p.prompt.includes('Boite workflow done'))!.prompt).toContain('"id":"review","title":"review","status":"done","round":2');
});

test('a loop out of rounds fails its closing step, is told to the parent, and a retry runs one round more', async () => {
  let approve = false;
  const prompts = scripted(ctx => !ctx.thread.parentThreadId ? 'noted' : taskOf(ctx.prompt) === 'Review.' ? verdict(approve ? 'APPROVE' : 'CHANGES') : 'ok');
  const { h, owner, threadId } = await setup();
  const run = await owner.call('workflows.start', { threadId, plan: LOOP(2), requestId: 'spent' });
  const failed = await settled(h, threadId, run.id);
  expect(failed.status).toBe('failed');
  const review = failed.nodes.find(n => n.id === 'review')!;
  expect([review.status, review.round, review.instances[0]!.status]).toEqual(['failed', 2, 'done']);
  expect(failed.error).toBe('review: review.verdict = "APPROVE" still did not hold after 2 rounds of the loop from fix; a retry runs one more round');
  expect(failed.nodes.find(n => n.id === 'report')!.status).toBe('waiting');
  await waitFor(() => prompts.some(p => p.threadId === threadId && p.prompt.includes('Boite workflow failed')));

  approve = true;
  await owner.call('workflows.control', { threadId, runId: run.id, action: 'retry', stepId: 'review' });
  const done = await settled(h, threadId, run.id);
  expect([done.status, done.nodes.find(n => n.id === 'review')!.round, done.nodes.find(n => n.id === 'report')!.status]).toEqual(['done', 3, 'done']);
  const fixThread = done.nodes.find(n => n.id === 'fix')!.instances[0]!.threadId!;
  expect(prompts.filter(p => p.threadId === fixThread).map(p => p.prompt.slice(0, 60))).toEqual([
    expect.stringContaining('You are one step'), expect.stringContaining('round 2 of 2'), expect.stringContaining('round 3 of 2'),
  ]);
});

test('every round counts toward the run\'s execution limit', async () => {
  scripted(ctx => !ctx.thread.parentThreadId ? 'noted' : taskOf(ctx.prompt) === 'Review.' ? verdict('CHANGES') : 'ok');
  const { h, owner, threadId } = await setup();
  const run = await owner.call('workflows.start', { threadId, plan: { ...LOOP(5), limits: { maxSteps: 6 } }, requestId: 'limit' });
  const failed = await settled(h, threadId, run.id);
  // plan, then fix and review three times: the third review would be the seventh execution.
  expect(failed.error).toBe('review: 1 executions would pass this run\'s limit of 6 (6 used); raise limits.maxSteps up to 64 or narrow the list');
});

test('loops and conditions are refused by field before anything starts', async () => {
  scripted(() => 'ok');
  const { owner, threadId } = await setup();
  const bad = (steps: unknown[]) => thrown(owner.call('workflows.check', { threadId, plan: { name: 'x', steps } as WorkflowPlan }));
  const review = (repeat: unknown, more: Record<string, unknown> = {}) => ({ id: 'review', task: 'r', after: ['fix'], repeat, ...more });
  const until = { path: 'review.verdict', equals: 'APPROVE' };
  expect(await bad([{ id: 'fix', task: 'f' }, review({ from: 'nope', until })])).toThrow('steps[1].repeat.from: expected this step or a step it depends on');
  expect(await bad([{ id: 'fix', task: 'f' }, { id: 'other', task: 'o' }, review({ from: 'other', until })])).toThrow('steps[2].repeat.from: "other" is not a step review depends on');
  expect(await bad([{ id: 'scan', task: 's' }, { id: 'fix', task: '{{scan}}' }, review({ from: 'fix', until: { path: 'scan.x', notEmpty: true } })])).toThrow('steps[2].repeat.until.path: scan is outside the loop from fix');
  expect(await bad([{ id: 'fix', task: 'f' }, review({ from: 'fix', until, max: 11 })])).toThrow('steps[1].repeat.max: expected an integer from 2 to 10');
  expect(await bad([{ id: 'fix', task: 'f', worktree: true }, review({ from: 'fix', until })])).toThrow('steps[0].worktree: fix runs again in the loop of review and reuses its conversation in this checkout; drop worktree');
  expect(await bad([{ id: 'fix', task: 'f' }, review({ from: 'fix', until }), { id: 'side', task: '{{fix}}' }])).toThrow('steps[2]: side reads fix, which the loop of review runs again; make it wait for review');
  expect(await bad([{ id: 'fix', task: 'f', repeat: { from: 'fix', until: { path: 'fix', notEmpty: true } } }, review({ from: 'fix', until })])).toThrow('loops do not nest');
  expect(await bad([{ id: 'a', task: 't', when: { path: 'b', in: [] } }, { id: 'b', task: 't' }])).toThrow('steps[0].when.in: expected a list of 1 to 32');
  expect(await bad([{ id: 'a', task: 't', when: { path: 'b', notEquals: 1, equals: 1 } }, { id: 'b', task: 't' }])).toThrow('exactly one of equals, notEquals, in, notEmpty or empty');
  // A step closing a loop reads its own output there, and a step after it reads the loop through it.
  expect(await owner.call('workflows.check', { threadId, plan: LOOP(3) })).toEqual({ levels: [['plan'], ['fix'], ['review'], ['report']] });
  // Without max, a loop runs 3 rounds at most.
  const self = await owner.call('workflows.start', { threadId, plan: { name: 'self', steps: [{ id: 'poll', task: 'p', repeat: { from: 'poll', until: { path: 'poll', equals: 'ready' } } }] } as never, requestId: 'self' });
  expect(self.plan.steps[0]!.repeat!.max).toBe(3);
});

test('a condition on a fanned-out path holds when every item matches, and notEquals is its negation', () => {
  const values = { review: [{ verdict: 'APPROVE' }, { verdict: 'CHANGES' }], one: 'high', none: [] };
  expect(conditionHolds({ path: 'review.verdict', equals: 'APPROVE' }, values)).toBe(false);
  expect(conditionHolds({ path: 'review.verdict', notEquals: 'APPROVE' }, values)).toBe(true);
  expect(conditionHolds({ path: 'review.verdict', in: ['APPROVE', 'CHANGES'] }, values)).toBe(true);
  expect(conditionHolds({ path: 'one', in: ['low', 'high'] }, values)).toBe(true);
  expect(conditionHolds({ path: 'one', notEquals: 'high' }, values)).toBe(false);
  // An empty list matches nothing, so no reviewer is not every reviewer approving.
  expect(conditionHolds({ path: 'none', equals: 'APPROVE' }, values)).toBe(false);
  expect(conditionHolds({ path: 'none', notEquals: 'APPROVE' }, values)).toBe(true);
});
