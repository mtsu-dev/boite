import { afterEach, expect, test } from 'bun:test';
import type { MessagePart } from '@boite/contracts';
import { AcpTurn } from '../src/drivers/acp/turn.ts';
import { drawUpdate } from '../src/drivers/acp/updates.ts';
import type { TurnContext } from '../src/drivers/types.ts';
import { join } from 'node:path';
import { startTestCore, waitFor, type TestCore } from './harness.ts';

let harness: TestCore | undefined;
afterEach(async () => { await harness?.stop(); harness = undefined; });

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
      value: { input: { text: '', attachments: [], paused: false, queued: [{ id: 'opencode-startup-followup', text: 'Also check the bots', attachments: [] }] } } });
    await waitFor(() => harness!.core.composer.storage.get('inputs', thread.id).value?.input.queued.length === 0, 20000);
    const current = await owner.call('threads.get', { threadId: thread.id });
    expect(current.turns).toHaveLength(2);
    expect(current.turns[0]).toMatchObject({ id: turn.id, status: 'stopped' });
    expect(current.turns[1]?.status).toBe('running');
    expect(current.status).toBe('running');
    expect(current.messages.filter(message => message.role === 'user')).toHaveLength(2);
    await waitFor(() => harness!.core.journal.listMessages(thread.id).some(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text.includes('Also check the bots'))));
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
    await run(child.id, '[done] child');
    expect((await configs()).at(-1)).toMatchObject({ compaction: { buffer: 700_000 }, experimental: { background_compaction: false } });
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
