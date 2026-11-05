import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { DEFAULT_DELEGATION_CONFIG } from '@boite/contracts';
import { makeAgent } from './agent-fixture.ts';
import type { CoreClient } from '../src/client.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { AUTO_COMPACT } from '../src/threads/auto-compact.ts';
import { BACKGROUND_COMPACT } from '../src/threads/background-compact.ts';
import { setDriver } from '../src/drivers/index.ts';
import { echoDriver } from '../src/drivers/echo.ts';
import type { StepBoundary, TurnContext, TurnHandle } from '../src/drivers/types.ts';

let h: TestCore;
const saved = { compact: { ...AUTO_COMPACT }, background: { ...BACKGROUND_COMPACT } };
beforeEach(async () => {
  AUTO_COMPACT.settleMs = 20;
  // Echo reads 100 tokens plus one per character: a limit of 1000 starts a copy from 850.
  BACKGROUND_COMPACT.minTokens = 0;
  h = await startTestCore();
});
afterEach(async () => {
  await h.stop();
  Object.assign(AUTO_COMPACT, saved.compact);
  Object.assign(BACKGROUND_COMPACT, saved.background);
});

/** The copy runs under its own key, so its turns are told apart from the thread's. */
const isCopy = (ctx: TurnContext) => ctx.thread.id.endsWith('~compact');

async function turn(client: CoreClient, threadId: string, prompt: string): Promise<void> {
  const done = client.next('turn.finished', t => t.threadId === threadId);
  await client.call('turns.start', { threadId, prompt });
  await done;
}
const compactions = async (client: CoreClient, threadId: string) =>
  (await client.call('threads.get', { threadId })).turns.filter(t => t.execution?.operation === 'compact');
async function setUp(client: CoreClient): Promise<string> {
  await client.call('brain.configure', { path: null, enabled: false, boiteGuide: false });
  const { threadId } = await echoThread(h, client);
  await client.call('settings.set', { autoCompact: { tokens: 1000, moments: ['turn-end'] }, backgroundCompaction: true });
  return threadId;
}

/** The subagent policy of the in-turn tests: a limit of 1000, no idle moment, the copy on. */
const SUBAGENT_POLICY = { autoCompact: { tokens: 1000, moments: [] }, backgroundCompaction: true };

/** A delegated child of a fresh parent, its first and only turn running `task`. */
async function child(client: CoreClient, task: string): Promise<{ parentId: string; childId: string }> {
  const parentId = await setUp(client);
  await client.call('settings.set', { autoCompact: null, backgroundCompaction: false, compactionByType: { subagent: SUBAGENT_POLICY } });
  const { accountId, model } = h.core.threads.require(parentId);
  await client.call('delegation.configure', { threadId: parentId, config: { ...DEFAULT_DELEGATION_CONFIG, enabled: true,
    profiles: [{ id: 'worker', name: 'Worker', providerId: 'echo', accountId, model: model!, effort: null }] } });
  const spawned = await client.call('delegation.spawn', { threadId: parentId, profileId: 'worker', task, requestId: `long-${Date.now()}` });
  return { parentId, childId: spawned.thread.id };
}

/** One echo turn's worth of tool calls: each adds 25 tokens to the context the next request carries. */
const TOOLS = (count: number) => '[tool]'.repeat(count);

/** A copy held until `release`, whose `stop` only counts: a test chooses when it ends. */
function heldCopy(): { run: (ctx: TurnContext) => TurnHandle; release: () => void; started: () => number; stops: () => number } {
  const gate = Promise.withResolvers<void>();
  let started = 0;
  let stops = 0;
  return {
    run: ctx => { started += 1; return { done: gate.promise.then(() => echoDriver.startTurn(ctx).done), stop: () => { stops += 1; } }; },
    release: () => gate.resolve(),
    started: () => started,
    stops: () => stops,
  };
}

interface LongTurn {
  /** How a copy runs; echo's own by default. */
  copy?: (ctx: TurnContext) => TurnHandle;
  /** Called before each step of the child's turn with what the agent reports there; returns what goes to the core. */
  boundary?: (boundary: StepBoundary, threadId: string) => StepBoundary;
}

/** A delegated child runs `task` as its one long turn, every step recorded. */
async function longTurn(client: CoreClient, task: string, options: LongTurn = {}) {
  const steps: { tokens: number; swapped: boolean }[] = [];
  const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
    if (isCopy(ctx)) return (options.copy ?? echoDriver.startTurn)(ctx);
    const step = ctx.step;
    if (step === undefined || h.core.journal.getThread(ctx.thread.id)?.parentThreadId == null) return echoDriver.startTurn(ctx);
    // The fake agent reads the task alone: the delegation guide around it would start the context past the limit.
    return echoDriver.startTurn({ ...ctx, prompt: task, step: async reported => {
      const boundary = options.boundary?.(reported, ctx.thread.id) ?? reported;
      const decision = await step(boundary);
      steps.push({ tokens: boundary.tokens, swapped: decision !== null });
      return decision;
    } });
  } });
  try {
    const done = client.next('turn.finished', t => t.threadId !== undefined && h.core.journal.getThread(t.threadId)?.parentThreadId != null);
    const { childId } = await child(client, task);
    const turn = await done;
    const thread = await client.call('threads.get', { threadId: childId });
    const background = thread.messages.filter(m => m.turnId === turn.id).flatMap(m => m.parts).filter(p => p.type === 'compaction' && p.background === true);
    return { childId, turn, thread, steps, background };
  } finally { restore(); }
}

describe('background compaction', () => {
  test('a single long turn crosses the limit and takes its copy before the turn ends', async () => {
    const swaps: { turnId: string | null; generation: number; tail: string; sessionId: string }[] = [];
    const prompts: { threadId: string; prompt: string }[] = [];
    const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
      if (isCopy(ctx) || ctx.step === undefined) return echoDriver.startTurn(ctx);
      prompts.push({ threadId: ctx.thread.id, prompt: ctx.prompt });
      const step = ctx.step;
      // The fake agent reads the task alone: the delegation guide around it would start the context past the limit.
      return echoDriver.startTurn({ ...ctx, prompt: TOOLS(40), step: async boundary => {
        const decision = await step(boundary);
        if (decision !== null) {
          const thread = h.core.journal.getThread(ctx.thread.id)!;
          swaps.push({ turnId: h.core.journal.runningTurn(ctx.thread.id)?.id ?? null, generation: thread.sessionGeneration ?? 0, tail: decision.swap.tail, sessionId: decision.swap.sessionId });
        }
        return decision;
      } });
    } });
    const finished = spyOn(h.core.threads.spawns, 'finished');
    const client = await h.connect();
    try {
      const done = client.next('turn.finished', t => t.threadId !== undefined && h.core.journal.getThread(t.threadId)?.parentThreadId != null);
      const { childId } = await child(client, TOOLS(40));
      const turn = await done;
      expect(turn.threadId).toBe(childId);
      // The context passed 850 tokens and then 1000 inside this one turn: the copy was taken while it ran.
      expect(swaps).toHaveLength(1);
      const swap = swaps[0]!;
      expect(swap.turnId).toBe(turn.id);
      expect(swap.generation).toBe(1);
      const thread = await client.call('threads.get', { threadId: childId });
      const source = `echo-${childId}`;
      expect(swap.sessionId.startsWith(`${source}~`)).toBe(true);
      expect(thread.sessionId).toBe(swap.sessionId);
      expect(thread.sessionGeneration).toBe(1);
      // The divider sits in this turn's own messages, and the turn went on after it on the compacted session.
      const own = thread.messages.filter(m => m.turnId === turn.id);
      const at = own.findIndex(m => m.parts.some(p => p.type === 'compaction'));
      expect(own[at]!.parts.find(p => p.type === 'compaction')).toMatchObject({ type: 'compaction', trigger: 'auto', postTokens: 300, background: true });
      expect(own.slice(at + 1).flatMap(m => m.parts).filter(p => p.type === 'tool').length).toBeGreaterThan(0);
      // The compacted session's first message is what happened since the copy, tools included.
      expect(swap.tail).toContain('<recent-history>');
      expect(swap.tail).toContain('[Assistant tool call]: fake_tool');
      expect(swap.tail.endsWith('Continue the current task.')).toBe(true);
      expect(thread.context?.tokens).toBeLessThan(850);
      expect(await compactions(client, childId)).toEqual([]);
      expect(turn.status).toBe('done');
      expect(finished.mock.calls.filter(([t]) => t.threadId === childId)).toHaveLength(1);
      // Only one prompt opened the turn: the tail was not held back for the next one.
      expect(prompts.filter(p => p.threadId === childId)).toHaveLength(1);
      expect(h.core.journal.getSetting(`compaction-tail:${childId}`)).toBeUndefined();
    } finally { finished.mockRestore(); restore(); client.close(); }
  });

  test('a copy still running when the context reaches the limit is awaited, then taken', async () => {
    const copy = heldCopy();
    const client = await h.connect();
    try {
      const run = await longTurn(client, TOOLS(40), {
        copy: copy.run,
        // The copy ends only once the step at the limit is waiting for it.
        boundary: boundary => { if (boundary.tokens >= 1000) setTimeout(copy.release, 50); return boundary; },
      });
      expect(copy.started()).toBe(1);
      // The first step at the limit (1015 tokens) waited and took it, rather than going on without it.
      expect(run.steps.filter(step => step.swapped)).toEqual([{ tokens: 1015, swapped: true }]);
      expect(run.background).toHaveLength(1);
      expect(run.thread.sessionGeneration).toBe(1);
      expect(run.turn.status).toBe('done');
    } finally { copy.release(); client.close(); }
  });

  test('a copy that fails gives no swap, and the turn still finishes', async () => {
    let copies = 0;
    const client = await h.connect();
    try {
      const run = await longTurn(client, TOOLS(40), {
        copy: ctx => { copies += 1; return { done: Promise.resolve({ status: 'error' as const, sessionId: ctx.sessionId, usage: null, error: 'copy refused' }), stop: () => undefined }; },
      });
      expect(copies).toBeGreaterThan(0);
      // Two failures in a row and the thread stops trying.
      expect(copies).toBeLessThanOrEqual(BACKGROUND_COMPACT.maxFailures);
      expect(run.steps.some(step => step.swapped)).toBe(false);
      expect(run.background).toEqual([]);
      expect(run.turn.status).toBe('done');
      expect(run.thread.sessionGeneration ?? 0).toBe(0);
    } finally { client.close(); }
  });

  test('a copy of a context that shrank since is dropped', async () => {
    const copy = heldCopy();
    const client = await h.connect();
    try {
      let inTurn = -1;
      // From 940 tokens on, the agent reports less than when the copy started at 865.
      const run = await longTurn(client, TOOLS(40), { copy: copy.run, boundary: boundary => {
        // The next step: the copy was already stopped, inside the turn.
        if (boundary.tokens === 965) inTurn = copy.stops();
        return boundary.tokens >= 940 ? { ...boundary, tokens: 600 } : boundary;
      } });
      expect(copy.started()).toBe(1);
      expect(inTurn).toBe(1);
      expect(copy.stops()).toBe(1);
      copy.release();
      await Bun.sleep(100);
      expect(run.steps.some(step => step.swapped)).toBe(false);
      expect(h.core.journal.getThread(run.childId)!.sessionGeneration ?? 0).toBe(0);
    } finally { copy.release(); client.close(); }
  });

  test('a native compaction inside the turn drops the copy, and one that finishes later is thrown away', async () => {
    const copy = heldCopy();
    const client = await h.connect();
    try {
      // The copy starts at 857 tokens, then the agent compacts by itself at 882 and goes on from 300.
      let inTurn = -1;
      const run = await longTurn(client, `${TOOLS(23)}[compact]${TOOLS(10)}`, { copy: copy.run, boundary: boundary => {
        // The first step after the compaction, before the core sees its smaller context: the part alone dropped the copy.
        if (boundary.tokens === 325) inTurn = copy.stops();
        return boundary;
      } });
      expect(copy.started()).toBe(1);
      expect(inTurn).toBe(1);
      expect(copy.stops()).toBe(1);
      const parts = run.thread.messages.filter(m => m.turnId === run.turn.id).flatMap(m => m.parts).filter(p => p.type === 'compaction');
      expect(parts.map(p => p.type === 'compaction' && p.background === true)).toEqual([false]);
      // The dropped copy now finishes: its summary is never applied.
      const sessionId = h.core.journal.getThread(run.childId)!.sessionId;
      copy.release();
      await Bun.sleep(100);
      expect(run.steps.some(step => step.swapped)).toBe(false);
      const thread = h.core.journal.getThread(run.childId)!;
      expect(thread.sessionGeneration ?? 0).toBe(0);
      expect(thread.sessionId).toBe(sessionId);
    } finally { copy.release(); client.close(); }
  });

  test('background work in flight at the limit keeps the copy from being taken', async () => {
    const client = await h.connect();
    try {
      const run = await longTurn(client, TOOLS(40), {
        boundary: (boundary, threadId) => {
          if (boundary.tokens === 990) h.core.threads.agentState.noteBackground(threadId, [{ id: 'bg1', kind: 'shell', description: 'watch', toolId: null, startedAt: Date.now() }]);
          return boundary;
        },
      });
      expect(run.steps.some(step => step.swapped)).toBe(false);
      expect(run.background).toEqual([]);
      expect(run.turn.status).toBe('done');
      expect(run.thread.sessionGeneration ?? 0).toBe(0);
    } finally { client.close(); }
  });

  test('a copy compacts near the limit and the thread takes it at the next pause, then sends what came after', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const prompts: string[] = [];
    // A driver that cannot swap inside a turn takes its copy at the pause.
    const restore = setDriver('echo', { ...echoDriver, capabilities: {}, startTurn(ctx) {
      if (!isCopy(ctx)) { prompts.push(ctx.prompt); return echoDriver.startTurn({ ...ctx, step: undefined }); }
      // The copy waits until the conversation went on without it.
      let stopped = false;
      const done = gate.then(() => stopped ? { status: 'stopped' as const, sessionId: ctx.sessionId, usage: null } : echoDriver.startTurn(ctx).done);
      return { done, stop: () => { stopped = true; release(); } };
    } });
    const client = await h.connect();
    try {
      const threadId = await setUp(client);
      await turn(client, threadId, 'x'.repeat(760));
      const source = h.core.journal.getThread(threadId)!;
      expect(source.context?.tokens).toBe(860);
      const cut = h.core.journal.lastTurn(threadId)!.id;
      // The thread stays free while its copy runs.
      await turn(client, threadId, `meanwhile ${'y'.repeat(760)}`);
      expect(h.core.journal.getThread(threadId)!.sessionId).toBe(source.sessionId);
      release();
      await waitFor(() => (h.core.journal.getThread(threadId)!.sessionGeneration ?? 0) === (source.sessionGeneration ?? 0) + 1);
      const swapped = await client.call('threads.get', { threadId });
      // The fork the copy compacted, taken without a compaction turn.
      expect(swapped.sessionId).toBe(`${source.sessionId}~${cut}`);
      expect(swapped.context?.tokens).toBe(300);
      expect(await compactions(client, threadId)).toEqual([]);
      const divider = swapped.messages.flatMap(m => m.parts).find(p => p.type === 'compaction');
      expect(divider).toMatchObject({ type: 'compaction', trigger: 'auto', postTokens: 300, background: true });

      await turn(client, threadId, 'next request');
      const carried = prompts.at(-1)!;
      expect(carried).toContain('<recent-history>');
      expect(carried).toContain('meanwhile');
      expect(carried).not.toContain('x'.repeat(760));
      expect(carried.endsWith('Current user request:\nnext request')).toBe(true);
      // Once carried, the tail is not sent again.
      await turn(client, threadId, 'after that');
      expect(prompts.at(-1)).toBe('after that');
    } finally { release(); restore(); client.close(); }
  });

  test('the limit waits for a copy still running rather than compacting while it does', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
      if (!isCopy(ctx)) return echoDriver.startTurn(ctx);
      return { done: gate.then(() => echoDriver.startTurn(ctx).done), stop: () => release() };
    } });
    const client = await h.connect();
    try {
      const threadId = await setUp(client);
      await turn(client, threadId, 'x'.repeat(760));
      const generation = h.core.journal.getThread(threadId)!.sessionGeneration ?? 0;
      // 1050 tokens, within the tail a copy may leave behind.
      await turn(client, threadId, 'z'.repeat(950));
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(await compactions(client, threadId)).toEqual([]);
      release();
      await waitFor(() => (h.core.journal.getThread(threadId)!.sessionGeneration ?? 0) === generation + 1);
      expect(await compactions(client, threadId)).toEqual([]);
    } finally { release(); restore(); client.close(); }
  });

  test('a copy that fails leaves the limit to the blocking compaction', async () => {
    let copies = 0;
    const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
      if (!isCopy(ctx)) return echoDriver.startTurn(ctx);
      copies += 1;
      return { done: Promise.resolve({ status: 'error' as const, sessionId: ctx.sessionId, usage: null, error: 'copy refused' }), stop: () => undefined };
    } });
    const client = await h.connect();
    try {
      const threadId = await setUp(client);
      // No moment of its own, so only the limit compacts in place.
      await client.call('settings.set', { autoCompact: { tokens: 1000, moments: [] } });
      await turn(client, threadId, 'x'.repeat(760));
      await waitFor(() => copies === 1);
      const compacted = client.next('turn.finished', t => t.threadId === threadId && t.execution?.operation === 'compact');
      await turn(client, threadId, 'x'.repeat(950));
      expect(await compacted).toMatchObject({ status: 'done', execution: { automatic: true } });
      const thread = await client.call('threads.get', { threadId });
      expect(thread.messages.flatMap(m => m.parts).some(p => p.type === 'compaction' && p.background === true)).toBe(false);
    } finally { restore(); client.close(); }
  });

  test('a ready copy that background work keeps from being taken leaves the background moment to compact in place', async () => {
    const client = await h.connect();
    try {
      const threadId = await setUp(client);
      await client.call('settings.set', { autoCompact: { tokens: 1000, moments: ['background'] } });
      h.core.threads.agentState.noteBackground(threadId, [{ id: 'bg1', kind: 'shell', description: 'watch', toolId: null, startedAt: Date.now() }]);
      const compacted = client.next('turn.finished', t => t.threadId === threadId && t.execution?.operation === 'compact');
      await turn(client, threadId, 'x'.repeat(760));
      expect(await compacted).toMatchObject({ status: 'done', execution: { automatic: true } });
      const thread = await client.call('threads.get', { threadId });
      expect(thread.messages.flatMap(m => m.parts).some(p => p.type === 'compaction' && p.background === true)).toBe(false);
    } finally { client.close(); }
  });

  test('per-type background switches cover real children and bots, and a policy change cancels the old copy', async () => {
    const copies: TurnContext[] = [];
    let stops = 0;
    const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
      if (!isCopy(ctx)) return echoDriver.startTurn({ ...ctx, context: use => ctx.context({ ...use, tokens: 860 }) });
      copies.push(ctx);
      const held = Promise.withResolvers<Awaited<ReturnType<typeof echoDriver.startTurn>['done']>>();
      return { done: held.promise, stop() { stops++; held.resolve({ status: 'stopped', sessionId: ctx.sessionId, usage: null }); } };
    } });
    const client = await h.connect();
    try {
      const parentId = await setUp(client);
      await client.call('settings.set', { autoCompact: null, backgroundCompaction: false });
      const { threadId: botId } = await makeAgent(h, client);
      const { accountId, model } = h.core.threads.require(parentId);
      await client.call('delegation.configure', { threadId: parentId, config: { ...DEFAULT_DELEGATION_CONFIG, enabled: true,
        profiles: [{ id: 'worker', name: 'Worker', providerId: 'echo', accountId, model: model!, effort: null }] } });
      const child = await client.call('delegation.spawn', { threadId: parentId, profileId: 'worker', task: 'initialize', requestId: 'background-child' });
      await waitFor(() => h.core.threads.require(child.thread.id).status === 'idle' && h.core.threads.require(parentId).status === 'idle');
      const policy = { autoCompact: { tokens: 1000, moments: [] }, backgroundCompaction: true };
      await client.call('settings.set', { compactionByType: { subagent: policy, bot: { ...policy, backgroundCompaction: false } } });
      await turn(client, child.thread.id, 'x'.repeat(760));
      await turn(client, botId, 'x'.repeat(760));
      await Bun.sleep(100);
      expect(copies.map(ctx => ctx.thread.id)).toEqual([`${child.thread.id}~compact`]);
      // The copy is maintenance: it carries no native threshold or parent delivery callback.
      expect(copies[0]!.autoCompactTokens?.()).toBeNull();
      await client.call('settings.set', { compactionByType: { subagent: { ...policy, autoCompact: { tokens: 2000, moments: [] } }, bot: policy } });
      expect(stops).toBe(1);
      await turn(client, botId, 'x'.repeat(760));
      await waitFor(() => copies.length === 2);
      expect(copies[1]!.thread.id).toBe(`${botId}~compact`);
      await client.call('settings.set', { compactionByType: {} });
      expect(stops).toBe(2);
    } finally { restore(); client.close(); }
  });

  test('off, a thread near its limit starts no copy', async () => {
    let copies = 0;
    const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
      if (isCopy(ctx)) copies += 1;
      return echoDriver.startTurn(ctx);
    } });
    const client = await h.connect();
    try {
      const threadId = await setUp(client);
      await client.call('settings.set', { backgroundCompaction: false });
      await turn(client, threadId, 'x'.repeat(760));
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(copies).toBe(0);
    } finally { restore(); client.close(); }
  });
});
