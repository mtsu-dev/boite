import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import * as files from 'node:fs/promises';
import { request, type ClientRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import type { AgentTrigger, AgentTriggerSource } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { botCommand } from '../src/agents/cli.ts';
import { PATHS_PER_EVENT, TriggerRootProbes, WatchLimitError, watchTriggerFiles } from '../src/agents/trigger-files.ts';
import { TriggerSecrets } from '../src/agents/trigger-secrets.ts';
import { WEBHOOK_MAX_BODY_BYTES } from '../src/agents/trigger-webhook.ts';
import { makeAgent, scripted, settled, turnsOf } from './agent-fixture.ts';
import { echoThread, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';
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
  const root = fs.lstatSync(folder, { bigint: true });
  const held = Promise.withResolvers<fs.BigIntStats>();
  const real = files.lstat;
  let calls = 0;
  const probe = spyOn(files, 'lstat').mockImplementation(((path: fs.PathLike, options?: object) => {
    if (path !== folder || !options || !('bigint' in options)) return real(path, options as never);
    calls++;
    return held.promise;
  }) as typeof files.lstat);
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

test('a webhook authenticates three ways, streams up to 1 MiB, blocks replays, rotates without leaking, and enforces cooldown', async () => {
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
  expect((await post(trigger, { authorization: `Bearer ${secret}` }, 'x'.repeat(WEBHOOK_MAX_BODY_BYTES + 1))).status).toBe(413);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(600_000));
    controller.enqueue(new Uint8Array(600_000));
    controller.close();
  } });
  expect((await post(trigger, { 'x-boite-secret': secret! }, stream)).status).toBe(413);

  const body = JSON.stringify({ action: 'verified', token: secret, long: 'x'.repeat(80_000) + 'omitted-marker' });
  const signature = createHmac('sha256', secret!).update(body).digest('hex');
  expect((await post(trigger, { 'x-hub-signature-256': `sha256=${signature}`, 'x-github-event': 'push' }, body + '!')).status).toBe(401);
  expect((await post(trigger, {
    'x-hub-signature-256': `SHA256=${signature.toUpperCase()}`, 'x-github-event': 'push', 'x-github-delivery': 'delivery-1',
  }, body)).status).toBe(202);
  await waitFor(() => driver.prompts.get(threadId)?.length === 2 && settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('verified');
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('[redacted]');
  expect(driver.prompts.get(threadId)!.at(-1)).not.toContain(secret!);
  expect(driver.prompts.get(threadId)!.at(-1)).not.toContain('omitted-marker');

  const limited = await post(trigger, { authorization: `Bearer ${secret}` });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

  oldEnough(trigger);
  expect((await post(trigger, {
    'x-hub-signature-256': `sha256=${signature}`, 'x-github-delivery': 'delivery-1',
  }, body)).status).toBe(409);
  // Even without X-GitHub-Delivery or with a forged delivery header, replaying the signed body within the window returns 409.
  expect((await post(trigger, { 'x-hub-signature-256': `sha256=${signature}` }, body)).status).toBe(409);
  expect((await post(trigger, { 'x-hub-signature-256': `sha256=${signature}`, 'x-github-delivery': 'delivery-forged' }, body)).status).toBe(409);

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

test('malformed signatures leave the body alone and one slow source cannot starve another source on the same trigger', async () => {
  const { agent } = await makeAgent(h, owner);
  const first = await save(agent.id, { kind: 'webhook' }, 'First');
  const second = await save(agent.id, { kind: 'webhook' }, 'Second');
  const third = await save(agent.id, { kind: 'webhook' }, 'Third');
  const signature = 'sha256=' + '0'.repeat(64);
  const call = (trigger: AgentTrigger, source: string, headers: Record<string, string>, body: string | ReadableStream<Uint8Array<ArrayBuffer>> = '{}') => {
    const url = new URL(trigger.webhookPath!, h.url.replace(/^ws/, 'http'));
    return h.core.workforce.triggers.http(new Request(url.href, { method: 'POST', headers, body }), trigger.id, source);
  };
  const bad = await call(first.trigger, 'source-a', { 'x-hub-signature-256': 'malformed', 'content-length': String(WEBHOOK_MAX_BODY_BYTES + 1) });
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
    expect((await call(first.trigger, 'source-a', { 'x-hub-signature-256': signature })).status).toBe(429);
    const firstAccepted = createHmac('sha256', first.secret!).update('{}').digest('hex');
    expect((await call(first.trigger, 'source-b', { 'x-hub-signature-256': 'sha256=' + firstAccepted })).status).toBe(202);
    hold(second.trigger);
    hold(second.trigger);
    expect((await call(third.trigger, 'source-a', { 'x-hub-signature-256': signature })).status).toBe(429);
    const accepted = createHmac('sha256', third.secret!).update('{}').digest('hex');
    expect((await call(third.trigger, 'source-b', { 'x-hub-signature-256': 'sha256=' + accepted })).status).toBe(202);
    oldEnough(first.trigger);
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

test('test events are idempotent, queue without clobbering real events or cooldown, and respect the core pause', async () => {
  const { agent, threadId } = await makeAgent(h, owner);
  const { trigger, secret } = await save(agent.id, { kind: 'webhook' });
  expect(await botCommand(owner, threadId, ['triggers'])).toEqual([trigger]);
  await owner.call('turns.start', { threadId, prompt: 'manual hold' });
  await waitFor(() => driver.held.length === 1);
  expect((await post(trigger, { 'x-boite-secret': secret! }, JSON.stringify({ real: 'payload' }))).status).toBe(202);
  const params = { triggerId: trigger.id, requestId: 'trigger-check-1' };
  const queued = await owner.call('agents.trigger.test', params);
  expect(queued).toEqual({ outcome: 'queued', turnId: null });
  expect(await owner.call('agents.trigger.test', params)).toEqual(queued);
  driver.release();
  await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) === 4 && settled(h, threadId));
  const prompts = driver.prompts.get(threadId)!;
  expect(prompts.some(prompt => prompt.includes('payload'))).toBe(true);
  expect(prompts.filter(prompt => prompt.includes('sample event'))).toHaveLength(1);
  expect(await owner.call('agents.trigger.test', params)).toEqual(queued);

  // A standalone test run does not start a cooldown against subsequent real webhooks.
  oldEnough(trigger);
  await owner.call('agents.trigger.test', { triggerId: trigger.id, requestId: 'trigger-check-cooldown' });
  await waitFor(() => turnsOf(h, threadId).length === 5 && settled(h, threadId));
  expect((await post(trigger, { 'x-boite-secret': secret! }, JSON.stringify({ afterTest: true }))).status).toBe(202);
  await waitFor(() => turnsOf(h, threadId).length === 6 && settled(h, threadId));

  await owner.call('agents.limits.set', { paused: true });
  expect(await owner.call('agents.trigger.test', { ...params, requestId: 'trigger-check-2' })).toEqual({ outcome: 'skipped', turnId: null });
  expect(turnsOf(h, threadId)).toHaveLength(6);
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

test.skipIf(process.platform === 'win32')('an active file trigger follows a replacement directory and drops the old watcher batch', async () => {
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

test.skipIf(process.platform === 'win32')('a file event queued behind a busy mochi is skipped if its watched directory was replaced', async () => {
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
  const realSync = fs.lstatSync;
  let syncReads = 0;
  const sync = spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike, options?: object) => {
    if (path === folder && options && 'bigint' in options) syncReads++;
    return realSync(path, options as never);
  }) as typeof fs.lstatSync);
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

    const root = fs.lstatSync(folder, { bigint: true });
    const releaseProbes: Array<(root: fs.BigIntStats) => void> = [];
    const realStat = files.lstat;
    const stat = spyOn(files, 'lstat').mockImplementation(((path: fs.PathLike, options?: object) => {
      if (path !== folder || !options || !('bigint' in options)) return realStat(path, options as never);
      const probe = Promise.withResolvers<fs.BigIntStats>();
      releaseProbes.push(probe.resolve);
      return probe.promise;
    }) as typeof files.lstat);
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
  const { agent: paused } = await makeAgent(h, owner, { projectIds: [projectId], status: 'paused' });
  const { trigger: pausedTrigger } = await save(paused.id, { kind: 'pr', projectId, events: ['ci_failed', 'merged'] }, 'Paused PR');
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
  expect(read(pausedTrigger)).toMatchObject({ lastFiredAt: null, lastOutcome: null });
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

  // A second failed run of the same check between two polls (no intermediate PENDING) still fires.
  statusCreatedAt = '2026-11-25T12:12:00Z';
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(4);
  await waitFor(() => settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('ci_failed');

  baseCheck = { status: 'COMPLETED', completedAt: '2026-11-25T12:15:00Z' };
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(5);
  await waitFor(() => settled(h, threadId));
  baseCheck = { status: 'IN_PROGRESS' };
  await watches.pass();
  baseCheck = { status: 'COMPLETED', completedAt: '2026-11-25T12:20:00Z' };
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(6);
  await waitFor(() => settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('ci_failed');

  // Consecutive failed base runs without an intermediate IN_PROGRESS poll still fire.
  baseCheck = { status: 'COMPLETED', completedAt: '2026-11-25T12:22:00Z' };
  await watches.pass();
  expect(turnsOf(h, threadId)).toHaveLength(7);
  await waitFor(() => settled(h, threadId));
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('ci_failed');

  state = 'MERGED';
  await watches.pass();
  await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) >= 8 && read(trigger).lastOutcome !== 'queued' && settled(h, threadId));
  expect(turnsOf(h, threadId)).toHaveLength(8);
  expect(driver.prompts.get(threadId)!.at(-1)).toContain('merged');
  expect(read(pausedTrigger)).toMatchObject({ lastFiredAt: null, lastOutcome: null });
});

test('a file trigger rejects a project root replaced by a symlink or junction', async () => {
  const folder = join(h.dataDir, 'project');
  const outside = join(h.dataDir, 'outside');
  mkdirSync(folder);
  mkdirSync(outside);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50 });
    await waitFor(() => listeners.has(folder));
    renameSync(folder, folder + '-original');
    symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
    listeners.get(dirname(folder))!('rename', basename(folder));
    await waitFor(() => read(trigger).watchUnavailable === true);
    h.core.workforce.triggers.tick();
    await Bun.sleep(100);
    expect(read(trigger).watchUnavailable).toBe(true);
    expect(listeners.has(folder)).toBe(false);
    expect(turnsOf(h, threadId)).toHaveLength(1);
  } finally { restore(); }
});

test('file watches prune gitignored and unmatched folders, skip unreadable subdirs, cap directories, and report path overflow', async () => {
  const folder = join(h.dataDir, 'pruned-project');
  for (const dir of ['src/sub', 'ignored-dir', 'other-tree', 'src/locked']) mkdirSync(join(folder, dir), { recursive: true });
  writeFileSync(join(folder, '.gitignore'), 'ignored-dir/\n');
  if (process.platform !== 'win32') chmodSync(join(folder, 'src/locked'), 0o000);
  const { listeners, restore } = controlFileEvents(folder);
  const batches: Array<{ paths: string[]; more: number }> = [];
  let unavailable = false;
  const roots = new TriggerRootProbes();
  let watch: ReturnType<typeof watchTriggerFiles> | undefined;
  let capped: ReturnType<typeof watchTriggerFiles> | undefined;
  try {
    watch = watchTriggerFiles(
      folder,
      ['src/**/*.ts'],
      40,
      roots,
      {
        publish: (paths, more) => { batches.push({ paths, more }); },
        ready: () => undefined,
        failed: () => { unavailable = true; },
      },
    );
    await waitFor(() => listeners.has(join(folder, 'src/sub')));
    expect(unavailable).toBe(false);
    expect(listeners.has(join(folder, 'ignored-dir'))).toBe(false);
    expect(listeners.has(join(folder, 'other-tree'))).toBe(false);

    const srcSub = listeners.get(join(folder, 'src/sub'))!;
    for (let i = 0; i < PATHS_PER_EVENT + 5; i++) srcSub('change', `f${i}.ts`);
    await waitFor(() => batches.length === 1);
    expect(batches[0]!.paths).toHaveLength(PATHS_PER_EVENT);
    expect(batches[0]!.more).toBe(5);

    let capHit = false;
    capped = watchTriggerFiles(
      folder,
      ['src/**/*.ts'],
      40,
      roots,
      { publish: () => undefined, ready: () => undefined, failed: () => { capHit = true; } },
      1,
    );
    await waitFor(() => capHit);
    expect(capHit).toBe(true);
  } finally {
    watch?.close();
    capped?.close();
    restore();
    if (process.platform !== 'win32') chmodSync(join(folder, 'src/locked'), 0o700);
  }
});

test('file events arriving during cooldown coalesce and dispatch once cooldown expires', async () => {
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { trigger } = await saveWatching(folder, agent.id, { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50 });

  writeFileSync(join(folder, 'first.txt'), '');
  await waitFor(() => driver.prompts.get(threadId)?.length === 2 && settled(h, threadId));
  const firstFiredAt = read(trigger).lastFiredAt!;

  writeFileSync(join(folder, 'during-1.txt'), '');
  await waitFor(() => read(trigger).lastOutcome === 'queued');
  expect(read(trigger).lastFiredAt).toBe(firstFiredAt);
  writeFileSync(join(folder, 'during-2.txt'), '');
  await Bun.sleep(100);
  expect(turnsOf(h, threadId)).toHaveLength(2);

  oldEnough(trigger);
  h.core.workforce.triggers.tick();
  await waitFor(() => driver.prompts.get(threadId)?.length === 3 && settled(h, threadId));
  const prompt = driver.prompts.get(threadId)!.at(-1)!;
  expect(prompt).toContain('during-1.txt');
  expect(prompt).toContain('during-2.txt');
  expect(read(trigger).lastOutcome).toBe('fired');
});

test('writes during a mochi\'s own file-trigger turn do not re-wake that trigger', async () => {
  driver.restore();
  driver = scripted(ctx => ({ text: '[quiet] tested', hold: ctx.prompt.includes('first.txt') }));
  const folder = join(h.dataDir, 'project');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { trigger } = await saveWatching(folder, agent.id, { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50 });

  writeFileSync(join(folder, 'first.txt'), '');
  await waitFor(() => driver.held.length === 1);
  oldEnough(trigger);
  writeFileSync(join(folder, 'self-edit.txt'), '');
  await Bun.sleep(120);
  driver.release();
  await waitFor(() => settled(h, threadId));
  await Bun.sleep(120);
  expect(turnsOf(h, threadId)).toHaveLength(2);
  expect(read(trigger).lastOutcome).toBe('fired');
});

test('file triggers anchor symlinked project roots, reject ancestor symlink escape, and ignore symlinked .gitignore', async () => {
  const realRoot = join(h.dataDir, 'real-root');
  const linkedRoot = join(h.dataDir, 'linked-root');
  mkdirSync(realRoot);
  symlinkSync(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedProject = await owner.call('projects.add', { path: linkedRoot, name: 'Linked' });
  const { agent: linkedAgent, threadId: linkedThread } = await makeAgent(h, owner, { projectIds: [linkedProject.id] });
  const { trigger: linkedTrigger } = await saveWatching(linkedRoot, linkedAgent.id, {
    kind: 'file', projectId: linkedProject.id, patterns: ['*.txt'], debounceMs: 50,
  });
  expect(read(linkedTrigger).watchUnavailable).toBeUndefined();
  writeFileSync(join(realRoot, 'hello.txt'), '');
  await waitFor(() => driver.prompts.get(linkedThread)?.length === 2 && settled(h, linkedThread));
  expect(driver.prompts.get(linkedThread)!.at(-1)).toContain('hello.txt');

  const outside = join(h.dataDir, 'outside-ancestor');
  const outsideIgnore = join(h.dataDir, 'outside-gitignore');
  writeFileSync(outsideIgnore, 'must-watch/\n');
  const ancestor = join(h.dataDir, 'ancestor');
  const folder = join(ancestor, 'sub', 'project');
  mkdirSync(join(folder, 'must-watch'), { recursive: true });
  mkdirSync(join(outside, 'sub', 'project'), { recursive: true });
  symlinkSync(outsideIgnore, join(folder, '.gitignore'), 'file');
  const project = await owner.call('projects.add', { path: folder, name: 'Ancestor' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['**/*.txt'], debounceMs: 50 });
    await waitFor(() => listeners.has(join(folder, 'must-watch')));
    expect(read(trigger).watchUnavailable).toBeUndefined();

    // Redirecting an ancestor directory via symlink escapes the anchored realPath.
    renameSync(ancestor, ancestor + '-original');
    symlinkSync(outside, ancestor, process.platform === 'win32' ? 'junction' : 'dir');
    h.core.workforce.triggers.tick();
    await waitFor(() => read(trigger).watchUnavailable === true);
    h.core.workforce.triggers.tick();
    await Bun.sleep(100);
    expect(read(trigger).watchUnavailable).toBe(true);
    expect(listeners.has(folder)).toBe(false);
    expect(turnsOf(h, threadId)).toHaveLength(1);
  } finally { restore(); }
});

test('file watch allows file renames at the directory cap and reports WatchLimitError when adding a directory', async () => {
  const folder = join(h.dataDir, 'cap-project');
  mkdirSync(folder);
  const { listeners, restore } = controlFileEvents(folder);
  const batches: Array<{ paths: string[]; more: number }> = [];
  let failureError: unknown;
  const roots = new TriggerRootProbes();
  let watch: ReturnType<typeof watchTriggerFiles> | undefined;
  try {
    watch = watchTriggerFiles(
      folder,
      ['**/*.txt'],
      40,
      roots,
      {
        publish: (paths, more) => { batches.push({ paths, more }); },
        ready: () => undefined,
        failed: error => { failureError = error; },
      },
      1,
    );
    await waitFor(() => listeners.has(folder));
    writeFileSync(join(folder, 'at-cap.txt'), '');
    listeners.get(folder)!('rename', 'at-cap.txt');
    await waitFor(() => batches.length === 1);
    expect(batches[0]!.paths).toEqual(['at-cap.txt']);
    expect(failureError).toBeUndefined();

    mkdirSync(join(folder, 'over-cap'));
    listeners.get(folder)!('rename', 'over-cap');
    await waitFor(() => failureError !== undefined);
    expect(failureError).toBeInstanceOf(WatchLimitError);
  } finally {
    watch?.close();
    restore();
  }
});

test('a file rename observed during a file-trigger turn stays suppressed even when its lstat finishes after turn end', async () => {
  driver.restore();
  driver = scripted(ctx => ({ text: '[quiet] tested', hold: ctx.prompt.includes('first.txt') }));
  const folder = join(h.dataDir, 'async-suppress');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder);
  const realLstat = files.lstat;
  const heldLstat = Promise.withResolvers<fs.BigIntStats>();
  let lstatSpy: ReturnType<typeof spyOn> | undefined;
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50 });
    await waitFor(() => listeners.has(folder));
    writeFileSync(join(folder, 'first.txt'), '');
    listeners.get(folder)!('change', 'first.txt');
    await waitFor(() => driver.held.length === 1);
    oldEnough(trigger);

    const selfPath = join(folder, 'self-created.txt');
    writeFileSync(selfPath, '');
    let intercepted = false;
    lstatSpy = spyOn(files, 'lstat').mockImplementation(((path: fs.PathLike, options?: object) => {
      if (path === selfPath) {
        intercepted = true;
        return heldLstat.promise;
      }
      return realLstat(path, options as never);
    }) as typeof files.lstat);

    listeners.get(folder)!('rename', 'self-created.txt');
    await waitFor(() => intercepted);
    driver.release();
    await waitFor(() => settled(h, threadId));
    heldLstat.resolve(fs.lstatSync(selfPath, { bigint: true }));
    await Bun.sleep(120);
    expect(turnsOf(h, threadId)).toHaveLength(2);
    expect(read(trigger).lastOutcome).toBe('fired');
  } finally {
    lstatSpy?.mockRestore();
    restore();
  }
});

test('busy-queued file and PR triggers coalesce without stalling on cooldown and stamp cooldown when fired', async () => {
  const folder = join(h.dataDir, 'busy-coalesce');
  mkdirSync(folder);
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { trigger: fileTrigger } = await saveWatching(folder, agent.id, {
    kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50,
  });
  const { trigger: prTrigger } = await save(agent.id, { kind: 'pr', projectId: project.id, events: ['ci_failed', 'merged'] }, 'Multi PR');
  const prThread = await owner.call('threads.create', {
    projectId: project.id, providerId: 'echo', accountId: h.core.accounts.list()[0]!.id, title: 'PR thread',
  });

  await owner.call('turns.start', { threadId, prompt: 'manual hold' });
  await waitFor(() => driver.held.length === 1);

  writeFileSync(join(folder, 'a.txt'), '');
  await waitFor(() => read(fileTrigger).lastOutcome === 'queued');
  expect(read(fileTrigger).lastFiredAt).toBeNull();
  writeFileSync(join(folder, 'b.txt'), '');
  await Bun.sleep(100);

  h.core.workforce.triggers.pullRequest(prThread.id, 'https://github.com/example/boite/pull/10', [{ kind: 'ci_failed', key: 'k10' }]);
  h.core.workforce.triggers.pullRequest(prThread.id, 'https://github.com/example/boite/pull/11', [{ kind: 'merged', key: 'k11' }]);
  expect(read(prTrigger).lastOutcome).toBe('queued');

  driver.release();
  await waitFor(() => read(fileTrigger).lastOutcome === 'fired' && read(prTrigger).lastOutcome === 'fired' && settled(h, threadId));
  const prompts = driver.prompts.get(threadId)!;
  const filePrompt = prompts.find(p => p.includes('a.txt'))!;
  expect(filePrompt).toContain('b.txt');
  const prPrompt = prompts.find(p => p.includes('pull/10'))!;
  expect(prPrompt).toContain('pull/11');
  expect(prPrompt).toContain('additional');

  // Cooldown is stamped at actual fire time, so a file change right after enters cooldown.
  expect(read(fileTrigger).lastFiredAt).not.toBeNull();
  writeFileSync(join(folder, 'c.txt'), '');
  await waitFor(() => read(fileTrigger).lastOutcome === 'queued');
});

test('a persisted test timestamp does not block a real webhook after core restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-trigger-restart-'));
  let first: TestCore | undefined;
  let second: TestCore | undefined;
  try {
    first = await startTestCore({ dataDir });
    const client = await first.connect();
    const { agent, threadId } = await makeAgent(first, client);
    const { trigger, secret } = await client.call('agents.trigger.save', {
      value: { agentId: agent.id, source: { kind: 'webhook' }, name: 'Restart hook', prompt: 'Check hook.', enabled: true, cooldownSeconds: 60 },
    });
    const tested = await client.call('agents.trigger.test', { triggerId: trigger.id, requestId: 'pre-restart-test' });
    expect(tested.outcome).toBe('fired');
    await waitFor(() => settled(first!, threadId));
    await first.stop();
    first = undefined;

    second = await startTestCore({ dataDir });
    const res = await fetch(new URL(trigger.webhookPath!, second.url.replace(/^ws/, 'http')), {
      method: 'POST', headers: { 'x-boite-secret': secret! }, body: '{"after":"restart"}',
    });
    expect(res.status).toBe(202);
  } finally {
    await first?.stop();
    await second?.stop();
    await removeDir(dataDir);
  }
});

test.skipIf(process.platform === 'win32')('a persisted file-root anchor survives restart to recover a symlinked project and reject redirection', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-trigger-anchor-'));
  const realDir = join(dataDir, 'real-project');
  const outsideDir = join(dataDir, 'outside-project');
  const linkDir = join(dataDir, 'linked-project');
  mkdirSync(realDir);
  mkdirSync(outsideDir);
  symlinkSync(realDir, linkDir);
  let first: TestCore | undefined;
  let second: TestCore | undefined;
  try {
    first = await startTestCore({ dataDir });
    const client = await first.connect();
    const project = await client.call('projects.add', { path: linkDir, name: 'Linked' });
    const { agent } = await makeAgent(first, client, { projectIds: [project.id] });
    const { trigger } = await client.call('agents.trigger.save', {
      value: { agentId: agent.id, source: { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50 }, name: 'Anchored', prompt: 'Watch.', enabled: true, cooldownSeconds: 60 },
    });
    await waitFor(() => !first!.core.workforce.records.get('trigger', trigger.id).watchUnavailable);
    await first.stop();
    first = undefined;

    // Case 1: symlink temporarily absent across restart recovers on retry when the same target returns.
    fs.unlinkSync(linkDir);
    second = await startTestCore({ dataDir });
    await waitFor(() => second!.core.workforce.records.get('trigger', trigger.id).watchUnavailable === true);
    symlinkSync(realDir, linkDir);
    await waitFor(() => {
      second!.core.workforce.triggers.tick();
      return !second!.core.workforce.records.get('trigger', trigger.id).watchUnavailable;
    }, 6000);
    await second.stop();
    second = undefined;

    // Case 2: symlink redirected to outside while core is stopped stays rejected after restart and after disable/re-enable.
    fs.unlinkSync(linkDir);
    symlinkSync(outsideDir, linkDir);
    second = await startTestCore({ dataDir });
    await waitFor(() => second!.core.workforce.records.get('trigger', trigger.id).watchUnavailable === true);
    const client2 = await second.connect();
    const current = second.core.workforce.records.get('trigger', trigger.id);
    const disabled = await client2.call('agents.trigger.save', {
      id: trigger.id, expectedRevision: current.revision, value: { ...current, enabled: false },
    });
    await client2.call('agents.trigger.save', {
      id: trigger.id, expectedRevision: disabled.trigger.revision, value: { ...disabled.trigger, enabled: true },
    });
    await waitFor(() => second!.core.workforce.records.get('trigger', trigger.id).watchUnavailable === true);
  } finally {
    await first?.stop();
    await second?.stop();
    await removeDir(dataDir);
  }
});

test('repeated scheduler ticks while queued do not bump trigger revision, and webhooks enforce 429 on paused and 503 on busy past cooldown', async () => {
  const { agent, threadId } = await makeAgent(h, owner);
  const { trigger, secret } = await owner.call('agents.trigger.save', {
    value: { agentId: agent.id, source: { kind: 'webhook' }, name: 'Throttled', prompt: 'Handle hook.', enabled: true, cooldownSeconds: 1 },
  });
  const url = new URL(trigger.webhookPath!, h.url.replace(/^ws/, 'http'));
  const post = (body: string) => fetch(url, { method: 'POST', headers: { 'x-boite-secret': secret! }, body });

  // Paused mochi skips the wake, records lastOutcomeAt without lastFiredAt, and enforces 429 cooldown.
  await owner.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...agent, status: 'paused' } });
  expect((await post('{"step":1}')).status).toBe(202);
  const afterPause = read(trigger);
  expect(afterPause.lastOutcome).toBe('skipped');
  expect(afterPause.lastFiredAt).toBeNull();
  expect(afterPause.lastOutcomeAt).toEqual(expect.any(Number));
  const limitedPaused = await post('{"step":2}');
  expect(limitedPaused.status).toBe(429);
  expect(Number(limitedPaused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

  // Resume, wait past 1s cooldown, hold the mochi busy, and verify queued tick stability + 503 past cooldown.
  const latestProfile = h.core.workforce.records.get('profile', agent.id);
  await owner.call('agents.profile.save', { id: agent.id, expectedRevision: latestProfile.revision, value: { ...latestProfile, status: 'active' } });
  await Bun.sleep(1050);
  await owner.call('turns.start', { threadId, prompt: 'manual hold' });
  await waitFor(() => driver.held.length === 1);

  expect((await post('{"step":3}')).status).toBe(202);
  const queued = read(trigger);
  expect(queued.lastOutcome).toBe('queued');
  expect(queued.lastFiredAt).toBeNull();
  expect(queued.lastOutcomeAt).toEqual(expect.any(Number));
  const revBeforeTicks = queued.revision;
  for (let i = 0; i < 5; i++) h.core.workforce.triggers.tick();
  expect(read(trigger).revision).toBe(revBeforeTicks);

  // During cooldown while busy -> 429; after 1s cooldown while still busy -> 503 with Retry-After: 10.
  expect((await post('{"step":4}')).status).toBe(429);
  await Bun.sleep(1050);
  const busyPastCooldown = await post('{"step":5}');
  expect(busyPastCooldown.status).toBe(503);
  expect(busyPastCooldown.headers.get('retry-after')).toBe('10');

  driver.release();
  await waitFor(() => read(trigger).lastOutcome === 'fired' && settled(h, threadId));
});

test('a queued test across restart never locks out real webhooks, and a test never shortens a real webhook cooldown', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-trigger-wh-cooldown-'));
  let first: TestCore | undefined;
  let second: TestCore | undefined;
  let testDriver: ReturnType<typeof scripted> | undefined;
  try {
    first = await startTestCore({ dataDir });
    const client = await first.connect();
    testDriver = scripted(ctx => ({ text: '[quiet] done', hold: ctx.prompt.endsWith('manual hold') }));
    const { agent, threadId } = await makeAgent(first, client);
    const { trigger, secret } = await client.call('agents.trigger.save', {
      value: { agentId: agent.id, source: { kind: 'webhook' }, name: 'Hook', prompt: 'Handle.', enabled: true, cooldownSeconds: 60 },
    });
    // Hold the mochi busy, queue a Test event, then restart the core so start() marks it skipped.
    await client.call('turns.start', { threadId, prompt: 'manual hold' });
    await waitFor(() => testDriver!.held.length === 1);
    expect(await client.call('agents.trigger.test', { triggerId: trigger.id, requestId: 'queued-before-restart' })).toEqual({ outcome: 'queued', turnId: null });
    testDriver.release();
    testDriver.restore();
    testDriver = undefined;
    await first.stop();
    first = undefined;

    second = await startTestCore({ dataDir });
    const client2 = await second.connect();
    const afterRestart = second.core.workforce.records.get('trigger', trigger.id);
    expect(afterRestart.lastOutcome).toBe('skipped');
    const url = new URL(trigger.webhookPath!, second.url.replace(/^ws/, 'http'));
    const post = (body: string) => fetch(url, { method: 'POST', headers: { 'x-boite-secret': secret! }, body });
    // Real webhook must NOT be rate-limited by the skipped queued test.
    expect((await post('{"step":"after-restart-test"}')).status).toBe(202);
    await waitFor(() => second!.core.workforce.records.get('trigger', trigger.id).lastOutcome === 'fired');

    // Clear cooldown, pause the mochi, send a real webhook (skipped), then run a standalone Test:
    // the real webhook cooldown must still return 429 afterwards.
    const current = second.core.workforce.records.get('trigger', trigger.id);
    second.core.workforce.records.update('trigger', trigger.id, current.revision, { ...current, lastFiredAt: Date.now() - 120_000 });
    const prof = second.core.workforce.records.get('profile', agent.id);
    await client2.call('agents.profile.save', { id: agent.id, expectedRevision: prof.revision, value: { ...prof, status: 'paused' } });
    expect((await post('{"step":"paused-real"}')).status).toBe(202);
    expect(await client2.call('agents.trigger.test', { triggerId: trigger.id, requestId: 'test-while-paused' })).toEqual({ outcome: 'skipped', turnId: null });
    expect((await post('{"step":"after-test-still-429"}')).status).toBe(429);
  } finally {
    testDriver?.release();
    testDriver?.restore();
    await first?.stop();
    await second?.stop();
    await removeDir(dataDir);
  }
});

test.skipIf(process.platform === 'win32')('a file trigger saved while its folder is missing rejects symlinks across restarts and opens once a real directory appears', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-trigger-missing-anchor-'));
  const holder = join(dataDir, 'holder');
  const folder = join(holder, 'missing-project');
  const outside = join(dataDir, 'outside');
  mkdirSync(holder);
  mkdirSync(folder);
  mkdirSync(outside);
  let first: TestCore | undefined;
  let second: TestCore | undefined;
  try {
    first = await startTestCore({ dataDir });
    const client = await first.connect();
    const project = await client.call('projects.add', { path: folder, name: 'Missing' });
    const { agent } = await makeAgent(first, client, { projectIds: [project.id] });
    // Remove the project folder before saving the file trigger.
    fs.rmSync(folder, { recursive: true });
    const { trigger } = await client.call('agents.trigger.save', {
      value: { agentId: agent.id, source: { kind: 'file', projectId: project.id, patterns: ['*.txt'], debounceMs: 50 }, name: 'MissingRoot', prompt: 'Watch.', enabled: true, cooldownSeconds: 60 },
    });
    await waitFor(() => first!.core.workforce.records.get('trigger', trigger.id).watchUnavailable === true);
    await first.stop();
    first = undefined;

    // Replace the missing folder with a symlink to outside while stopped, then restart: must stay rejected.
    symlinkSync(outside, folder);
    second = await startTestCore({ dataDir });
    await waitFor(() => second!.core.workforce.records.get('trigger', trigger.id).watchUnavailable === true);
    await Bun.sleep(100);
    expect(second.core.workforce.records.get('trigger', trigger.id).watchUnavailable).toBe(true);

    // Replace the symlink with a real directory at the granted path: retry recovers.
    fs.unlinkSync(folder);
    mkdirSync(folder);
    await waitFor(() => {
      second!.core.workforce.triggers.tick();
      return !second!.core.workforce.records.get('trigger', trigger.id).watchUnavailable;
    }, 6000);

    // A broken symlink whose target is offline at save anchors to its target and opens when the target appears.
    const offlineTarget = join(dataDir, 'offline-target');
    const brokenLink = join(holder, 'offline-link');
    mkdirSync(offlineTarget);
    symlinkSync(offlineTarget, brokenLink);
    const client2 = await second.connect();
    const offlineProject = await client2.call('projects.add', { path: brokenLink, name: 'OfflineLink' });
    const prof = second.core.workforce.records.get('profile', agent.id);
    await client2.call('agents.profile.save', {
      id: agent.id, expectedRevision: prof.revision, value: { ...prof, projectIds: [...(prof.projectIds ?? []), offlineProject.id] },
    });
    fs.rmSync(offlineTarget, { recursive: true });
    const { trigger: offlineTrigger } = await client2.call('agents.trigger.save', {
      value: { agentId: agent.id, source: { kind: 'file', projectId: offlineProject.id, patterns: ['*.txt'], debounceMs: 50 }, name: 'OfflineTarget', prompt: 'Watch.', enabled: true, cooldownSeconds: 60 },
    });
    await waitFor(() => second!.core.workforce.records.get('trigger', offlineTrigger.id).watchUnavailable === true);
    mkdirSync(offlineTarget);
    await waitFor(() => {
      second!.core.workforce.triggers.tick();
      return !second!.core.workforce.records.get('trigger', offlineTrigger.id).watchUnavailable;
    }, 6000);
  } finally {
    await first?.stop();
    await second?.stop();
    await removeDir(dataDir);
  }
});

test('a nameless rename reopens a replaced subdirectory with a new inode and prunes deleted children', async () => {
  const folder = join(h.dataDir, 'project');
  const child = join(folder, 'src');
  mkdirSync(child, { recursive: true });
  const project = await owner.call('projects.add', { path: folder, name: 'Project' });
  const { agent, threadId } = await makeAgent(h, owner, { projectIds: [project.id] });
  const { listeners, restore } = controlFileEvents(folder);
  try {
    const { trigger } = await save(agent.id, { kind: 'file', projectId: project.id, patterns: ['{src,lib}/*.txt'], debounceMs: 50 });
    await waitFor(() => listeners.has(folder) && listeners.has(child));
    const rootEvent = listeners.get(folder)!;
    const oldChildListener = listeners.get(child)!;

    // Swap src for a brand-new directory inode and emit a nameless rename on the parent.
    renameSync(child, join(h.dataDir, 'old-src'));
    mkdirSync(child);
    rootEvent('rename', null);
    await waitFor(() => listeners.has(child) && listeners.get(child) !== oldChildListener);

    const newChildListener = listeners.get(child)!;
    newChildListener('change', 'reopened.txt');
    await waitFor(() => driver.prompts.get(threadId)?.at(-1)?.includes('src/reopened.txt') === true && settled(h, threadId));
    expect(read(trigger).lastOutcome).toBe('fired');

    // Deleting src before a nameless rename prunes its watcher entry instead of leaking it,
    // while a sibling directory created during the rescan stays watched.
    const sibling = join(folder, 'lib');
    const realReaddir = files.readdir;
    const holdScan = Promise.withResolvers<void>();
    let pausedScan = false;
    const readdirSpy = spyOn(files, 'readdir').mockImplementation((async (path: fs.PathLike, options?: object) => {
      const result = await realReaddir(path, options as never);
      if (path === folder && !pausedScan) {
        pausedScan = true;
        await holdScan.promise;
      }
      return result;
    }) as typeof files.readdir);
    try {
      fs.rmSync(child, { recursive: true });
      rootEvent('rename', null);
      await waitFor(() => pausedScan);
      mkdirSync(sibling);
      rootEvent('rename', 'lib');
      await waitFor(() => listeners.has(sibling));
      holdScan.resolve();
      await waitFor(() => !listeners.has(child));
      expect(listeners.has(sibling)).toBe(true);
    } finally {
      holdScan.resolve();
      readdirSpy.mockRestore();
    }
  } finally {
    restore();
  }
});
