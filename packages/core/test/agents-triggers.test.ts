import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import * as files from 'node:fs/promises';
import { request, type ClientRequest } from 'node:http';
import { basename, dirname, join, sep } from 'node:path';
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

async function saveWatching(folder: string, agentId: string, source: AgentTriggerSource) {
  const watching = spyOn(fs, 'watch');
  try {
    const result = await save(agentId, source);
    await waitFor(() => watching.mock.calls.some(([path]) => path === folder));
    return result;
  } finally { watching.mockRestore(); }
}

function holdRootProbe(folder: string) {
  const root = fs.statSync(folder, { bigint: true });
  const held = Promise.withResolvers<fs.BigIntStats>();
  const real = files.stat;
  let calls = 0;
  const probe = spyOn(files, 'stat').mockImplementation(((path: fs.PathLike, options?: object) => {
    if (path !== folder || !options || !('bigint' in options)) return real(path, options as never);
    calls++;
    return held.promise;
  }) as typeof files.stat);
  return {
    calls: () => calls,
    finish(error?: Error) {
      probe.mockRestore();
      if (error && calls) held.reject(error);
      else held.resolve(root);
    },
  };
}

function controlFileEvents(folder: string, parentReadable = true) {
  type Listener = fs.WatchListener<string | Buffer>;
  const listeners = new Map<string, Listener>();
  const parent = dirname(folder);
  const realWatch = fs.watch;
  const watcher = spyOn(fs, 'watch').mockImplementation(((path: fs.PathLike, options: fs.WatchOptions, listener: Listener) => {
    if (typeof path !== 'string' || (path !== parent && path !== folder && !path.startsWith(folder + sep))) return realWatch(path, options, listener);
    if (path === parent && !parentReadable) throw Object.assign(new Error('parent is not readable'), { code: 'EACCES' });
    listeners.set(path, listener);
    return Object.assign(new EventEmitter(), {
      close() { if (listeners.get(path) === listener) listeners.delete(path); },
    });
  }) as typeof fs.watch);
  return { listeners, restore: () => watcher.mockRestore() };
}

function observeNativeRootRenames(folder: string) {
  type Listener = fs.WatchListener<string | Buffer>;
  const parent = dirname(folder);
  const renames: string[] = [];
  const watched = new Set<string>();
  let parentMoved = false;
  const realWatch = fs.watch;
  const spy = spyOn(fs, 'watch').mockImplementation(((path: fs.PathLike, options: fs.WatchOptions, listener: Listener) => {
    const watcher = realWatch(path, options, (event, name) => {
      listener(event, name);
      if ((path === folder || path === parent) && event === 'rename' && name === basename(folder)) renames.push(path);
      if (path === parent && event === 'rename' && name === basename(parent)) parentMoved = true;
    });
    if (typeof path === 'string') watched.add(path);
    return watcher;
  }) as typeof fs.watch);
  return { watched, renames, parentMoved: () => parentMoved, restore: () => spy.mockRestore() };
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

test('webhooks count two Funnel clients behind loopback under their own addresses', async () => {
  const { agent } = await makeAgent(h, owner);
  const first = await save(agent.id, { kind: 'webhook' }, 'First');
  const second = await save(agent.id, { kind: 'webhook' }, 'Second');
  const third = await save(agent.id, { kind: 'webhook' }, 'Third');
  const headers = (address: string, signature: string) => ({
    'tailscale-funnel-request': '?1', 'x-forwarded-for': address, 'x-hub-signature-256': 'sha256=' + signature,
  });
  const held: ClientRequest[] = [];
  const entered = spyOn(h.core.workforce.triggers, 'http');
  try {
    for (const trigger of [first.trigger, first.trigger, second.trigger, second.trigger]) {
      const url = new URL(trigger.webhookPath!, h.url.replace(/^ws/, 'http'));
      const req = request(url, { method: 'POST', headers: { ...headers('203.0.113.1', '0'.repeat(64)), 'content-length': '2' } });
      req.on('error', () => undefined);
      held.push(req);
      req.write('{');
      req.flushHeaders();
    }
    await waitFor(() => entered.mock.calls.length === 4);
    const signature = createHmac('sha256', third.secret!).update('{}').digest('hex');
    expect((await post(third.trigger, headers('203.0.113.1', signature))).status).toBe(429);
    expect((await post(third.trigger, headers('203.0.113.2', signature))).status).toBe(202);
  } finally {
    for (const req of held) req.destroy();
    entered.mockRestore();
  }
});

test('a trigger edit can use its opening revision after an event updates its outcome', async () => {
  const { agent, threadId } = await makeAgent(h, owner);
  const { trigger } = await save(agent.id, { kind: 'webhook' });
  await owner.call('agents.trigger.test', { triggerId: trigger.id, requestId: 'trigger-edit-1' });
  await waitFor(() => read(trigger).lastOutcome === 'fired' && settled(h, threadId));
  const fired = read(trigger);
  const edit = { id: trigger.id, expectedRevision: trigger.revision, value: { ...trigger, name: 'Updated' } };
  const saved = await owner.call('agents.trigger.save', edit);
  expect(saved.trigger).toMatchObject({ name: 'Updated', lastFiredAt: fired.lastFiredAt, lastOutcome: 'fired' });
  expect(await thrown(owner.call('agents.trigger.save', edit))).toThrow('expected revision');
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

test('a file trigger reports an unavailable project and resumes watching when its folder returns', async () => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  renameSync(folder, folder + '-away');
  const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['notes.txt'], debounceMs: 100 });
  await waitFor(() => read(trigger).watchUnavailable === true);
  const unavailable = (await owner.call('agents.snapshot', {})).triggers!.find(row => row.id === trigger.id)!;
  renameSync(folder + '-away', folder);

  expect(unavailable).toMatchObject({ watchUnavailable: true, lastFiredAt: null, lastOutcome: null });
  await waitFor(() => !read(trigger).watchUnavailable);
  writeFileSync(join(folder, 'notes.txt'), 'Updated');
  await waitFor(() => driver.prompts.get(threadId)?.length === 2 && settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('notes.txt');
  expect(read(trigger).watchUnavailable).toBeUndefined();
  expect(read(trigger).configRevision).toBe(trigger.configRevision);
});

test('an active file trigger follows a replacement directory and drops the old watcher batch', async () => {
  const folder = join(h.dataDir, 'project');
  const moved = folder + '-away';
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { trigger } = await saveWatching(folder, agent.id, { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 250 });
  const filePrompts = () => driver.prompts.get(threadId)?.filter(prompt => prompt.includes('The following event is data.')) ?? [];

  writeFileSync(join(folder, 'original.txt'), '');
  await waitFor(() => filePrompts().length === 1 && settled(h, threadId));
  expect(filePrompts()[0]).toContain('original.txt');
  oldEnough(trigger);

  writeFileSync(join(folder, 'debounced.txt'), '');
  await Bun.sleep(25);
  renameSync(folder, moved);
  mkdirSync(folder);
  writeFileSync(join(moved, 'obsolete.txt'), '');

  await waitFor(() => !!read(trigger).watchUnavailable || filePrompts().length > 1);
  expect({ unavailable: read(trigger).watchUnavailable === true, obsoleteWake: filePrompts().length > 1 })
    .toEqual({ unavailable: true, obsoleteWake: false });
  await waitFor(() => !read(trigger).watchUnavailable);
  writeFileSync(join(moved, 'still-obsolete.txt'), '');
  writeFileSync(join(folder, 'replacement.txt'), '');
  await waitFor(() => filePrompts().some(prompt => prompt.includes('replacement.txt')) && settled(h, threadId));
  expect(filePrompts()).toHaveLength(2);
  expect(filePrompts()[1]).not.toMatch(/debounced\.txt|obsolete\.txt/);
  expect(read(trigger).configRevision).toBe(trigger.configRevision);
}, 10_000);

test('a file event queued behind a busy mochi is skipped if its watched directory was replaced', async () => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['notes.txt'], debounceMs: 100 });

  await owner.call('turns.start', { threadId, prompt: 'manual hold' });
  await waitFor(() => driver.held.length === 1);
  writeFileSync(join(folder, 'notes.txt'), '');
  await waitFor(() => read(trigger).lastOutcome === 'queued');
  renameSync(folder, folder + '-away');
  mkdirSync(folder);
  driver.release();

  await waitFor(() => read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
  expect(read(trigger).lastOutcome).toBe('skipped');
  expect(turnsOf(h, threadId)).toHaveLength(2);
});

test('a stalled root probe leaves the RPC responsive and holds file wakes across watchers of that root', async () => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const source = { kind: 'file' as const, projectId: project.id, patterns: ['notes.txt'], debounceMs: 50 };
  const { trigger } = await saveWatching(folder, agent.id, source);
  const other = (await save(agent.id, { ...source, patterns: ['other.txt'] }, 'Other files')).trigger;
  await owner.call('turns.start', { threadId, prompt: 'manual hold' });
  await waitFor(() => driver.held.length === 1);
  writeFileSync(join(folder, 'notes.txt'), '');
  await waitFor(() => read(trigger).lastOutcome === 'queued');

  const held = holdRootProbe(folder);
  const realSync = fs.statSync;
  let syncReads = 0;
  const sync = spyOn(fs, 'statSync').mockImplementation(((path: fs.PathLike, options?: object) => {
    if (path === folder && options && 'bigint' in options) syncReads++;
    return realSync(path, options as never);
  }) as typeof fs.statSync);
  const triggers = h.core.workforce.triggers;
  try {
    triggers.tick();
    expect(syncReads).toBe(0);
    await waitFor(() => held.calls() === 1);
    driver.release();
    await waitFor(() => settled(h, threadId));
    writeFileSync(join(folder, 'other.txt'), '');
    await Bun.sleep(100);
    triggers.tick();
    triggers.tick();
    const snapshot = await owner.call('agents.snapshot', {});
    expect(snapshot.triggers!.find(row => row.id === trigger.id)?.lastOutcome).toBe('queued');
    expect(snapshot.triggers!.find(row => row.id === other.id)?.lastOutcome).toBeNull();
    expect(turnsOf(h, threadId)).toHaveLength(2);
    expect(held.calls()).toBe(1);
  } finally {
    sync.mockRestore();
    held.finish();
  }
  await waitFor(() => read(trigger).lastOutcome === 'fired' && read(other).lastOutcome === 'fired' && settled(h, threadId));
});

test('a late root probe cannot retire a reconfigured watch or reopen one after shutdown', async () => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const source = { kind: 'file' as const, projectId: project.id, patterns: ['notes.txt'], debounceMs: 50 };
  const { trigger } = await saveWatching(folder, agent.id, source);
  writeFileSync(join(folder, 'notes.txt'), '');
  await waitFor(() => read(trigger).lastOutcome === 'fired' && settled(h, threadId));
  oldEnough(trigger);

  const triggers = h.core.workforce.triggers;
  const oldProbe = holdRootProbe(folder);
  const watching = spyOn(fs, 'watch');
  try {
    triggers.tick();
    await waitFor(() => oldProbe.calls() === 1);
    const current = read(trigger);
    await owner.call('agents.trigger.save', { id: current.id, expectedRevision: current.revision,
      value: { ...current, source: { ...source, patterns: ['new.txt'] } } });
    expect(oldProbe.calls()).toBe(1);
    oldProbe.finish(new Error('old root probe failed'));
    await waitFor(() => watching.mock.calls.some(([path]) => path === folder));
  } finally {
    oldProbe.finish();
    watching.mockRestore();
  }
  const edited = read(trigger);
  expect(edited.watchUnavailable).toBeUndefined();
  writeFileSync(join(folder, 'new.txt'), '');
  await waitFor(() => read(trigger).lastFiredAt !== edited.lastFiredAt && settled(h, threadId));

  const lastProbe = holdRootProbe(folder);
  try {
    triggers.tick();
    await waitFor(() => lastProbe.calls() === 1);
    triggers.close();
    lastProbe.finish(new Error('root probe failed after close'));
    const snapshot = await owner.call('agents.snapshot', {});
    expect(snapshot.triggers!.find(row => row.id === trigger.id)?.watchUnavailable).toBeUndefined();
  } finally { lastProbe.finish(); }
});

test.each([true, false])('a root rename invalidates the earlier sample (parent readable: %s)', async parentReadable => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder, parentReadable);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['notes.txt'], debounceMs: 50 });
    await waitFor(() => listeners.has(folder));
    const parent = dirname(folder);
    const parentEvent = listeners.get(parent);
    expect(!!parentEvent).toBe(parentReadable);
    await owner.call('turns.start', { threadId, prompt: 'manual hold' });
    await waitFor(() => driver.held.length === 1);
    listeners.get(folder)!('change', 'notes.txt');
    await waitFor(() => read(trigger).lastOutcome === 'queued');

    const held = holdRootProbe(folder);
    try {
      h.core.workforce.triggers.tick();
      await waitFor(() => held.calls() === 1);
      driver.release();
      await waitFor(() => settled(h, threadId));
      renameSync(folder, folder + '-away');
      mkdirSync(folder);
      // A readable parent is sufficient, even if the root watcher emits nothing.
      (parentEvent ?? listeners.get(folder)!)('rename', basename(folder));
    } finally { held.finish(); }

    await waitFor(() => read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
    expect(read(trigger).lastOutcome).toBe('skipped');
    expect(turnsOf(h, threadId)).toHaveLength(2);
    expect(listeners.has(folder)).toBe(false);
    expect(listeners.has(parent)).toBe(false);
    if (parentReadable) {
      await waitFor(() => listeners.has(folder) && !read(trigger).watchUnavailable);
      expect(listeners.get(parent)).toBeDefined();
      expect(listeners.get(parent)).not.toBe(parentEvent);
      h.core.workforce.triggers.close();
      expect(listeners.has(parent)).toBe(false);
    }
  } finally { restore(); }
});

test.skipIf(process.platform !== 'linux')('native renames of a child named like the root do not hold a queued wake', async () => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const child = join(folder, basename(folder));
  const alternate = join(folder, 'scratch');
  writeFileSync(child, '');
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { watched, renames, restore } = observeNativeRootRenames(folder);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['notes.txt'], debounceMs: 50 });
    await waitFor(() => watched.has(folder));
    await owner.call('turns.start', { threadId, prompt: 'manual hold' });
    await waitFor(() => driver.held.length === 1);
    writeFileSync(join(folder, 'notes.txt'), '');
    await waitFor(() => read(trigger).lastOutcome === 'queued');

    const root = fs.statSync(folder, { bigint: true });
    const releaseProbes: Array<(root: fs.BigIntStats) => void> = [];
    const realStat = files.stat;
    const stat = spyOn(files, 'stat').mockImplementation(((path: fs.PathLike, options?: object) => {
      if (path !== folder || !options || !('bigint' in options)) return realStat(path, options as never);
      const probe = Promise.withResolvers<fs.BigIntStats>();
      releaseProbes.push(probe.resolve);
      return probe.promise;
    }) as typeof files.stat);
    try {
      h.core.workforce.triggers.tick();
      await waitFor(() => releaseProbes.length === 1);
      driver.release();
      await waitFor(() => settled(h, threadId));
      for (let i = 0; i < 6; i++) {
        const before = renames.length;
        if (i % 2 === 0) renameSync(child, alternate);
        else renameSync(alternate, child);
        await waitFor(() => renames.length > before);
        if (read(trigger).lastOutcome === 'queued') {
          releaseProbes[i]!(root);
          await waitFor(() => releaseProbes.length > i + 1 || read(trigger).lastOutcome !== 'queued');
        }
      }
      expect(read(trigger).lastOutcome).toBe('fired');
      await waitFor(() => settled(h, threadId));
      expect(driver.prompts.get(threadId)!.at(-1)).toContain('notes.txt');
      expect(renames).toEqual(Array(6).fill(folder));
    } finally {
      stat.mockRestore();
      for (const release of releaseProbes) release(root);
    }
  } finally { restore(); }
});

test.skipIf(process.platform !== 'linux').each([false, true])('a native root rename makes an already sampled probe stale (parent replaced: %s)', async replaceParent => {
  const parent = join(h.dataDir, 'projects');
  const folder = join(parent, 'project');
  mkdirSync(folder, { recursive: true });
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { watched, renames, parentMoved, restore } = observeNativeRootRenames(folder);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['notes.txt'], debounceMs: 50 });
    await waitFor(() => watched.has(folder));
    await owner.call('turns.start', { threadId, prompt: 'manual hold' });
    await waitFor(() => driver.held.length === 1);
    writeFileSync(join(folder, 'notes.txt'), '');
    await waitFor(() => read(trigger).lastOutcome === 'queued');

    if (replaceParent) {
      const moved = parent + '-away';
      renameSync(parent, moved);
      mkdirSync(parent);
      // The project retains its inode, while the parent watcher still points at the old directory.
      renameSync(join(moved, basename(folder)), folder);
      await waitFor(parentMoved);
      renames.length = 0;
    }

    const held = holdRootProbe(folder);
    try {
      h.core.workforce.triggers.tick();
      await waitFor(() => held.calls() === 1);
      driver.release();
      await waitFor(() => settled(h, threadId));
      renameSync(folder, folder + '-away');
      mkdirSync(folder);
      await waitFor(() => renames.includes(folder));
    } finally { held.finish(); }

    await waitFor(() => read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
    expect(read(trigger).lastOutcome).toBe('skipped');
    expect(turnsOf(h, threadId)).toHaveLength(2);
  } finally { restore(); }
});

test('an EIO from an obsolete child scan leaves the replacement watch active', async () => {
  const folder = join(h.dataDir, 'project');
  const child = join(folder, 'src');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder);
  const oldScan = Promise.withResolvers<fs.Dirent[]>();
  const realRead = files.readdir;
  let scanning = false;
  const readdir = spyOn(files, 'readdir').mockImplementation(((path: fs.PathLike, options?: object) => {
    if (path !== child || scanning) return realRead(path, options as never);
    scanning = true;
    return oldScan.promise;
  }) as typeof files.readdir);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['src/*.txt'], debounceMs: 50 });
    await waitFor(() => listeners.has(folder));
    const rootEvent = listeners.get(folder)!;
    mkdirSync(child);
    rootEvent('rename', 'src');
    await waitFor(() => scanning);
    const previousChild = listeners.get(child);
    renameSync(child, join(h.dataDir, 'old-src'));
    mkdirSync(child);
    rootEvent('rename', 'src');
    await waitFor(() => listeners.has(child) && listeners.get(child) !== previousChild);
    const currentChild = listeners.get(child)!;
    currentChild('change', 'first.txt');
    await waitFor(() => read(trigger).lastOutcome === 'fired' && settled(h, threadId));

    oldScan.reject(Object.assign(new Error('obsolete directory read failed'), { code: 'EIO' }));
    const snapshot = await owner.call('agents.snapshot', {});
    expect(snapshot.triggers!.find(row => row.id === trigger.id)?.watchUnavailable).toBeUndefined();
    expect(listeners.get(child)).toBe(currentChild);
    oldEnough(trigger);
    currentChild('change', 'second.txt');
    await waitFor(() => driver.prompts.get(threadId)?.at(-1)?.includes('src/second.txt') === true && settled(h, threadId));
  } finally {
    oldScan.resolve([]);
    readdir.mockRestore();
    restore();
  }
});

test('an EIO from an obsolete child lookup leaves the watch active after a newer lookup finds a file', async () => {
  const folder = join(h.dataDir, 'project');
  const child = join(folder, 'src');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder);
  const oldLookup = Promise.withResolvers<fs.Stats>();
  const realLstat = files.lstat;
  let lookingUp = false;
  const lstat = spyOn(files, 'lstat').mockImplementation(((path: fs.PathLike, options?: object) => {
    if (path !== child || lookingUp) return realLstat(path, options as never);
    lookingUp = true;
    return oldLookup.promise;
  }) as typeof files.lstat);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['src'], debounceMs: 50 });
    await waitFor(() => listeners.has(folder));
    const rootEvent = listeners.get(folder)!;
    mkdirSync(child);
    rootEvent('rename', 'src');
    await waitFor(() => lookingUp);
    renameSync(child, join(h.dataDir, 'old-src'));
    writeFileSync(child, '');
    rootEvent('rename', 'src');
    await waitFor(() => read(trigger).lastOutcome === 'fired' && settled(h, threadId));
    expect(listeners.has(child)).toBe(false);

    oldLookup.reject(Object.assign(new Error('obsolete directory lookup failed'), { code: 'EIO' }));
    const snapshot = await owner.call('agents.snapshot', {});
    expect(snapshot.triggers!.find(row => row.id === trigger.id)?.watchUnavailable).toBeUndefined();
    expect(listeners.get(folder)).toBe(rootEvent);
    oldEnough(trigger);
    rootEvent('change', 'src');
    await waitFor(() => turnsOf(h, threadId).length === 3 && settled(h, threadId));
  } finally {
    oldLookup.resolve(fs.lstatSync(folder));
    lstat.mockRestore();
    restore();
  }
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
  let status = 'FAILURE';
  let statusCreatedAt = '2026-11-25T12:00:00Z';
  let baseCheck: { status: string; completedAt?: string } | null = null;
  spyOn(h.core.pullRequests, 'gh').mockImplementation((_thread, args) => {
    const query = args.find(arg => arg.startsWith('query='));
    if (!query) return Promise.resolve(args.at(-1)?.includes('/branches/main') ? '{"protected":false}' : '[]');
    const check = { __typename: 'StatusContext', context: 'test', state: status, targetUrl: 'https://ci.example/test', createdAt: statusCreatedAt };
    const pr = {
      state, baseRefName: 'main', headRefOid: 'head', mergeable: moved ? 'CONFLICTING' : 'MERGEABLE',
      mergedBy: state === 'MERGED' ? { login: 'someone' } : null,
      reviewRequests: { nodes: moved ? [{ id: 'new-request' }] : [] },
      changeReviews: { nodes: moved ? [{ id: 'changes' }] : [] },
      baseRef: { target: { oid: 'base', statusCheckRollup: { contexts: {
        nodes: baseCheck ? [{ __typename: 'CheckRun', name: 'base CI', conclusion: 'FAILURE', detailsUrl: 'https://ci.example/base', ...baseCheck }] : [],
        checkRunCountsByState: baseCheck ? [{ state: baseCheck.status, count: 1 }] : [],
      } } } },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: {
        nodes: moved ? [check] : [], statusContextCountsByState: moved ? [{ state: status, count: 1 }] : [],
      } } } }] },
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

  status = 'PENDING';
  statusCreatedAt = '2026-11-25T12:05:00Z';
  await watches.pass();
  status = 'FAILURE';
  statusCreatedAt = '2026-11-25T12:10:00Z';
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(3);
  await waitFor(() => settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('ci_failed');

  baseCheck = { status: 'COMPLETED', completedAt: '2026-11-25T12:15:00Z' };
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(4);
  await waitFor(() => settled(h, threadId));
  baseCheck = { status: 'IN_PROGRESS' };
  await watches.pass();
  baseCheck = { status: 'COMPLETED', completedAt: '2026-11-25T12:20:00Z' };
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(5);
  await waitFor(() => settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('ci_failed');

  state = 'MERGED';
  await watches.pass();
  await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) >= 6 && read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
  expect(turnsOf(h, threadId)).toHaveLength(6);
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('merged');
});
