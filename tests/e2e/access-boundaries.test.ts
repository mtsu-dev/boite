import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { connect, type CoreClient } from '../../packages/core/src/client.ts';
import { startCore, type RunningCore } from './lib/core.ts';
import { thrown } from '../../packages/core/test/settle.ts';

let core: RunningCore;
let owner: CoreClient;
let phone: CoreClient;
let threadId: string;
let cwd: string;

beforeAll(async () => {
  core = await startCore();
  owner = await connect(core.url, core.token);
  cwd = join(core.dataDir, 'project');
  mkdirSync(cwd);
  const project = await owner.call('projects.add', { path: cwd, name: 'Access boundaries' });
  const account = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
  threadId = (await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id })).id;
  const { grant } = await owner.call('pairing.grant', {});
  phone = await connect(core.url, '', { grant });
}, 30_000);

afterAll(async () => { phone?.close(); owner?.close(); await core?.stop(); }, 30_000);

test('a phone sees a completed turn but receives none of its process trace', async () => {
  const ownerTrace: number[] = [];
  const phoneTrace: number[] = [];
  const offOwner = owner.on('process.started', event => ownerTrace.push(event.pid));
  const offPhone = phone.on('process.started', event => phoneTrace.push(event.pid));
  try {
    // Process events go only to the thread's subscribers: the owner subscribes
    // so it proves the trace exists, the phone so it proves it is withheld.
    await owner.call('threads.subscribe', { threadId });
    await phone.call('threads.subscribe', { threadId });
    const finished = phone.next('turn.finished', turn => turn.threadId === threadId, 15_000);
    await phone.call('turns.start', { threadId, prompt: '[spawn:echo traced-child] trace boundary' });
    expect((await finished).status).toBe('done');
    await phone.call('threads.get', { threadId });
    await owner.call('threads.get', { threadId });
    expect(ownerTrace.length).toBeGreaterThan(0);
    expect(phoneTrace).toEqual([]);
    expect(await thrown(phone.call('trace.get', { threadId }))).toThrow('owner only');
  } finally { offOwner(); offPhone(); }
}, 20_000);

test('a ticket cannot read a replacement directory outside its project', async () => {
  const folder = join(cwd, 'media');
  const outside = join(core.dataDir, 'outside');
  mkdirSync(folder);
  mkdirSync(outside);
  writeFileSync(join(folder, 'image.bin'), new Uint8Array([0, 1]));
  writeFileSync(join(outside, 'image.bin'), 'outside file');
  const content = await owner.call('files.read', { threadId, path: 'media/image.bin' });
  if (content.kind === 'text') throw new Error('expected a ticket');
  const response = await fetch(`${core.url}${content.url}`);
  expect(response.status).toBe(200);
  // Finish the transfer before replacing its directory: Windows can keep the
  // served file open while the response body is still being streamed.
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1]));
  renameSync(folder, join(cwd, 'original-media'));
  symlinkSync(outside, folder, 'junction');
  expect((await fetch(`${core.url}${content.url}`)).status).toBe(404);
}, 10_000);

test('a phone adds a folder of the core machine as a project, never one inside boite\'s data folder', async () => {
  const home = mkdtempSync(join(tmpdir(), 'boite-e2e-phone-project-'));
  try {
    mkdirSync(join(home, 'From the phone'));
    // The Add a project form: browse this machine's folders, then add one.
    expect((await phone.call('projects.browse', { path: home })).directories.map(entry => entry.name)).toEqual(['From the phone']);
    const project = await phone.call('projects.add', { path: join(home, 'From the phone') });
    expect(project.name).toBe('From the phone');
    expect((await owner.call('projects.list', {})).some(entry => entry.id === project.id)).toBe(true);
    // The owner may keep a project inside the data folder, as this file's first test does; a device may not.
    const inside = join(core.dataDir, 'phone-inside');
    mkdirSync(inside, { recursive: true });
    expect(await thrown(phone.call('projects.add', { path: inside }))).toThrow('a paired device does not add boite\'s data folder');
    expect(await thrown(phone.call('projects.add', { path: 'From the phone' }))).toThrow('projects.add.path must be an absolute path');
    expect(await thrown(phone.call('settings.set', { listenOnLan: true }))).toThrow('settings.set is for the owner only');
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 15_000);
