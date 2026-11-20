import { expect, test } from 'bun:test';
import { answerEach, assistant, calls, claudeThread, harness, init, queries, runTurn, scripted, sdk, success, toolResult, useClaudeHarness } from './fixtures/claude-query.ts';
import { waitFor } from './harness.ts';
import { STEP_HOOK_TIMEOUT_S } from '../src/drivers/claude/step.ts';
import { ClaudeTurn } from '../src/drivers/claude/turn.ts';
import type { TurnContext } from '../src/drivers/types.ts';
import { sessionUsage } from '../src/usage.ts';

useClaudeHarness();

test('summary guidance leaves defaults and explicit manual instructions to the user', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    scripted(() => {}, answerEach('sess-summary-policy'));
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    const callback = calls.at(-1)!.options.hooks!.PreCompact![0]!.hooks[0]!;
    const input = { session_id: 'session', transcript_path: 'transcript', cwd: harness.dataDir,
      hook_event_name: 'PreCompact' as const, trigger: 'manual' as const, custom_instructions: 'Retain the exact code snippet' };
    expect(await callback(input, undefined, { signal: new AbortController().signal })).toEqual({});
    expect(await callback({ ...input, trigger: 'auto', custom_instructions: null }, undefined, { signal: new AbortController().signal })).toEqual({});
    await client.call('settings.set', { compactionSummary: 'Keep decisions under 400 words.' });
    const auto = { ...input, trigger: 'auto' as const, custom_instructions: null };
    const options = { signal: new AbortController().signal };
    expect(await callback(auto, undefined, options)).toEqual({ systemMessage: 'Keep decisions under 400 words.' });
    expect(await callback(input, undefined, options)).toEqual({});
    await client.call('settings.set', { compactionByType: { agent: {
      autoCompact: null, backgroundCompaction: false, compactionSummary: 'Keep all code and identifiers.' } } });
    expect(await callback(auto, undefined, options)).toEqual({ systemMessage: 'Keep all code and identifiers.' });
    await client.call('settings.set', { compactionByType: { agent: {
      autoCompact: null, backgroundCompaction: false, compactionSummary: null } } });
    expect(await callback(auto, undefined, options)).toEqual({});
    await client.call('settings.set', { compactionByType: {} });
    expect(await callback(auto, undefined, options)).toEqual({ systemMessage: 'Keep decisions under 400 words.' });
  } finally { client.close(); }
});

test('the independent token threshold is verified at launch before the first prompt, without guessing a reserve', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    const atPrompt: (number | undefined)[] = [];
    scripted(fake => { fake.compactionReserve = 27_419; }, (fake, prompt, index) => {
      atPrompt.push(fake.compactionThreshold);
      answerEach('sess-native-compact')(fake, prompt, index);
    });
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    expect(atPrompt).toEqual([200_000]);
    expect(queries).toHaveLength(2);
    expect(calls[0]!.prompts).toEqual([]);
    expect(calls[0]!.options.persistSession).toBe(false);
    expect(calls[1]!.options.settings).toMatchObject({ autoCompactWindow: 227_419, autoCompactEnabled: true, autoMemoryEnabled: false, fastMode: false });
    // One callback: Boite's summary focus, and the safety net of a swap at the native threshold, held up to the copy's wait.
    expect(calls[1]!.options.hooks?.PreCompact).toEqual([{ timeout: STEP_HOOK_TIMEOUT_S, hooks: [expect.any(Function)] }]);
    expect(calls[1]!.options.hooks?.PostToolBatch).toEqual([{ timeout: STEP_HOOK_TIMEOUT_S, hooks: [expect.any(Function)] }]);
    expect(calls[1]!.prompts).toEqual(['work']);
    expect(queries.every(query => query.contextUsageCalls.every(options => options.detail === 'summary'))).toBe(true);
    expect(queries.every(query => query.interrupts === 0 && query.compactionSettings.length === 0)).toBe(true);
  } finally { client.close(); }
});

test('unchanged warm policy reuses the query; a new threshold resumes between turns, and null restores native policy', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { warmProcessMinutes: 5, autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    const atPrompt: (number | undefined)[] = [];
    scripted(fake => { fake.nativeCompactionWindow = 600_000; fake.nativeCompactionEnabled = false; }, (fake, prompt, index) => {
      atPrompt.push(fake.compactionThreshold);
      answerEach('sess-warm-compact')(fake, prompt, index);
    });
    expect(await runTurn(client, threadId, 'first')).toBe('done');
    expect(await runTurn(client, threadId, 'unchanged')).toBe('done');
    expect(queries).toHaveLength(2);
    await client.call('settings.set', { autoCompact: { tokens: 250_000, moments: ['cache-expiry'] } });
    expect(await runTurn(client, threadId, 'second')).toBe('done');
    expect(calls[3]!.options.resume).toBe('sess-warm-compact');
    await client.call('settings.set', { autoCompact: { tokens: null, moments: ['cache-expiry'] } });
    expect(await runTurn(client, threadId, 'third')).toBe('done');
    expect(queries).toHaveLength(5);
    expect(atPrompt).toEqual([200_000, 200_000, 250_000, undefined]);
    expect(calls[4]!.options.settings).not.toHaveProperty('autoCompactWindow');
    expect(calls[4]!.options.settings).not.toHaveProperty('autoCompactEnabled');
    expect(calls[4]!.options.resume).toBe('sess-warm-compact');
    expect(queries.every(query => query.interrupts === 0)).toBe(true);
  } finally { client.close(); }
});

test('a warm Claude session follows type overrides and returns to live common defaults', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { warmProcessMinutes: 5, autoCompact: { tokens: 300_000, moments: [] },
      compactionByType: { agent: { autoCompact: { tokens: 200_000, moments: [] }, backgroundCompaction: false } } });
    const thresholds: (number | undefined)[] = [];
    scripted(fake => { fake.nativeCompactionEnabled = false; }, (fake, prompt, index) => {
      thresholds.push(fake.compactionThreshold);
      answerEach('sess-type-policy')(fake, prompt, index);
    });
    expect(await runTurn(client, threadId, 'override')).toBe('done');
    await client.call('settings.set', { autoCompact: { tokens: 400_000, moments: [] } });
    expect(await runTurn(client, threadId, 'common changed')).toBe('done');
    expect(queries).toHaveLength(2);
    await client.call('settings.set', { compactionByType: {} });
    expect(await runTurn(client, threadId, 'inherit')).toBe('done');
    expect(calls[3]!.options.resume).toBe('sess-type-policy');
    await client.call('settings.set', { compactionByType: { agent: { autoCompact: null, backgroundCompaction: false } } });
    expect(await runTurn(client, threadId, 'off')).toBe('done');
    expect(thresholds).toEqual([200_000, 200_000, 400_000, undefined]);
    expect(calls[4]!.options.resume).toBe('sess-type-policy');
    expect(queries.every(query => query.interrupts === 0)).toBe(true);
  } finally { client.close(); }
});

test('a model limit that prevents the exact threshold falls back to an unmodified native query', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    scripted(fake => { fake.modelWindow = 200_000; }, answerEach('sess-clamped-compact'));
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    expect(queries).toHaveLength(3);
    expect(calls.map(call => call.prompts)).toEqual([[], [], ['work']]);
    expect(calls[2]!.options.settings).not.toHaveProperty('autoCompactWindow');
    expect(queries[2]!.compactionThreshold).toBe(167_000);
  } finally { client.close(); }
});

test('a changed threshold never restarts an active turn or a query holding background tasks', async () => {
  const client = await harness.connect();
  const release = Promise.withResolvers<void>();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { warmProcessMinutes: 5, autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    const atPrompt: (number | undefined)[] = [];
    scripted(() => undefined, (fake, prompt, index) => {
      atPrompt.push(fake.compactionThreshold);
      const answer = () => answerEach('sess-held-compact')(fake, prompt, index);
      if (index > 0) { answer(); return; }
      void release.promise.then(() => {
        fake.emit(sdk({ type: 'system', subtype: 'background_tasks_changed', session_id: 'sess-held-compact',
          tasks: [{ task_id: 'held-task', task_type: 'local_bash', description: 'offline background fixture' }] }));
        answer();
      });
    });
    const finished = client.next('turn.finished', turn => turn.threadId === threadId);
    await client.call('turns.start', { threadId, prompt: 'active' });
    await waitFor(() => atPrompt.length === 1);
    await client.call('settings.set', { autoCompact: { tokens: 250_000, moments: ['cache-expiry'] } });
    expect(queries).toHaveLength(2);
    expect(queries[1]!.closes).toBe(0);
    release.resolve();
    expect((await finished).status).toBe('done');
    expect(await runTurn(client, threadId, 'background still running')).toBe('done');
    expect(queries).toHaveLength(2);
    expect(atPrompt).toEqual([200_000, 200_000]);
    expect(queries[1]!.closes).toBe(0);
    expect(queries[1]!.interrupts).toBe(0);
  } finally { release.resolve(); client.close(); }
});

test('a model change measures its own reserve before resuming the warm transcript', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { warmProcessMinutes: 5, autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    const atPrompt: (number | undefined)[] = [];
    scripted((fake, options) => { if (options.model === 'claude-opus-5') fake.compactionReserve = 19_215; }, (fake, prompt, index) => {
      atPrompt.push(fake.compactionThreshold);
      answerEach('sess-model-compact')(fake, prompt, index);
    });
    expect(await runTurn(client, threadId, 'first')).toBe('done');
    await client.call('threads.update', { threadId, model: 'claude-opus-5' });
    expect(await runTurn(client, threadId, 'second')).toBe('done');
    expect(queries).toHaveLength(4);
    expect(atPrompt).toEqual([200_000, 200_000]);
    expect(calls[3]!.options.settings).toMatchObject({ autoCompactWindow: 219_215 });
    expect(calls[3]!.options.resume).toBe('sess-model-compact');
  } finally { client.close(); }
});

test('Stop while native measurement is pending sends no prompt and opens no replacement query', async () => {
  const client = await harness.connect();
  const read = Promise.withResolvers<void>();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    let reading = false;
    scripted(fake => {
      const getContextUsage = fake.getContextUsage.bind(fake);
      fake.getContextUsage = async options => {
        reading = true;
        await read.promise;
        return getContextUsage(options);
      };
    });
    const finished = client.next('turn.finished', turn => turn.threadId === threadId);
    await client.call('turns.start', { threadId, prompt: 'must not run' });
    await waitFor(() => reading);
    await client.call('turns.stop', { threadId });
    read.resolve();
    expect((await finished).status).toBe('stopped');
    expect(queries).toHaveLength(1);
    expect(calls[0]!.prompts).toEqual([]);
    expect(queries[0]!.closes).toBe(1);
  } finally { read.resolve(); client.close(); }
});

test('an older CLI without local context controls keeps its native policy and answers', async () => {
  const client = await harness.connect();
  try {
    const threadId = await claudeThread(client);
    await client.call('settings.set', { autoCompact: { tokens: 200_000, moments: ['cache-expiry'] } });
    scripted(fake => { fake.getContextUsage = () => Promise.reject(new Error('unsupported control')); }, answerEach('sess-old-compact'));
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    expect(queries).toHaveLength(2);
    expect(calls[1]!.options.settings).not.toHaveProperty('autoCompactWindow');
    expect(calls.map(call => call.prompts)).toEqual([[], ['work']]);
  } finally { client.close(); }
});

/** The `autoCompact` limit of the step tests: a copy starts from 170 000 tokens (`BACKGROUND_COMPACT.startRatio`). */
const STEP_LIMIT = 200_000;

/**
 * One main turn of two tool batches, as the CLI runs them: the tool call, its
 * result entry, then the `PostToolBatch` hook before the next request. The
 * copy's `/compact` (a resume cut at an entry) and the turn going on on the
 * copy answer too. `preCompact`: after the second batch, the CLI's own
 * threshold is crossed and it runs `PreCompact(auto)` before compacting.
 */
function stepTurn(plan: { first: number; second: number; preCompact?: boolean; copyResult?: object; resumedResult?: object }) {
  const hooks: { event: string; output: unknown }[] = [];
  scripted(() => undefined, (fake, prompt) => {
    const { options } = calls[queries.indexOf(fake)]!;
    if (options.resumeSessionAt !== undefined) {
      fake.emit(init('sess-copy'));
      fake.emit(sdk({ type: 'system', subtype: 'compact_boundary', session_id: 'sess-copy', uuid: 'copy-boundary',
        compact_metadata: { trigger: 'manual', pre_tokens: plan.first, post_tokens: 20_000 } }));
      fake.emit(sdk({ ...(success('sess-copy') as object), ...plan.copyResult }));
      return;
    }
    if (options.resume === 'sess-copy') {
      fake.emit(init('sess-copy'));
      fake.emit(sdk({ ...(assistant('sess-copy', [{ type: 'text', text: 'went on' }]) as object), uuid: 'copy-answer' }));
      fake.emit(sdk({ ...(success('sess-copy') as object), ...plan.resumedResult }));
      return;
    }
    const hook = async (event: 'PostToolBatch' | 'PreCompact', input: Record<string, unknown>): Promise<unknown> => {
      const callback = options.hooks?.[event]?.[0]?.hooks[0];
      const output = callback === undefined ? 'no hook' : await callback({ session_id: 'sess-main', transcript_path: 'transcript', cwd: harness.dataDir,
        hook_event_name: event, ...input } as never, undefined, { signal: new AbortController().signal });
      hooks.push({ event, output });
      return output;
    };
    const batch = async (index: number, tokens: number): Promise<unknown> => {
      fake.emit(sdk({ type: 'assistant', session_id: 'sess-main', parent_tool_use_id: null, uuid: `call-${index}`,
        message: { id: `msg_${index}`, role: 'assistant', model: 'claude-opus-5', usage: { input_tokens: tokens, output_tokens: 10 },
          content: [{ type: 'tool_use', id: `tool-${index}`, name: 'Bash', input: { command: `echo ${index}` } }] } }));
      fake.emit(sdk({ ...(toolResult('sess-main', `tool-${index}`, `${index}`) as object), uuid: `entry-${index}` }));
      return hook('PostToolBatch', { tool_calls: [{ tool_name: 'Bash', tool_input: { command: `echo ${index}` }, tool_use_id: `tool-${index}` }] });
    };
    void (async () => {
      expect(prompt).toBe('work');
      fake.emit(init('sess-main'));
      await batch(1, plan.first);
      const second = await batch(2, plan.second) as { continue?: boolean };
      // The hook stopped the loop before its next request: the CLI ends the run on a success result.
      if (second.continue === false) { fake.emit(sdk({ ...(success('sess-main') as object), terminal_reason: 'hook_stopped', result: '' })); return; }
      if (plan.preCompact) {
        const net = await hook('PreCompact', { trigger: 'auto', custom_instructions: null }) as { decision?: string };
        // A block the driver took: it interrupted the CLI while the hook ran, and the interrupt wrote the result.
        if (net.decision === 'block') return;
      }
      fake.emit(sdk({ ...(assistant('sess-main', [{ type: 'text', text: 'finished here' }]) as object), uuid: 'main-answer' }));
      fake.emit(success('sess-main'));
    })();
  });
  return hooks;
}

async function stepThread(client: Awaited<ReturnType<typeof harness.connect>>): Promise<{ threadId: string; finished: string[] }> {
  const threadId = await claudeThread(client);
  await client.call('settings.set', { autoCompact: { tokens: STEP_LIMIT, moments: [] }, backgroundCompaction: true });
  const finished: string[] = [];
  client.on('turn.finished', turn => { if (turn.threadId === threadId) finished.push(turn.status); });
  return { threadId, finished };
}

test('a tool batch past the limit swaps in the copy forked at a tool result, and the turn goes on on it', async () => {
  const client = await harness.connect();
  try {
    const { threadId, finished } = await stepThread(client);
    const hooks = stepTurn({ first: 175_000, second: 200_500 });
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    // Below the limit the boundary only starts the copy; at the limit the hook stops the loop before its next request.
    expect(hooks).toEqual([
      { event: 'PostToolBatch', output: {} },
      { event: 'PostToolBatch', output: { continue: false, stopReason: expect.any(String) } },
    ]);
    const copy = calls.filter(call => call.options.resumeSessionAt !== undefined);
    expect(copy).toHaveLength(1);
    expect(copy[0]!.options).toMatchObject({ resume: 'sess-main', resumeSessionAt: 'entry-1', forkSession: true });
    expect(copy[0]!.prompts).toEqual(['/compact']);
    // The same turn reopens the CLI on the copy, its first message the tail.
    const resumed = calls.filter(call => call.options.resume === 'sess-copy' && call.prompts.length > 0);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.options.resumeSessionAt).toBeUndefined();
    expect(resumed[0]!.options.forkSession).toBeFalsy();
    expect(resumed[0]!.prompts[0]).toContain('<recent-history>');
    expect(resumed[0]!.prompts[0]!.endsWith('Continue the current task.')).toBe(true);
    expect(queries.every(query => query.interrupts === 0)).toBe(true);
    const thread = await client.call('threads.get', { threadId });
    expect(thread.sessionId).toBe('sess-copy');
    expect(thread.sessionGeneration).toBe(1);
    expect(thread.turns.filter(turn => turn.execution?.operation === 'compact')).toEqual([]);
    const parts = thread.messages.flatMap(message => message.parts);
    expect(parts.filter(part => part.type === 'compaction')).toEqual([expect.objectContaining({ trigger: 'auto', postTokens: 20_000, background: true })]);
    expect(parts.some(part => part.type === 'text' && part.text === 'went on')).toBe(true);
    expect(parts.some(part => part.type === 'error')).toBe(false);
    await waitFor(() => finished.length > 0);
    expect(finished).toEqual(['done']);
  } finally { client.close(); }
});

test('a turn that went on on a swapped-in copy is charged its own share, not the copy\'s restored totals', async () => {
  // trn_kr7c6qd9ekp4wy29r2dg of a real journal (2026-11-15): the CLI on the copy restored its $55.632 and
  // ended at $55.767, so its own requests cost $0.135; the turn was charged all $55.767.
  const model = (tokens: { input: number; output: number; read: number; write: number }, costUSD: number) => ({ 'claude-opus-5': {
    inputTokens: tokens.input, outputTokens: tokens.output, cacheReadInputTokens: tokens.read, cacheCreationInputTokens: tokens.write,
    webSearchRequests: 0, costUSD, contextWindow: 1_000_000, maxOutputTokens: 64_000 } });
  const copy = { input: 2_400, output: 180_000, read: 48_000_000, write: 2_600_000 };
  const own = { input: 6, output: 616, read: 109_584, write: 12_591 };
  const client = await harness.connect();
  try {
    const { threadId, finished } = await stepThread(client);
    stepTurn({ first: 175_000, second: 200_500,
      copyResult: { total_cost_usd: 55.632, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: model(copy, 55.632) },
      resumedResult: { total_cost_usd: 55.767, usage: { input_tokens: own.input, output_tokens: own.output, cache_read_input_tokens: own.read, cache_creation_input_tokens: own.write },
        modelUsage: model({ input: copy.input + own.input, output: copy.output + own.output, read: copy.read + own.read, write: copy.write + own.write }, 55.767) } });
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    await waitFor(() => finished.length > 0);
    const turn = harness.core.journal.lastTurn(threadId)!;
    // The main CLI's 0.0125, then the copy's 55.767 - 55.632.
    expect(turn.usage!.costUsdEquivalent).toBeCloseTo(0.0125 + 0.135, 9);
    // Its totals are the compacted session's, which the next turn on generation 1 resumes from.
    expect(turn.execution?.sessionGeneration).toBe(0);
    expect(turn.agentTotals).toMatchObject({ costUsd: 55.767, sessionGeneration: 1 });
    expect(sessionUsage(harness.core, threadId, 1, '')).toMatchObject({ costUsd: 55.767 });
  } finally { client.close(); }
});

test('a later turn swaps too, judged on the context its boundaries report rather than the last turn\'s', async () => {
  const client = await harness.connect();
  try {
    const { threadId, finished } = await stepThread(client);
    scripted(() => {}, answerEach('sess-main'));
    expect(await runTurn(client, threadId, 'seed')).toBe('done');
    // The seed turn ended at 160 000 tokens: Claude reports the next context only with that turn's final result.
    harness.core.threads.agentState.noteContext(threadId, { tokens: 160_000, window: 1_000_000 });
    finished.length = 0;
    const hooks = stepTurn({ first: 175_000, second: 200_500 });
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    expect(hooks).toEqual([
      { event: 'PostToolBatch', output: {} },
      { event: 'PostToolBatch', output: { continue: false, stopReason: expect.any(String) } },
    ]);
    const thread = await client.call('threads.get', { threadId });
    expect(thread.sessionId).toBe('sess-copy');
    expect(thread.sessionGeneration).toBe(1);
    await waitFor(() => finished.length > 0);
    expect(finished).toEqual(['done']);
  } finally { client.close(); }
});

test('the CLI reaching its own threshold first blocks its compaction for a ready copy, then the same swap', async () => {
  const client = await harness.connect();
  try {
    const { threadId, finished } = await stepThread(client);
    // Boite's estimate stays under the limit at the batch; the CLI's own count crosses it.
    const hooks = stepTurn({ first: 175_000, second: 190_000, preCompact: true });
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    expect(hooks).toEqual([
      { event: 'PostToolBatch', output: {} },
      { event: 'PostToolBatch', output: {} },
      { event: 'PreCompact', output: { decision: 'block' } },
    ]);
    // `continue: false` does not stop a PreCompact hook (CLI 2.1.318): the interrupt sent while it runs does.
    const main = queries[calls.findIndex(call => call.prompts[0] === 'work')]!;
    expect(main.interrupts).toBe(1);
    const resumed = calls.filter(call => call.options.resume === 'sess-copy' && call.prompts.length > 0);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.prompts[0]).toContain('<recent-history>');
    const thread = await client.call('threads.get', { threadId });
    expect(thread.sessionId).toBe('sess-copy');
    expect(thread.sessionGeneration).toBe(1);
    const parts = thread.messages.flatMap(message => message.parts);
    expect(parts.some(part => part.type === 'error')).toBe(false);
    expect(parts.some(part => part.type === 'text' && part.text === 'went on')).toBe(true);
    await waitFor(() => finished.length > 0);
    expect(finished).toEqual(['done']);
  } finally { client.close(); }
});

test('a boundary the core answers with no swap leaves the loop and the native compaction alone', async () => {
  const client = await harness.connect();
  try {
    const { threadId, finished } = await stepThread(client);
    // Too far from the limit for a copy at the first batch: none exists when the limit is reached.
    const hooks = stepTurn({ first: 100_000, second: 200_500, preCompact: true });
    expect(await runTurn(client, threadId, 'work')).toBe('done');
    expect(hooks).toEqual([
      { event: 'PostToolBatch', output: {} },
      { event: 'PostToolBatch', output: {} },
      { event: 'PreCompact', output: {} },
    ]);
    expect(calls.filter(call => call.options.resumeSessionAt !== undefined || call.options.resume === 'sess-copy')).toEqual([]);
    expect(queries.every(query => query.interrupts === 0)).toBe(true);
    const thread = await client.call('threads.get', { threadId });
    expect(thread.sessionId).toBe('sess-main');
    expect(thread.sessionGeneration ?? 0).toBe(0);
    expect(thread.messages.flatMap(message => message.parts).some(part => part.type === 'text' && part.text === 'finished here')).toBe(true);
    await waitFor(() => finished.length > 0);
    expect(finished).toEqual(['done']);
  } finally { client.close(); }
});

test('a boundary wait that timed out leaves no waiter for the next entry to wake', async () => {
  const turn = new ClaudeTurn({ log: () => undefined } as unknown as TurnContext);
  const timers: unknown[] = [];
  const cleared: unknown[] = [];
  let polling = false;
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => { const timer = realSet(...args); if (polling) timers.push(timer); return timer; }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: Parameters<typeof clearTimeout>[0]) => { cleared.push(timer); realClear(timer); }) as typeof clearTimeout;
  try {
    for (let poll = 0; poll < 3; poll += 1) {
      polling = true;
      const wait = turn.nextEntry(0);
      polling = false;
      await wait;
    }
    turn.handle(sdk({ type: 'user', uuid: 'entry-late', session_id: 'sess', parent_tool_use_id: null, message: { role: 'user', content: [] } }));
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
  expect(timers).toHaveLength(3);
  // A wait that ended on its timer is gone: the entry that came after wakes nothing of it.
  expect(cleared.filter(timer => timers.includes(timer))).toEqual([]);
});
