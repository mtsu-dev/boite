import { afterEach, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentLetter, CoordinationPeer } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { memberThreadId } from '../src/contacts/members.ts';
import { moveInput } from '../src/contacts/group-link.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
});

async function project(harness: TestCore, client: CoreClient, name: string): Promise<{ id: string }> {
  const path = join(harness.dataDir, 'projects', name);
  mkdirSync(path, { recursive: true });
  return client.call('projects.add', { path, name });
}

async function thread(client: CoreClient, projectId: string, title: string): Promise<string> {
  const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo');
  if (!account) throw new Error('no echo account');
  return (await client.call('threads.create', { projectId, providerId: 'echo', accountId: account.id, title })).id;
}

const letters = (harness: TestCore, threadId: string): AgentLetter[] => harness.core.coordination.get(threadId).messages;

/** Every core of a test runs on one machine: each gets its own host name, so a leak can be told apart. */
function named(harness: TestCore, hostname: string): void {
  const real = harness.core.info.bind(harness.core);
  harness.core.info = () => ({ ...real(), hostname });
}

/** What the contact keeps of this owner, as one text: its records, requests, relations and letters. */
function storedBy(harness: TestCore): string {
  const settings = ['contacts', 'contacts:requests', 'contacts:relations', 'contacts:recent'].map(key => harness.core.journal.getSetting(key) ?? null);
  const rows = harness.core.journal.db.query('SELECT data FROM coordination_letters').all() as { data: string }[];
  return JSON.stringify([settings, rows.map(row => row.data)]);
}

/** A group "Team" of A and X, and a contact C that joined A. No Bots host yet. */
async function setup() {
  const a = await startTestCore(), x = await startTestCore(), c = await startTestCore();
  cores.push(a, x, c);
  named(a, 'pc-alpha');
  named(x, 'pc-xray');
  named(c, 'pc-guest');
  a.core.contacts.selfUrl = async () => a.url;
  x.core.contacts.selfUrl = async () => x.url;
  for (const side of [a, x, c]) side.core.contacts.setSettings({ minTier: 2 });
  const aClient = await a.connect(), xClient = await x.connect(), cClient = await c.connect();
  const aId = a.core.coordination.card().coreId, xId = x.core.coordination.card().coreId, cId = c.core.coordination.card().coreId;
  await a.core.group.create('Team');
  await x.core.group.join((await a.core.group.invite()).invite);
  await waitFor(() => a.core.group.peers().some(peer => peer.coreId === xId) && x.core.group.peers().some(peer => peer.coreId === aId), 10000);
  await cClient.call('contacts.join', { link: (await aClient.call('contacts.invite', {})).link });
  await waitFor(() => a.core.contacts.linked(cId) && a.core.contacts.find(cId)?.capabilities?.groupLink === 1, 10000);
  return { a, x, c, aClient, xClient, cClient, aId, xId, cId };
}

async function botsHome(a: TestCore, client: CoreClient, x: TestCore, xId: string): Promise<void> {
  await client.call('group.botsHome', { coreId: xId });
  await waitFor(() => a.core.group.roleOf('botsHome') === xId && x.core.group.roleOf('botsHome') === xId, 10000);
  // The first hand may have reached X before X read the new roster: offered again now.
  a.core.contacts.groupLink.sweep(true);
}

const peerOf = (harness: TestCore, coreId: string): CoordinationPeer => harness.core.contacts.peers().find(peer => peer.coreId === coreId)!;

test('a Bots host takes a member\'s contact: the contact follows it with its grants and pending request, reaches the member\'s projects through it, and sees only the group\'s name', async () => {
  const { a, x, c, aClient, cClient, aId, xId, cId } = await setup();
  const alpha = await project(a, aClient, 'alpha');
  const aThread = await thread(aClient, alpha.id, 'Alpha work');
  const mine = await project(c, cClient, 'mine');
  const cThread = await thread(cClient, mine.id, 'Guest work');
  await aClient.call('contacts.grant', { coreId: cId, projectId: alpha.id });
  await cClient.call('contacts.grant', { coreId: aId, projectId: mine.id });
  // C's Contacts bot sends A a request that is still pending when the link moves.
  const cBot = await contactsBotOf(c, cClient);
  const asked = await cClient.call('collaboration.ask', { threadId: cThread, text: 'Who runs alpha?' });
  await cClient.call('contacts.bot.forward', { threadId: cBot.threadId, id: asked.id, contact: c.core.contacts.find(aId)!.name });
  await waitFor(() => a.core.contacts.requests.list().some(request => request.direction === 'in' && request.remoteId === asked.id), 10000);
  await waitFor(() => a.core.contacts.find(cId)?.offers.length === 1, 10000);

  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.find(xId) !== undefined && !a.core.contacts.has(cId), 20000);

  // (a) C names X now, A holds nothing, and X has C's link, grants and request.
  expect(c.core.contacts.find(aId)).toBeUndefined();
  expect(c.core.contacts.find(xId)).toMatchObject({ name: 'Team', machine: 'Team', role: 'guest', url: x.url, grants: [expect.objectContaining({ projectId: mine.id })] });
  await waitFor(() => x.core.contacts.linked(cId) && x.core.contacts.linkOf(cId) === 'connected', 10000);
  expect(x.core.contacts.find(cId)?.grants).toEqual([expect.objectContaining({ projectId: alpha.id, machine: aId, name: 'alpha' })]);
  const moved = x.core.contacts.requests.list().find(request => request.direction === 'in' && request.remoteId === asked.id)!;
  expect(moved).toMatchObject({ coreId: cId, status: 'pending' });
  expect(a.core.contacts.requests.list().some(request => request.coreId === cId)).toBe(false);
  expect(c.core.contacts.requests.list().find(request => request.id === asked.id)).toMatchObject({ coreId: xId, status: 'pending' });

  // A letter from C's bot thread (C's other threads write only once the bots put them in touch) reaches A's thread through X, at the alias X gives it.
  await waitFor(() => a.core.contacts.members.relayedOf(cId).length === 1, 10000);
  const out = await c.core.coordination.send({ threadId: cBot.threadId, to: { coreId: xId, threadId: memberThreadId(aId, aThread) }, text: 'Is alpha on 8080?', requestId: crypto.randomUUID() });
  await waitFor(() => letters(a, aThread).some(letter => letter.id === out.id), 10000);
  expect(letters(a, aThread).find(letter => letter.id === out.id)!.from.coreId).toBe(cId);
  // A letter to a group that may be off waits 7 days, not 15 minutes.
  expect(out.expiresAt - out.createdAt).toBe(7 * 24 * 3_600_000);

  // The request settled on X reaches C under X's id.
  x.core.contacts.requests.settle(moved.id, false, undefined, 'Not now', 'owner');
  await waitFor(() => c.core.contacts.requests.list().find(request => request.id === asked.id)?.status === 'refused', 10000);

  // (e) C lists the group's name, and neither machine's host name is anywhere in what C stored.
  expect((await cClient.call('contacts.get', {})).contacts.map(contact => contact.name)).toEqual(['Team']);
  expect(storedBy(c)).not.toContain('pc-alpha');
  expect(storedBy(c)).not.toContain('pc-xray');
  // On X, the owner sees which member a relayed contact is held by; C is X's own now.
  expect((await x.core.contacts.state()).contacts.filter(contact => contact.coreId === cId).map(contact => contact.heldBy)).toEqual([undefined]);
}, 90000);

test('a contact without groupLink stays on its member, which still opens its projects to it', async () => {
  const { a, x, c, aClient, xClient, cClient, aId, xId, cId } = await setup();
  const alpha = await project(a, aClient, 'alpha');
  const aThread = await thread(aClient, alpha.id, 'Alpha work');
  const cThread = await thread(cClient, (await project(c, cClient, 'mine')).id, 'Guest work');
  await aClient.call('contacts.grant', { coreId: cId, projectId: alpha.id });
  // A project of X opened to C through A: X keeps a copy of the contact A holds.
  const xray = await project(x, xClient, 'xray');
  await aClient.call('contacts.grant', { coreId: cId, projectId: xray.id, machine: xId });
  await waitFor(() => x.core.contacts.members.relayedOf(cId).length === 1, 10000);
  // An older contact announces no groupLink.
  a.core.journal.setSetting('contacts', a.core.contacts.list().map(contact => ({ ...contact, capabilities: { sharedProjects: 1, humanLetters: 1, contactsBot: 1 } })));
  a.core.contacts.reset();
  await botsHome(a, aClient, x, xId);
  await Bun.sleep(1500);
  expect(a.core.contacts.has(cId)).toBe(true);
  expect(c.core.contacts.has(aId)).toBe(true);
  expect(c.core.contacts.has(xId)).toBe(false);
  expect(x.core.contacts.has(cId)).toBe(false);
  const out = await c.core.coordination.send({ threadId: cThread, to: { coreId: aId, threadId: aThread }, text: 'Still here?', requestId: crypto.randomUUID() });
  await waitFor(() => letters(a, aThread).some(letter => letter.id === out.id), 10000);
  // The Bots host's owner sees the contact A still holds, marked with A.
  expect((await x.core.contacts.state()).contacts.find(contact => contact.coreId === cId)).toMatchObject({ heldBy: aId, link: 'connected' });
}, 60000);

test('a forged move is refused and changes nothing', async () => {
  const { a, x, c, aId, xId, cId } = await setup();
  const { publicKey } = x.core.coordination.card();
  const card = { coreId: xId, publicKey, box: x.core.group.boxPublic(), url: x.url, machine: 'Team' };
  const peer = peerOf(a, cId);
  // Missing, signed by the old key instead of the new one, and signed by the new key for another contact.
  expect(await thrown(a.core.coordination.request(peer, 'contact.move', { card }))).toThrow('move.signature');
  const byOld = a.core.coordination.signature(moveInput(aId, xId, cId)).toString('base64');
  expect(await thrown(a.core.coordination.request(peer, 'contact.move', { card, signature: byOld }))).toThrow('move.signature: expected the new core\'s key');
  const elsewhere = x.core.coordination.signature(moveInput(aId, xId, aId)).toString('base64');
  expect(await thrown(a.core.coordination.request(peer, 'contact.move', { card, signature: elsewhere }))).toThrow('move.signature: expected the new core\'s key');
  expect(c.core.contacts.find(aId)).toMatchObject({ coreId: aId });
  expect(c.core.contacts.has(xId)).toBe(false);
  expect(a.core.contacts.linked(cId)).toBe(true);
}, 60000);

test('a Bots host the contact cannot reach: the move answers unreachable and the member keeps the link', async () => {
  const { a, x, c, aClient, aId, xId, cId } = await setup();
  // X gives an address nothing listens on.
  x.core.contacts.selfUrl = async () => 'http://127.0.0.1:9';
  const failures: string[] = [];
  const real = a.core.coordination.request.bind(a.core.coordination);
  a.core.coordination.request = (peer, operation, payload) => {
    const sent = real(peer, operation, payload);
    if (operation === 'contact.move') sent.catch(error => { failures.push((error as Error).message); });
    return sent;
  };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => failures.length > 0, 20000);
  expect(failures[0]).toStartWith('unreachable');
  expect(a.core.contacts.has(cId)).toBe(true);
  expect(a.core.contacts.linked(cId)).toBe(true);
  expect(c.core.contacts.find(aId)).toBeDefined();
  expect(c.core.contacts.has(xId)).toBe(false);
  expect(x.core.contacts.has(cId)).toBe(false);
}, 60000);

test('with no Bots host, a member keeps its contacts under its own name', async () => {
  const { a, x, c, aId, xId, cId } = await setup();
  a.core.contacts.groupLink.sweep(true);
  await Bun.sleep(1000);
  expect(a.core.contacts.has(cId)).toBe(true);
  expect(x.core.contacts.has(cId)).toBe(false);
  expect(c.core.contacts.find(aId)).toMatchObject({ name: 'pc-alpha', machine: 'pc-alpha' });
  expect(c.core.contacts.find(aId)?.group).toBeUndefined();
  expect(c.core.contacts.has(xId)).toBe(false);
  expect(a.core.contacts.card().machine).toBe('pc-alpha');
}, 60000);
