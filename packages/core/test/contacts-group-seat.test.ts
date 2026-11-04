import { afterEach, expect, test } from 'bun:test';
import { botView } from '../src/contacts/bot.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { waitFor, type TestCore } from './harness.ts';
import { botsHome, letters, project, remoteOn, requestOn, setup, thread } from './contacts-group-fixture.ts';

/* A contact that cannot reach the group's Bots host still moves there: the Bots host dials it, or it dials the Bots host's Funnel. */

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
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
