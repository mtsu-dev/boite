import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentTrigger, AgentTriggerSource } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { botCommand } from '../src/agents/cli.ts';
import { TriggerSecrets } from '../src/agents/trigger-secrets.ts';
import { makeAgent, scripted, settled, turnsOf } from './agent-fixture.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let h: TestCore;
let owner: CoreClient;
let driver: ReturnType<typeof scripted>;

beforeEach(async () => {
  h = await startTestCore({ pullRequestWatches: { intervalMs: 0, coalesceMs: 0 } });
  owner = await h.connect();
  driver = scripted(ctx => ({ text: '[quiet] tested', hold: ctx.prompt.endsWith('manual hold') }));
});
afterEach(async () => {
  driver.release();
  driver.restore();
  await h.stop();
});

function save(agentId: string, source: AgentTriggerSource, name = 'On news') {
  return owner.call('agents.trigger.save', { value: { agentId, source, name, prompt: 'Tell me what happened.', enabled: true, cooldownSeconds: 60 } });
}
function post(trigger: AgentTrigger, headers: Record<string, string> = {}, body: string | ReadableStream<Uint8Array> = '{}') {
  return fetch(new URL(trigger.webhookPath!, h.url.replace(/^ws/, 'http')), { method: 'POST', headers, body });
}
const read = (trigger: AgentTrigger) => h.core.workforce.records.get('trigger', trigger.id);
const oldEnough = (trigger: AgentTrigger) => {
  const current = read(trigger);
  h.core.workforce.records.update('trigger', current.id, current.revision, { ...current, lastFiredAt: Date.now() - 61_000 });
};

test('a webhook authenticates three ways, caps and quotes its body, rotates without leaking the secret, and enforces cooldown', async () => {
  const { agent, threadId } = await makeAgent(h, owner);
  const { trigger, secret } = await save(agent.id, { kind: 'webhook' });
  expect(secret).toMatch(/^[a-f0-9]{64}$/);
  const visible = await owner.call('agents.snapshot', {});
  expect(visible.triggers).toEqual([trigger]);
  expect(JSON.stringify(visible)).not.toContain(secret!);
  expect(JSON.stringify(h.core.journal.db.query("SELECT payload FROM events WHERE type = 'agents.record'").all())).not.toContain(secret!);
  const settingsWithSecret = h.core.journal.db.query("SELECT key FROM settings WHERE key LIKE 'agents:trigger-secret:%' OR instr(value, ?) > 0");
  expect(settingsWithSecret.all(secret!)).toEqual([]);
  expect(new TriggerSecrets(h.dataDir).get(trigger.id)).toBe(secret!);
  if (process.platform !== 'win32') expect(statSync(join(h.dataDir, 'mochi-trigger-secrets.json')).mode & 0o777).toBe(0o600);

  expect((await post(trigger)).status).toBe(401);
  expect((await post(trigger, { 'x-boite-secret': 'no' })).status).toBe(401);
  expect((await post(trigger, { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })).status).toBe(401);
  expect((await post(trigger, { authorization: `Bearer ${secret}` }, 'x'.repeat(65_537))).status).toBe(413);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(33_000));
    controller.enqueue(new Uint8Array(33_000));
    controller.close();
  } });
  expect((await post(trigger, { 'x-boite-secret': secret! }, stream)).status).toBe(413);

  const body = JSON.stringify({ action: 'verified', token: secret, long: 'x'.repeat(2000) + 'omitted-marker' });
  const signature = createHmac('sha256', secret!).update(body).digest('hex');
  expect((await post(trigger, { 'x-hub-signature-256': `sha256=${signature}`, 'x-github-event': 'push' }, body + '!')).status).toBe(401);
  expect((await post(trigger, { 'x-hub-signature-256': `SHA256=${signature.toUpperCase()}`, 'x-github-event': 'push' }, body)).status).toBe(202);
  await waitFor(() => driver.prompts.get(threadId)?.length === 2 && settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('verified');
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('[redacted]');
  expect(driver.prompts.get(threadId)!.at(-1)).not.toContain(secret!);
  expect(driver.prompts.get(threadId)!.at(-1)).not.toContain('omitted-marker');

  const limited = await post(trigger, { authorization: `Bearer ${secret}` });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  const rotated = await owner.call('agents.trigger.rotateSecret', { triggerId: trigger.id });
  expect(rotated.secret).not.toBe(secret);
  expect(settingsWithSecret.all(rotated.secret)).toEqual([]);
  expect(new TriggerSecrets(h.dataDir).get(trigger.id)).toBe(rotated.secret);
  expect((await post(trigger, { authorization: `Bearer ${secret}` })).status).toBe(401);
  oldEnough(trigger);
  expect((await post(trigger, { authorization: `Bearer ${rotated.secret}` })).status).toBe(202);
  oldEnough(trigger);
  expect((await post(trigger, { 'x-boite-secret': rotated.secret })).status).toBe(202);
  const current = read(trigger);
  await owner.call('agents.trigger.save', { id: current.id, expectedRevision: current.revision, value: { ...current, enabled: false } });
  expect((await post(trigger, { 'x-boite-secret': rotated.secret })).status).toBe(404);
  await owner.call('agents.trigger.remove', { triggerId: trigger.id });
  expect((await post(trigger)).status).toBe(404);
  expect(new TriggerSecrets(h.dataDir).get(trigger.id)).toBeUndefined();
});

test('malformed signatures leave the body alone and incomplete signed requests cannot hold other webhooks', async () => {
  const { agent } = await makeAgent(h, owner);
  const first = await save(agent.id, { kind: 'webhook' }, 'First');
  const second = await save(agent.id, { kind: 'webhook' }, 'Second');
  const third = await save(agent.id, { kind: 'webhook' }, 'Third');
  const signature = 'sha256=' + '0'.repeat(64);
  const call = (trigger: AgentTrigger, source: string, headers: Record<string, string>, body: string | ReadableStream<Uint8Array<ArrayBuffer>> = '{}') => {
    const url = new URL(trigger.webhookPath!, h.url.replace(/^ws/, 'http'));
    return h.core.workforce.triggers.http(new Request(url.href, { method: 'POST', headers, body }), trigger.id, source);
  };
  const bad = await call(first.trigger, 'source-a', { 'x-hub-signature-256': 'malformed', 'content-length': '65537' });
  expect(bad.status).toBe(401);

  const held: { close: () => void; response: Promise<Response> }[] = [];
  function hold(trigger: AgentTrigger) {
    let controller!: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start: current => { controller = current; } });
    held.push({ close: () => controller.close(), response: call(trigger, 'source-a', { 'x-hub-signature-256': signature }, stream) });
  }
  try {
    hold(first.trigger);
    hold(first.trigger);
    expect((await call(first.trigger, 'source-b', { 'x-hub-signature-256': signature })).status).toBe(429);
    hold(second.trigger);
    hold(second.trigger);
    expect((await call(third.trigger, 'source-a', { 'x-hub-signature-256': signature })).status).toBe(429);
    const accepted = createHmac('sha256', third.secret!).update('{}').digest('hex');
    expect((await call(third.trigger, 'source-b', { 'x-hub-signature-256': 'sha256=' + accepted })).status).toBe(202);
    expect((await call(first.trigger, 'source-a', { 'x-boite-secret': first.secret! })).status).toBe(202);
  } finally {
    for (const request of held) request.close();
    expect((await Promise.all(held.map(async request => (await request.response).status)))).toEqual([401, 401, 401, 401]);
  }
});

test('test events are idempotent, queue while working, and respect the core pause', async () => {
  const { agent, threadId } = await makeAgent(h, owner);
  const { trigger } = await save(agent.id, { kind: 'webhook' });
  expect(await botCommand(owner, threadId, ['triggers'])).toEqual([trigger]);
  await owner.call('turns.start', { threadId, prompt: 'manual hold' });
  await waitFor(() => driver.held.length === 1);
  const params = { triggerId: trigger.id, requestId: 'trigger-check-1' };
  const queued = await owner.call('agents.trigger.test', params);
  expect(queued).toEqual({ outcome: 'queued', turnId: null });
  expect(await owner.call('agents.trigger.test', params)).toEqual(queued);
  driver.release();
  await waitFor(() => read(trigger).lastOutcome === 'fired' && settled(h, threadId));
  expect(driver.prompts.get(threadId)?.filter(prompt => prompt.includes('sample event'))).toHaveLength(1);
  expect(await owner.call('agents.trigger.test', params)).toEqual(queued);
  await owner.call('agents.limits.set', { paused: true });
  expect(await owner.call('agents.trigger.test', { ...params, requestId: 'trigger-check-2' })).toEqual({ outcome: 'skipped', turnId: null });
  expect(turnsOf(h, threadId)).toHaveLength(3);
});

test('file watches debounce matching paths and stop on edit, disable, removal and shutdown', async () => {
  const folder = join(h.dataDir, 'project');
  for (const path of ['src', 'src/node_modules/nested', 'node_modules', 'unwatched']) mkdirSync(join(folder, path), { recursive: true });
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const source = { kind: 'file' as const, projectId: project.id, patterns: ['src/**/*.{ts,tsx}', 'node_modules', 'package.json'], debounceMs: 100 };
  expect(await thrown(save(agent.id, { ...source, patterns: ['../private'] }))).toThrow('relative path');
  expect(await thrown(save(agent.id, { ...source, projectId: 'ungranted' }))).toThrow('granted');
  const { trigger } = await save(agent.id, source);
  const edit = (path: string) => writeFileSync(join(folder, path), '');
  await Bun.sleep(50);
  edit('src/code.ts');
  edit('src/other.ts');
  edit('src/other.js');
  edit('node_modules/skip.ts');
  edit('src/node_modules/nested/also-skip.ts');
  mkdirSync(join(folder, 'src/new/tree'), { recursive: true });
  edit('src/new/tree/new-view.tsx');
  edit('package.json');
  await waitFor(() => driver.prompts.get(threadId)?.length === 2 && settled(h, threadId));
  const prompt = driver.prompts.get(threadId)!.at(-1)!;
  for (const path of ['src/code.ts', 'src/other.ts', 'src/new/tree/new-view.tsx', 'package.json']) expect(prompt).toContain(path);
  expect(prompt).not.toContain('other.js');
  expect(prompt).not.toContain('skip.ts');

  oldEnough(trigger);
  edit('src/edited.ts');
  await Bun.sleep(20);
  let current = read(trigger);
  const edited = await owner.call('agents.trigger.save', { id: current.id, expectedRevision: current.revision, value: { ...current, source: { ...source, patterns: ['unwatched'] } } });
  await Bun.sleep(150);
  expect(read(trigger).lastFiredAt).toBe(edited.trigger.lastFiredAt);
  edit('unwatched/new.ts');
  await waitFor(() => driver.prompts.get(threadId)?.length === 3 && settled(h, threadId));

  oldEnough(trigger);
  edit('unwatched/skip.ts');
  current = read(trigger);
  const disabled = await owner.call('agents.trigger.save', { id: current.id, expectedRevision: current.revision, value: { ...current, enabled: false } });
  edit('unwatched/disabled.ts');
  await Bun.sleep(150);
  expect(read(trigger).lastFiredAt).toBe(disabled.trigger.lastFiredAt);
  await owner.call('agents.trigger.remove', { triggerId: trigger.id });
  await owner.call('projects.archive', { projectId: project.id });
  expect(await thrown(save(agent.id, source))).toThrow('granted');
  await owner.call('projects.archive', { projectId: project.id, archived: false });
  const survivor = (await save(agent.id, source)).trigger;
  h.core.workforce.triggers.close();
  edit('src/after-close.ts');
  await Bun.sleep(150);
  expect(read(survivor).lastFiredAt).toBeNull();
  expect(turnsOf(h, threadId)).toHaveLength(3);
});

test('the PR tracker sends matching transitions of a granted project without a second polling loop', async () => {
  const { threadId: projectThread, accountId } = await echoThread(h, owner);
  const projectId = h.core.journal.getThread(projectThread)!.projectId!;
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [projectId] });
  const { trigger } = await save(agent.id, { kind: 'pr', projectId, events: ['ci_failed', 'review_requested', 'changes_requested', 'conflict', 'merged'] });
  const { agent: outside } = await makeAgent(h, owner);
  expect(await thrown(save(outside.id, { kind: 'pr', projectId, events: ['merged'] }))).toThrow('granted');
  const other = await owner.call('threads.create', { projectId, providerId: 'echo', accountId, title: 'Another PR watch' });
  const triggers = h.core.workforce.triggers;
  const notify = triggers.pullRequest.bind(triggers);
  spyOn(triggers, 'pullRequest').mockImplementation((watchThread, url, transitions) => {
    if (watchThread === other.id && transitions.length > 0) oldEnough(trigger);
    notify(watchThread, url, transitions);
  });

  let state = 'OPEN';
  let moved = false;
  spyOn(h.core.pullRequests, 'gh').mockImplementation((_thread, args) => {
    const query = args.find(arg => arg.startsWith('query='));
    if (!query) return Promise.resolve(args.at(-1)?.includes('/branches/main') ? '{"protected":false}' : '[]');
    const check = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' };
    const pr = {
      state, baseRefName: 'main', headRefOid: 'head', mergeable: moved ? 'CONFLICTING' : 'MERGEABLE',
      mergedBy: state === 'MERGED' ? { login: 'someone' } : null,
      reviewRequests: { nodes: moved ? [{ id: 'new-request' }] : [] },
      changeReviews: { nodes: moved ? [{ id: 'changes' }] : [] },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: moved ? [check] : [] } } } }] },
    };
    return Promise.resolve(JSON.stringify({ data: { viewer: { login: 'tracker' }, repository: { pullRequest: pr } } }));
  });
  const url = 'https://github.com/example/boite/pull/7';
  const watches = h.core.pullRequestWatches;
  await watches.watch(projectThread, url);
  await watches.watch(other.id, url);
  expect(read(trigger).lastFiredAt).toBeNull();
  moved = true;
  await watches.pass();
  await watches.pass();
  await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) >= 2 && read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
  expect(turnsOf(h, threadId)).toHaveLength(2);
  const prompt = driver.prompts.get(threadId)!.at(-1)!;
  for (const event of ['ci_failed', 'review_requested', 'changes_requested', 'conflict']) expect(prompt).toContain(event);
  expect(prompt).toContain(url);
  oldEnough(trigger);
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(2);

  state = 'MERGED';
  await watches.pass();
  await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) >= 3 && read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
  expect(turnsOf(h, threadId)).toHaveLength(3);
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('merged');
});
