import { afterEach, expect, spyOn, test } from 'bun:test';
import type { AccountId, MessagePart } from '@boite/contracts';
import { createAcpDriver } from '../src/drivers/acp.ts';
import type { AcpMemory } from '../src/drivers/acp/session.ts';
import { setDriver } from '../src/drivers/index.ts';
import { AcpTurn } from '../src/drivers/acp/turn.ts';
import * as openCodeContent from '../src/drivers/acp/opencode-content.ts';
import { drawUpdate } from '../src/drivers/acp/updates.ts';
import type { TurnContext } from '../src/drivers/types.ts';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestCore, waitFor, type TestCore } from './harness.ts';

let harness: TestCore | undefined;
afterEach(async () => {
  delete process.env['OPENCODE_FIXTURE_TRACE'];
  delete process.env['OPENCODE_FIXTURE_COST_ERROR'];
  delete process.env['OPENCODE_FIXTURE_COST'];
  await harness?.stop();
  harness = undefined;
});

async function loopbackThread() {
  harness = await startTestCore();
  const owner = await harness.connect();
  const trace = join(harness.dataDir, 'native-trace.txt');
  process.env['OPENCODE_FIXTURE_TRACE'] = trace;
  const profile = { executable: [{ kind: 'file' as const, value: process.execPath }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
  Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
  await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
  const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
  const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
  const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
  return { owner, threadId: thread.id, trace: () => existsSync(trace) ? readFileSync(trace, 'utf8') : '' };
}

test.each(['documents', 'steer acknowledgement'] as const)('OpenCode handles the Stop terminal event during %s', async blocked => {
  const { owner, threadId, trace } = await loopbackThread();
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<[]>();
  const content = blocked === 'documents' ? spyOn(openCodeContent, 'openCodeContent').mockImplementation(() => {
    reading.resolve();
    return release.promise;
  }) : undefined;
  try {
    const tool = owner.next('turn.toolCompleted', event => event.threadId === threadId, 10_000);
    if (content) void tool.catch(() => undefined);
    const turn = await owner.call('turns.start', { threadId, prompt: '[slow]' });
    await (content ? reading.promise : tool);
    if (!content) {
      const submitted = owner.call('turns.steer', { threadId, turnId: turn.id, prompt: '[hold-ack]', clientRequestId: 'hold_steer_ack' }).catch(error => String(error));
      void submitted;
      await waitFor(() => trace().includes('steer waiting'));
    }
    const finished = owner.next('turn.finished', event => event.id === turn.id, 2_000);
    expect(await owner.call('turns.stop', { threadId })).toEqual({ stopped: true });
    expect((await finished).status).toBe('stopped');
    expect(trace()).toContain('interrupt\n');
  } finally { release.resolve([]); content?.mockRestore(); }
}, 12_000);

test('OpenCode reapplies Stop when initial admission completes after the interrupt', async () => {
  const { owner, threadId, trace } = await loopbackThread();
  const turn = await owner.call('turns.start', { threadId, prompt: '[early-interrupt]' });
  await waitFor(() => trace().includes('initial prompt waiting'), 10_000);
  const finished = owner.next('turn.finished', event => event.id === turn.id, 2_000);
  expect(await owner.call('turns.stop', { threadId })).toEqual({ stopped: true });
  expect((await finished).status).toBe('stopped');
  expect(trace()).toBe('initial prompt waiting\ninterrupt\nadmitted\ninterrupt\n');
}, 12_000);

test.each(['terminal received', 'execution active', 'cost unavailable'] as const)('OpenCode stops with its received usage while a document is still loading (%s)', async state => {
  const { owner, threadId, trace } = await loopbackThread();
  process.env['OPENCODE_FIXTURE_COST'] = join(harness!.dataDir, 'native-cost.txt');
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<[]>();
  const content = spyOn(openCodeContent, 'openCodeContent').mockImplementation(() => {
    reading.resolve();
    return release.promise;
  });
  try {
    const terminal = state === 'terminal received';
    const unavailable = state === 'cost unavailable';
    const turn = await owner.call('turns.start', { threadId,
      prompt: `[slow][usage-after-tool]${terminal ? '[finish-after-tool]' : ''}${unavailable ? '[fail-cost-read]' : ''}` });
    await reading.promise;
    await waitFor(() => trace().includes(terminal ? 'execution ended' : 'step ended'));
    await Bun.sleep(100);
    const finished = owner.next('turn.finished', event => event.id === turn.id, 1800);
    expect(await owner.call('turns.stop', { threadId })).toEqual({ stopped: true });
    const stopped = await finished;
    expect(stopped).toMatchObject({ status: 'stopped', usage: { inputTokens: 17, outputTokens: 3 } });
    expect(stopped.usage?.costUsdEquivalent).toBe(unavailable ? null : 0.01);
    const resumed = owner.next('turn.finished', event => event.threadId === threadId, 6000);
    await owner.call('turns.start', { threadId, prompt: '[done]' });
    const next = await resumed;
    expect(next.status).toBe('done');
    expect(next.usage?.costUsdEquivalent).toBeCloseTo(0.02, 6);
  } finally { release.resolve([]); content.mockRestore(); }
}, 12_000);

test('OpenCode keeps the terminal result and tokens when the cost read fails', async () => {
  const { owner, threadId } = await loopbackThread();
  process.env['OPENCODE_FIXTURE_COST_ERROR'] = '1';
  const finished = owner.next('turn.finished', event => event.threadId === threadId, 10_000);
  await owner.call('turns.start', { threadId, prompt: '[done]' });
  expect(await finished).toMatchObject({ status: 'done', usage: { inputTokens: 17, outputTokens: 3 } });
}, 12_000);

test.each(['available', 'unavailable'] as const)('OpenCode attributes warm-turn costs when the reloaded baseline is %s', async baseline => {
  const { owner, threadId, trace } = await loopbackThread();
  process.env['OPENCODE_FIXTURE_COST'] = join(harness!.dataDir, 'native-cost.txt');
  await owner.call('settings.set', { warmProcessMinutes: 5 });
  const run = async (prompt: string) => {
    const finished = owner.next('turn.finished', event => event.threadId === threadId, 10_000);
    await owner.call('turns.start', { threadId, prompt });
    return (await finished).usage?.costUsdEquivalent;
  };
  expect(await run('[done]')).toBeCloseTo(0.02, 6);
  expect(await run(baseline === 'available' ? '[done][fail-cost-read]' : '[done][fail-two-cost-reads]')).toBeNull();
  const third = await run('[done]');
  if (baseline === 'available') expect(third).toBeCloseTo(0.02, 6);
  else expect(third).toBeNull();
  expect(await run('[done]')).toBeCloseTo(0.02, 6);
  expect(trace().split('cost server started\n')).toHaveLength(2);
}, 25_000);

test('OpenCode Stop cancels a blocked cost reload before submitting the prompt', async () => {
  const { owner, threadId, trace } = await loopbackThread();
  const costFile = join(harness!.dataDir, 'native-cost.txt');
  process.env['OPENCODE_FIXTURE_COST'] = costFile;
  await owner.call('settings.set', { warmProcessMinutes: 5 });
  const warm = owner.next('turn.finished', event => event.threadId === threadId, 10_000);
  await owner.call('turns.start', { threadId, prompt: '[done][fail-cost-read][hold-cost-reload]' });
  expect((await warm).usage?.costUsdEquivalent).toBeNull();
  const turn = await owner.call('turns.start', { threadId, prompt: '[done]' });
  await waitFor(() => trace().includes('cost reload waiting'));
  const finished = owner.next('turn.finished', event => event.id === turn.id, 2_000);
  expect(await owner.call('turns.stop', { threadId })).toEqual({ stopped: true });
  expect((await finished).status).toBe('stopped');
  expect(Number(readFileSync(costFile, 'utf8'))).toBeCloseTo(0.02, 6);
}, 20_000);

test('Send now during OpenCode startup stops the old turn and delivers a new one before a tool boundary', async () => {
  harness = await startTestCore();
  const owner = await harness.connect();
  process.env['OPENCODE_FIXTURE_TOOL_GATE'] = join(harness.dataDir, 'blocked-tools');
  try {
    const profile = { executable: [{ kind: 'file' as const, value: process.execPath }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
    Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
    await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
    const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
    const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
    const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
    const turn = await owner.call('turns.start', { threadId: thread.id, prompt: '[slow]' });
    await waitFor(() => harness!.core.threads.runner.handles.has(thread.id));
    await owner.call('composer.put', { section: 'inputs', id: thread.id, expectedRevision: 0, sendNow: true,
      value: { input: { text: '', attachments: [], paused: false, queued: [{ id: 'opencode-startup-followup', text: 'Also check the mochis', attachments: [] }] } } });
    await waitFor(() => harness!.core.composer.storage.get('inputs', thread.id).value?.input.queued.length === 0, 20000);
    const current = await owner.call('threads.get', { threadId: thread.id });
    expect(current.turns).toHaveLength(2);
    expect(current.turns[0]).toMatchObject({ id: turn.id, status: 'stopped' });
    expect(current.turns[1]?.status).toBe('running');
    expect(current.status).toBe('running');
    expect(current.messages.filter(message => message.role === 'user')).toHaveLength(2);
    await waitFor(() => harness!.core.journal.listMessages(thread.id).some(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text.includes('Also check the mochis'))));
    expect(harness.core.journal.listMessages(thread.id).filter(message => message.role === 'user').at(-1)).toMatchObject({ turnId: current.turns[1]!.id });
    expect(current.messages.flatMap(message => message.parts).some(part => part.type === 'tool')).toBe(false);
  } finally { delete process.env['OPENCODE_FIXTURE_TOOL_GATE']; }
}, 30000);

test('OpenCode 2 accepts both tool-boundary and immediate messages in the same turn', async () => {
  harness = await startTestCore();
  const owner = await harness.connect();
  const profile = { executable: [{ kind: 'path' as const, value: 'bun' }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
  Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
  await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
  const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
  const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
  const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
  // The first event includes SDK loading and a server startup allowed 15 seconds.
  const boundary = owner.next('turn.toolCompleted', event => event.threadId === thread.id, 20_000);
  const turn = await owner.call('turns.start', { threadId: thread.id, prompt: '[tool][slow]' });
  await boundary;
  const submit = (prompt: string, clientRequestId: string) => owner.call('turns.steer', { threadId: thread.id, turnId: turn.id, prompt, clientRequestId });
  expect(await submit('At the tool boundary', 'boundary_message')).toEqual({ accepted: true });
  expect(await submit('Send immediately', 'immediate_message')).toEqual({ accepted: true });
  expect(await submit('Send immediately', 'immediate_message')).toEqual({ accepted: true });
  await waitFor(() => harness!.core.threads.get(thread.id).messages.some(message => message.parts.some(part => part.type === 'text' && part.text.includes('Received: Send immediately'))));
  const current = harness.core.threads.get(thread.id);
  expect(current.status).toBe('running');
  expect(current.turns).toHaveLength(1);
  expect(current.messages.filter(message => message.role === 'user')).toHaveLength(3);
  for (const prompt of ['At the tool boundary', 'Send immediately']) {
    const userIndex = current.messages.findIndex(message => message.role === 'user' && message.parts.some(part => part.type === 'text' && part.text === prompt));
    const replyIndex = current.messages.findIndex(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text.includes(`Received: ${prompt}`)));
    expect(replyIndex).toBeGreaterThan(userIndex);
  }
  await owner.call('turns.stop', { threadId: thread.id });
}, 30_000);

test('OpenCode 2 keeps the tool name and plain output when ACP titles change', () => {
  const parts: MessagePart[] = [];
  const turn = new AcpTurn({ provider: { id: 'opencode-v2' }, sessionId: null,
    emit: { startMessage: () => 'message', part: (_id: string, _index: number, part: MessagePart) => parts.push(part) },
  } as unknown as TurnContext);
  drawUpdate(turn, { sessionUpdate: 'tool_call', toolCallId: 'shell-1', name: 'shell', title: 'shell', rawInput: {}, status: 'pending' });
  drawUpdate(turn, { sessionUpdate: 'tool_call_update', toolCallId: 'shell-1', title: 'git status', rawInput: { command: 'git status', cwd: '/workspace' }, status: 'in_progress' });
  drawUpdate(turn, { sessionUpdate: 'tool_call_update', toolCallId: 'shell-1', status: 'completed', rawOutput: { metadata: { exit: 0 } }, content: [{ type: 'content', content: { type: 'text', text: 'working tree clean' } }] });
  expect(parts.at(-1)).toMatchObject({ type: 'tool', name: 'shell', input: { command: 'git status' }, output: 'working tree clean', status: 'done' });
  expect(parts.at(-1)).not.toHaveProperty('documents');
});

test('OpenCode 2 answers child permissions interactively and allows them without a card in yolo mode', async () => {
  harness = await startTestCore();
  const owner = await harness.connect();
  const profile = { executable: [{ kind: 'path' as const, value: 'bun' }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
  Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
  await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
  const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
  const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
  const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
  await owner.call('threads.subscribe', { threadId: thread.id });
  const requested = owner.next('permission.requested', request => request.threadId === thread.id, 20000);
  const finished = owner.next('turn.finished', result => result.threadId === thread.id, 20000);
  await owner.call('turns.start', { threadId: thread.id, prompt: '[child-permission]' });
  const permission = await requested;
  expect(permission.toolName).toBe('shell');
  await owner.call('permissions.answer', { requestId: permission.id, decision: 'allow' });
  expect(await finished).toMatchObject({ status: 'done', error: null });
  const current = await owner.call('threads.get', { threadId: thread.id });
  expect(current.messages.some(message => message.parts.some(part => part.type === 'text' && part.text === 'child allowed'))).toBe(true);
  await owner.call('threads.update', { threadId: thread.id, permissionMode: 'yolo' });
  const requests: string[] = [];
  owner.on('permission.requested', request => requests.push(request.id));
  const yoloFinished = owner.next('turn.finished', result => result.threadId === thread.id, 20000);
  await owner.call('turns.start', { threadId: thread.id, prompt: '[child-permission]' });
  expect(await yoloFinished).toMatchObject({ status: 'done', error: null });
  const yolo = await owner.call('threads.get', { threadId: thread.id });
  expect(requests).toEqual([]);
  expect(yolo.messages.filter(message => message.turnId === yolo.turns.at(-1)?.id).flatMap(message => message.parts).map(part => part.type)).not.toContain('permission');
}, 30000);

for (const outcome of ['delivered', 'cancelled'] as const) {
  test(`OpenCode 2 keeps late admitted input until it is ${outcome}`, async () => {
    const cancelled = outcome === 'cancelled';
    harness = await startTestCore();
    const owner = await harness.connect();
    const profile = { executable: [{ kind: 'file' as const, value: process.execPath }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
    Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
    await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
    const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
    const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
    const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
    const boundary = owner.next('turn.toolCompleted', event => event.threadId === thread.id, 20_000);
    const turn = await owner.call('turns.start', { threadId: thread.id, prompt: `[late-admission][slow]${cancelled ? '[cancelled]' : ''}` });
    await boundary;
    const finished = owner.next('turn.finished', result => result.threadId === thread.id, 20000);
    expect(await owner.call('turns.steer', { threadId: thread.id, turnId: turn.id, prompt: 'Late follow-up', clientRequestId: 'late_follow_up' })).toEqual({ accepted: true });
    expect(await finished).toMatchObject({ status: 'done', error: null });
    const current = await owner.call('threads.get', { threadId: thread.id });
    expect(current.turns).toHaveLength(1);
    expect(current.messages.filter(message => message.role === 'user')).toHaveLength(2);
    expect(current.messages.some(message => message.turnId === turn.id && message.parts.some(part => part.type === 'text' && part.text === 'Late follow-up answered'))).toBe(!cancelled);
  }, 30000);
}

test('OpenCode 2 compacts at the limit of each thread type and takes a changed one at the next idle turn', async () => {
  harness = await startTestCore();
  const owner = await harness.connect();
  const log = join(harness.dataDir, 'opencode-configs.jsonl');
  process.env['OPENCODE_FIXTURE_CONFIG_LOG'] = log;
  process.env['OPENCODE_FIXTURE_WINDOW'] = '1000000';
  try {
    const profile = { executable: [{ kind: 'file' as const, value: process.execPath }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
    Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
    await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
    await owner.call('settings.set', { warmProcessMinutes: 5, autoCompact: { tokens: 200_000, moments: [] },
      compactionByType: { subagent: { autoCompact: { tokens: 300_000, moments: [] }, backgroundCompaction: false } } });
    const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
    const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
    const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
    const configs = async () => (await Bun.file(log).text()).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    const run = async (threadId: string, prompt: string) => {
      await waitFor(() => !harness!.core.threads.isBusy(threadId));
      const finished = owner.next('turn.finished', result => result.threadId === threadId, 20_000);
      await owner.call('turns.start', { threadId, prompt });
      expect(await finished).toMatchObject({ status: 'done', error: null });
    };
    // The window is unknown until the first process lists its models: OpenCode keeps its own ceiling.
    await run(thread.id, '[done] first');
    expect((await configs()).map(config => config['compaction'])).toEqual([undefined]);
    // Known now, the next idle turn restarts the process with a ceiling at the limit, then keeps it.
    await run(thread.id, '[done] second');
    await run(thread.id, '[done] third');
    expect((await configs()).map(config => config['compaction'])).toEqual([undefined, { buffer: 800_000 }]);
    // A subagent compacts at its own limit, and without OpenCode's background compaction.
    const child = harness.core.threads.create({ projectId: project.id, providerId: 'opencode-v2', accountId: account.id }, { id: 'thr_opencode_child', branch: null, parentThreadId: thread.id });
    const reported = owner.next('turn.finished', result => result.threadId === thread.id, 20_000);
    await run(child.id, '[done] child');
    expect((await configs()).at(-1)).toMatchObject({ compaction: { buffer: 700_000 }, experimental: { background_compaction: false } });
    // The child's result wakes its parent: let that answer finish before the next user turn.
    expect(await reported).toMatchObject({ status: 'done', error: null });
    // A limit changed during a turn leaves that turn's process alone; one at the window gives the native ceiling back.
    const boundary = owner.next('turn.toolCompleted', event => event.threadId === thread.id, 20_000);
    const finished = owner.next('turn.finished', result => result.threadId === thread.id, 20_000);
    await owner.call('turns.start', { threadId: thread.id, prompt: '[slow]' });
    await boundary;
    await owner.call('settings.set', { autoCompact: { tokens: 1_000_000, moments: [] } });
    expect(await finished).toMatchObject({ status: 'done', error: null });
    expect(await configs()).toHaveLength(3);
    await run(thread.id, '[done] after');
    expect((await configs()).map(config => config['compaction'])).toEqual([undefined, { buffer: 800_000 }, { buffer: 700_000 }, undefined]);
  } finally {
    delete process.env['OPENCODE_FIXTURE_CONFIG_LOG'];
    delete process.env['OPENCODE_FIXTURE_WINDOW'];
  }
}, 60_000);

/**
 * One account, two projects whose OpenCode defaults differ, "big" with a
 * 1000000 window and "small" with 500000, a 200000 limit; the threads' model
 * reads "default" in both. `sameModel`: both projects give the same model id
 * its own window, as a project's configuration can.
 */
async function twoProjects(sameModel: boolean, body: (setup: {
  owner: Awaited<ReturnType<TestCore['connect']>>; a: string; b: string; big: string; small: string; account: string;
  configs: () => Promise<unknown[]>; run: (threadId: string, prompt: string) => Promise<void>;
}) => Promise<void>): Promise<void> {
  harness = await startTestCore();
  const owner = await harness.connect();
  const log = join(harness.dataDir, 'opencode-configs.jsonl');
  const fixture = { OPENCODE_FIXTURE_CONFIG_LOG: log, OPENCODE_FIXTURE_WINDOW: '1000000', OPENCODE_FIXTURE_SMALL_WINDOW: '500000', ...(sameModel ? { OPENCODE_FIXTURE_SAME_MODEL: '1' } : {}) };
  Object.assign(process.env, fixture);
  try {
    const profile = { executable: [{ kind: 'file' as const, value: process.execPath }], detect: {}, isolation: {}, launch: { args: [join(import.meta.dir, 'fixtures/opencode2-server.ts'), 'acp'] } };
    Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
    await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
    await owner.call('settings.set', { warmProcessMinutes: 5, autoCompact: { tokens: 200_000, moments: [] } });
    const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
    const project = async (name: string) => {
      const path = join(harness!.dataDir, name);
      mkdirSync(path, { recursive: true });
      return (await owner.call('projects.add', { path, name })).id;
    };
    const big = await project('big'), small = await project('small');
    const thread = async (projectId: string) => (await owner.call('threads.create', { projectId, accountId: account.id, providerId: 'opencode-v2' })).id;
    const a = await thread(big), b = await thread(small);
    const configs = async () => (await Bun.file(log).text()).trim().split('\n').map(line => (JSON.parse(line) as Record<string, unknown>)['compaction']);
    const run = async (threadId: string, prompt: string) => {
      await waitFor(() => !harness!.core.threads.isBusy(threadId));
      const finished = owner.next('turn.finished', result => result.threadId === threadId, 20_000);
      await owner.call('turns.start', { threadId, prompt });
      expect(await finished).toMatchObject({ status: 'done', error: null });
    };
    await body({ owner, a, b, big, small, account: account.id, configs, run });
  } finally {
    for (const key of Object.keys(fixture)) delete process.env[key];
  }
}

for (const sameModel of [false, true]) {
  test(`OpenCode 2 keeps the window of each project apart, ${sameModel ? 'one model with two windows' : 'two default models'}`, async () => {
    await twoProjects(sameModel, async ({ a, b, configs, run }) => {
      await run(a, '[done] A1');
      await run(a, '[done] A2');
      // B's default model is not known yet: OpenCode keeps its own ceiling, then takes B's window.
      await run(b, '[done] B1');
      await run(b, '[done] B2');
      // A turn of B never changes A's buffer: A's process stays.
      await run(a, '[done] A3');
      expect(await configs()).toEqual([undefined, { buffer: 800_000 }, undefined, { buffer: 300_000 }]);
    });
  }, 60_000);
}

test('OpenCode 2 takes the default model of the folder a conversation moved to', async () => {
  await twoProjects(false, async ({ owner, a, b, small, configs, run }) => {
    await run(a, '[done] A1');
    await run(a, '[done] A2');
    await run(b, '[done] B1');
    await run(b, '[done] B2');
    await waitFor(() => !harness!.core.threads.isBusy(a));
    await owner.call('threads.move', { threadId: a, projectId: small });
    await run(a, '[done] A moved');
    expect((await configs()).at(-1)).toEqual({ buffer: 300_000 });
  });
}, 60_000);

/** A driver of its own, whose caches the test reads. */
async function withMemory(body: (driver: ReturnType<typeof createAcpDriver>, memory: AcpMemory) => Promise<void>): Promise<void> {
  const memory: AcpMemory = { costPerProcess: new Set(), refusedLoads: new Set(), compactionWindows: new Map(), resolvedModels: new Map() };
  const driver = createAcpDriver({ loadSdk: () => import('@agentclientprotocol/sdk/unstable') }, memory);
  const restore = setDriver('acp', driver);
  try { await body(driver, memory); } finally {
    driver.shutdown?.();
    restore();
  }
}

test('OpenCode 2 forgets what released conversations and a forgotten account resolved', async () => {
  await withMemory(async (driver, memory) => {
    await twoProjects(false, async ({ owner, a, big, account, configs, run }) => {
      // No process outlives its turn: none notes its window again on `forgetProbes`.
      await owner.call('settings.set', { warmProcessMinutes: 0 });
      // A stays live in the folder, so the folder keeps its entries.
      await run(a, '[done] A1');
      const released: string[] = [];
      for (let turn = 0; turn < 10; turn++) {
        const id = (await owner.call('threads.create', { projectId: big, accountId: account, providerId: 'opencode-v2' })).id;
        await run(id, `[done] conversation ${turn}`);
        await waitFor(() => !harness!.core.threads.isBusy(id));
        driver.releaseThread!(id);
        released.push(id);
      }
      // Only A's own resolution and the folder's stay.
      expect(memory.resolvedModels.size).toBe(2);
      // A released conversation on "default" resumes on its folder's window.
      await run(released[0]!, '[done] resumed');
      expect((await configs()).at(-1)).toEqual({ buffer: 800_000 });
      await waitFor(() => !harness!.core.threads.isBusy(released[0]!));
      driver.releaseThread!(released[0]!);
      driver.forgetProbes!({ accountId: account as AccountId });
      expect(memory.resolvedModels.size).toBe(0);
      expect(memory.compactionWindows.size).toBe(0);
    });
  });
}, 120_000);

test('OpenCode 2 forgets the folders of successive worktrees once their conversations are released', async () => {
  await withMemory(async (driver, memory) => {
    await twoProjects(false, async ({ owner, account, run }) => {
      for (let n = 0; n < 10; n++) {
        const path = join(harness!.dataDir, `worktree-${n}`);
        mkdirSync(path, { recursive: true });
        const projectId = (await owner.call('projects.add', { path, name: `worktree-${n}` })).id;
        const id = (await owner.call('threads.create', { projectId, accountId: account, providerId: 'opencode-v2' })).id;
        await run(id, `[done] worktree ${n}`);
        await waitFor(() => !harness!.core.threads.isBusy(id));
        driver.releaseThread!(id);
      }
      expect(memory.resolvedModels.size).toBe(0);
      expect(memory.compactionWindows.size).toBe(0);
    });
  });
}, 120_000);

test('OpenCode 2 keeps the folder of a live conversation while another folder is released', async () => {
  await withMemory(async (driver, memory) => {
    await twoProjects(false, async ({ a, b, run }) => {
      await run(a, '[done] A1');
      await run(b, '[done] B1');
      await waitFor(() => !harness!.core.threads.isBusy(b));
      driver.releaseThread!(b);
      // A's own resolution, its folder's and its window; nothing of B's folder.
      expect([...memory.resolvedModels.values()].map(resolved => resolved.cwd.endsWith('big'))).toEqual([true, true]);
      expect([...memory.compactionWindows.keys()].map(key => key.split('\0')[2]!.endsWith('big'))).toEqual([true]);
    });
  });
}, 60_000);

test('OpenCode 2 gets the buffer back in a released folder after the next idle turn', async () => {
  await withMemory(async (driver) => {
    await twoProjects(false, async ({ b, configs, run }) => {
      await run(b, '[done] B1');
      await run(b, '[done] B2');
      await waitFor(() => !harness!.core.threads.isBusy(b));
      driver.releaseThread!(b);
      const before = (await configs()).length;
      // OpenCode's own ceiling first, then the buffer once the window is known again.
      await run(b, '[done] B3');
      await run(b, '[done] B4');
      expect((await configs()).slice(before)).toEqual([undefined, { buffer: 300_000 }]);
    });
  });
}, 60_000);
