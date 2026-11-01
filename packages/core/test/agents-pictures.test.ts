import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_PICTURE_MAX_BYTES } from '@boite/contracts';
import { UNWORN_PICTURE_MS, UNWORN_PICTURES_MAX } from '../src/agents/pictures.ts';
import { makeAgent, scripted } from './agent-fixture.ts';
import { startTestCore, type TestCore } from './harness.ts';
import { rejection } from './settle.ts';

/* A picture the owner imports for a bot in place of its robot: stored by hash, worn as `img:<hash>`, drawn from `agents.picture.get`. */

const cores: TestCore[] = [];
let driver: ReturnType<typeof scripted> | null = null;
beforeEach(() => { driver = scripted(() => ({ text: 'Noted.' })); });
afterEach(async () => {
  for (const h of cores.splice(0)) await h.stop();
  driver?.restore(); driver = null;
});

/** The RPC error a refused call answered with. */
const refusal = async (call: Promise<unknown>) => ((await rejection(call)).reason as { rpc: unknown }).rpc;

/** A 1x1 PNG, and a second image with other bytes. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

test('an imported picture is stored once by its bytes, worn by a saved bot and served back; anything else is refused with its field', async () => {
  const h = await startTestCore();
  cores.push(h);
  const owner = await h.connect();
  const { agent } = await makeAgent(h, owner);

  const { avatar } = await owner.call('agents.picture.put', { dataUrl: PNG });
  expect(avatar).toMatch(/^img:[0-9a-f]{16}$/);
  expect(await owner.call('agents.picture.put', { dataUrl: PNG })).toEqual({ avatar });
  expect(await owner.call('agents.picture.get', { avatar })).toEqual({ dataUrl: PNG });

  const saved = await owner.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...agent, avatar } });
  expect(saved.avatar).toBe(avatar);
  // An edit that leaves the picture alone saves, and one naming a picture this machine never stored is refused.
  const renamed = await owner.call('agents.profile.save', { id: agent.id, expectedRevision: saved.revision, value: { ...saved, name: 'Grace' } });
  expect(renamed).toMatchObject({ name: 'Grace', avatar });
  expect(await refusal(owner.call('agents.profile.save', { id: agent.id, expectedRevision: renamed.revision, value: { ...renamed, avatar: 'img:0123456789abcdef' } })))
    .toMatchObject({ data: { field: 'avatar' } });

  // Markup, bytes that are not the type they claim, and more than the bound never land.
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
  expect(await refusal(owner.call('agents.picture.put', { dataUrl: svg }))).toMatchObject({ data: { field: 'dataUrl' } });
  expect(await refusal(owner.call('agents.picture.put', { dataUrl: PNG.replace('image/png', 'image/jpeg') }))).toMatchObject({ data: { field: 'dataUrl', expected: 'image/jpeg' } });
  const huge = `data:image/png;base64,${Buffer.alloc(AGENT_PICTURE_MAX_BYTES + 1, 0x89).toString('base64')}`;
  expect(await refusal(owner.call('agents.picture.put', { dataUrl: huge }))).toMatchObject({ data: { field: 'dataUrl', max: AGENT_PICTURE_MAX_BYTES } });
  expect(await refusal(owner.call('agents.picture.get', { avatar: 'img:0123456789abcdef' }))).toMatchObject({ data: { field: 'avatar' } });
  expect(await refusal(owner.call('agents.picture.get', { avatar: '../journal.db' }))).toMatchObject({ data: { field: 'avatar' } });
}, 30_000);

test('a picture no bot wears is removed a day after it was stored; a worn one stays', async () => {
  const h = await startTestCore();
  cores.push(h);
  const owner = await h.connect();
  const { agent } = await makeAgent(h, owner);
  const worn = (await owner.call('agents.picture.put', { dataUrl: PNG })).avatar;
  await owner.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...agent, avatar: worn } });
  const dropped = (await owner.call('agents.picture.put', { dataUrl: GIF })).avatar;
  const folder = join(h.dataDir, 'agent-pictures');
  const old = new Date(Date.now() - UNWORN_PICTURE_MS - 60_000);
  for (const name of readdirSync(folder)) utimesSync(join(folder, name), old, old);

  // The next import sweeps: the GIF went unworn for a day, the PNG is on a bot.
  const fresh = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG.split(',')[1]!, 'base64'), Buffer.from([0])]).toString('base64')}`;
  await owner.call('agents.picture.put', { dataUrl: fresh });
  expect(existsSync(join(folder, `${worn.slice(4)}.png`))).toBe(true);
  expect(existsSync(join(folder, `${dropped.slice(4)}.gif`))).toBe(false);
  expect(await refusal(owner.call('agents.picture.get', { avatar: dropped }))).toMatchObject({ data: { field: 'avatar' } });

  // Agents import too: however many land within the day, the unworn ones stay a bounded few, the oldest going first.
  const variant = (n: number) => `data:image/png;base64,${Buffer.concat([Buffer.from(PNG.split(',')[1]!, 'base64'), Buffer.from([1, n])]).toString('base64')}`;
  const burst: string[] = [];
  for (let n = 0; n < UNWORN_PICTURES_MAX + 3; n++) {
    burst.push((await owner.call('agents.picture.put', { dataUrl: variant(n) })).avatar);
    // Distinct times, so "oldest" is well defined on a coarse clock.
    const at = new Date(Date.now() - (UNWORN_PICTURES_MAX + 3 - n) * 1000);
    utimesSync(join(folder, `${burst.at(-1)!.slice(4)}.png`), at, at);
  }
  const unworn = readdirSync(folder).filter(name => name !== `${worn.slice(4)}.png`);
  expect(unworn.length).toBe(UNWORN_PICTURES_MAX);
  expect(existsSync(join(folder, `${worn.slice(4)}.png`))).toBe(true);
  expect(existsSync(join(folder, `${burst[0]!.slice(4)}.png`))).toBe(false);
  expect(existsSync(join(folder, `${burst.at(-1)!.slice(4)}.png`))).toBe(true);
  // Importing a picture a bot already wears takes no slot: the 32 unworn ones all stay.
  await owner.call('agents.picture.put', { dataUrl: PNG });
  expect(readdirSync(folder).filter(name => name !== `${worn.slice(4)}.png`)).toHaveLength(UNWORN_PICTURES_MAX);
}, 30_000);
