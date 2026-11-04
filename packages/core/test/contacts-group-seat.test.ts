import { afterEach, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { botView } from '../src/contacts/bot.ts';
import { moveInput } from '../src/contacts/group-link.ts';
import { dialContact } from '../src/contacts/link-hello.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import { botsHome, letters, project, remoteOn, requestOn, setup, thread } from './contacts-group-fixture.ts';

/* A contact that cannot reach the group's Bots host still moves there: the Bots host dials it, or it dials the Bots host's Funnel. */

const cores: TestCore[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** C cannot reach X's tailnet address: on another network, it cannot resolve the Bots host's name. */
const unreachable = (x: TestCore): void => { x.core.contacts.selfUrl = async () => 'http://127.0.0.1:9'; };

/** After the move the member that held C is off: an ask from the Bots host, its answer and letters both ways still flow. */
async function flowsWithoutHolder(sides: Awaited<ReturnType<typeof setup>>): Promise<void> {
  const { a, x, c, xClient, cClient, xId, cId } = sides;
  await a.stop();
  await cClient.call('contacts.update', { coreId: xId, trusted: true });
  const xThread = await thread(xClient, (await project(x, xClient, 'xray')).id, 'Xray work');
  const cThread = await thread(cClient, (await project(c, cClient, 'mine')).id, 'Guest work');
  remoteOn(x, xThread);
  remoteOn(c, cThread);
  const cBot = await contactsBotOf(c, cClient);
  const xBot = await contactsBotOf(x, xClient);
  const name = x.core.contacts.find(cId)!.name;
  const asked = await xClient.call('collaboration.ask', { threadId: xThread, contact: name, text: 'Still there without alpha?' });
  await xClient.call('contacts.bot.forward', { threadId: xBot.threadId, id: asked.id, contact: name });
  const incoming = () => c.core.contacts.requests.list().find(request => request.direction === 'in' && request.text === 'Still there without alpha?');
  await waitFor(() => incoming() !== undefined, 10000);
  expect(incoming()!.from).toMatchObject({ coreId: xId, threadId: xThread });
  await cClient.call('contacts.bot.connect', { threadId: cBot.threadId, id: incoming()!.id, target: cThread });
  await waitFor(() => requestOn(x, asked.id)?.status === 'accepted', 10000);
  await waitFor(() => letters(x, xThread).some(letter => letter.text.includes('put you in touch')), 10000);
  await x.core.coordination.send({ threadId: xThread, to: { coreId: cId, threadId: cThread }, text: 'Hello from xray', requestId: crypto.randomUUID() });
  await waitFor(() => letters(c, cThread).some(letter => letter.text === 'Hello from xray'), 10000);
  await c.core.coordination.send({ threadId: cThread, to: { coreId: xId, threadId: xThread }, text: 'Back to xray', requestId: crypto.randomUUID() });
  await waitFor(() => letters(x, xThread).some(letter => letter.text === 'Back to xray'), 10000);
}

test('a contact its member dials, which cannot reach the Bots host, moves there with the Bots host dialing it, and works with the member off', async () => {
  const sides = await setup(cores, true);
  const { a, x, aClient, c, xId, cId } = sides;
  unreachable(x);
  expect(a.core.contacts.find(cId)).toMatchObject({ role: 'guest', url: c.url, capabilities: { guestSeat: 1 } });
  await botsHome(a, aClient, x, xId);
  await waitFor(() => x.core.contacts.has(cId) && !a.core.contacts.has(cId), 20000);
  // The Bots host took A's seat: it dials C at the address A dialed, and C hosts it.
  expect(x.core.contacts.find(cId)).toMatchObject({ role: 'guest', url: c.url });
  expect(c.core.contacts.find(xId)).toMatchObject({ role: 'host' });
  expect(c.core.contacts.find(xId)!.url).toBeUndefined();
  await waitFor(() => x.core.contacts.linked(cId), 10000);
  await flowsWithoutHolder(sides);
}, 90000);

test('a contact on an older Boite stays with the member that dials it, which says it must update', async () => {
  const { a, x, aClient, xId, cId } = await setup(cores, true);
  unreachable(x);
  // C announces no guestSeat: it can only dial the Bots host itself.
  a.core.journal.setSetting('contacts', a.core.contacts.list().map(contact => ({ ...contact, capabilities: { sharedProjects: 1, humanLetters: 1, contactsBot: 1, groupLink: 1 } })));
  a.core.contacts.reset();
  await botsHome(a, aClient, x, xId);
  await waitFor(() => botView(x.core).contacts.some(contact => contact.coreId === cId && contact.heldReason?.includes('older Boite') === true), 20000);
  expect(botView(x.core).contacts.find(contact => contact.coreId === cId)!.heldReason).toStartWith('unreachable');
  expect(a.core.contacts.has(cId)).toBe(true);
  expect(x.core.contacts.has(cId)).toBe(false);
}, 60000);

test('a contact that dials its member and cannot reach the Bots host\'s tailnet name moves through the Bots host\'s Funnel', async () => {
  const sides = await setup(cores);
  const { a, x, aClient, c, xId, cId } = sides;
  unreachable(x);
  // The Bots host's Funnel mounts are up: its public origin is where C dials it.
  x.core.contacts.publicUrl = () => x.url;
  await botsHome(a, aClient, x, xId);
  await waitFor(() => x.core.contacts.has(cId) && !a.core.contacts.has(cId), 20000);
  expect(c.core.contacts.find(xId)).toMatchObject({ role: 'guest', url: x.url });
  expect(x.core.contacts.find(cId)).toMatchObject({ role: 'host' });
  await waitFor(() => c.core.contacts.linked(xId), 10000);
  await flowsWithoutHolder(sides);
}, 90000);

test('a guest seat given before the contact was removed and linked again does not take the new link', async () => {
  const { a, x, c, aClient, cClient, aId, xId, cId } = await setup(cores, true);
  const card = { ...x.core.coordination.card(), box: x.core.group.boxPublic(), url: x.url, machine: 'Team' };
  const signature = x.core.coordination.signature(moveInput(aId, xId, cId)).toString('base64');
  const peer = a.core.contacts.peers().find(entry => entry.coreId === cId)!;
  expect(await a.core.coordination.request(peer, 'contact.move', { card, signature, seat: 'guest' })).toMatchObject({ seat: 'guest' });
  await aClient.call('contacts.remove', { coreId: cId });
  await cClient.call('contacts.remove', { coreId: aId });
  await aClient.call('contacts.join', { link: (await cClient.call('contacts.invite', {})).link });
  await waitFor(() => a.core.contacts.linked(cId), 10000);
  // X's hello is fresh, but the seat came from the removed link: C refuses it and keeps the new one.
  expect(await thrown(dialContact(x.core, c.url, x.core.contacts.helloHeaders(cId)))).toThrow('403');
  expect(c.core.contacts.has(xId)).toBe(false);
  expect(c.core.contacts.has(aId)).toBe(true);
}, 60000);

test('a Bots host that stopped after the contact took its hello, before keeping the contact, dials it again once it is back', async () => {
  const sides = await setup(cores, true);
  const { a, x, c, aClient, xId, cId } = sides;
  unreachable(x);
  // X stops right after C followed it, before it stored C.
  x.core.contacts.groupLink.commit = () => { throw new Error('stopped before commit'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.has(xId) && !x.core.contacts.has(cId), 20000);
  const saved = mkdtempSync(join(tmpdir(), 'boite-seat-restart-'));
  scratch.push(saved);
  const dataDir = join(saved, 'data');
  cpSync(x.dataDir, dataDir, { recursive: true });
  const port = Number(new URL(x.url).port);
  await x.stop();
  const back = await startTestCore({ dataDir, port });
  cores.push(back);
  unreachable(back);
  // Back on its data, X dials C at the seat it was handed: nothing waits for A.
  await waitFor(() => back.core.contacts.has(cId) && back.core.contacts.linked(cId), 20000);
  expect(back.core.contacts.find(cId)).toMatchObject({ role: 'guest', url: c.url });
  await flowsWithoutHolder({ ...sides, x: back, xClient: await back.connect() });
}, 90000);
