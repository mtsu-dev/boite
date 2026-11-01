import { afterEach, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentLetter, CoordinationPeer } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { memberThreadId } from '../src/contacts/members.ts';
import { moveInput } from '../src/contacts/group-link.ts';
import { botMoveId } from '../src/contacts/bot-home.ts';
import { contactsBot } from '../src/contacts/bot.ts';
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
  // Both cores support group links, yet no Bots host stands between them: a letter keeps the 15 minute window.
  expect(c.core.contacts.letterTtl(aId)).toBeUndefined();
  expect(a.core.contacts.letterTtl(cId)).toBeUndefined();

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
  // A letter to a group that may be off waits 7 days, not 15 minutes, and so does A's, which goes through its Bots host.
  expect(out.expiresAt - out.createdAt).toBe(7 * 24 * 3_600_000);
  expect(a.core.contacts.letterTtl(cId)).toBe(7 * 24 * 3_600_000);

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

test('a full Bots host refuses the hand: the member keeps the contact and its link, and the host lists it under the member', async () => {
  const { a, x, c, aClient, xClient, aId, xId, cId } = await setup();
  // A project of X opened to C through A: X keeps a copy of the contact A holds.
  const xray = await project(x, xClient, 'xray');
  await aClient.call('contacts.grant', { coreId: cId, projectId: xray.id, machine: xId });
  x.core.contacts.occupied = () => x.core.contacts.maxContacts;
  const failures: string[] = [];
  const real = a.core.coordination.request.bind(a.core.coordination);
  a.core.coordination.request = (peer, operation, payload) => {
    const sent = real(peer, operation, payload);
    if (operation === 'contact.hand' && (payload as { action?: string }).action === 'hand') sent.catch(error => { failures.push((error as Error).message); });
    return sent;
  };
  await botsHome(a, aClient, x, xId);
  // A hand that reached X before X read the new roster fails for that reason first.
  await waitFor(() => failures.some(failure => failure.includes('holds 32 contacts already')), 20000);
  expect(a.core.contacts.linked(cId)).toBe(true);
  expect(c.core.contacts.find(aId)).toBeDefined();
  expect(c.core.contacts.has(xId)).toBe(false);
  expect(x.core.contacts.has(cId)).toBe(false);
  expect(x.core.contacts.groupLink.incoming(cId)).toBeUndefined();
  await waitFor(() => x.core.contacts.members.relayedOf(cId).length === 1, 10000);
  expect((await x.core.contacts.state()).contacts.find(contact => contact.coreId === cId)).toMatchObject({ heldBy: aId });
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

const remoteOn = (harness: TestCore, threadId: string): void => { harness.core.coordination.configure(threadId, { mode: 'brief', remote: true, resources: '', paused: false }); };
const requestOn = (harness: TestCore, id: string) => harness.core.contacts.requests.list().find(request => request.id === id && request.direction === 'out');

test('a member without a Contacts bot asks through the Bots host: queued while the host is silent, filed there under its thread and id, refused after 7 days, and answered back', async () => {
  const { a, x, c, aClient, xClient, cClient, aId, xId, cId } = await setup();
  const aThread = await thread(aClient, (await project(a, aClient, 'alpha')).id, 'Alpha work');
  remoteOn(a, aThread);
  const xBot = await contactsBotOf(x, xClient);
  await botsHome(a, aClient, x, xId);
  // X does not answer: the ask waits on A with a status that says so.
  const real = a.core.coordination.request.bind(a.core.coordination);
  let silent = true;
  a.core.coordination.request = (peer, operation, payload) => silent && operation === 'contact.route' ? Promise.reject(new Error('unreachable: test')) : real(peer, operation, payload);
  const queued = await aClient.call('collaboration.ask', { threadId: aThread, text: 'Who runs the build farm?' });
  expect(queued).toMatchObject({ status: 'pending', stage: 'host' });
  expect(x.core.contacts.requests.list().some(request => request.id === queued.id)).toBe(false);
  const stale = await aClient.call('collaboration.ask', { threadId: aThread, text: 'An old question' });
  // A week later the host never took the second one: refused, with the reason.
  const requests = a.core.contacts.requests.list();
  requests.find(request => request.id === stale.id)!.createdAt -= 8 * 24 * 3_600_000;
  a.core.contacts.requests.save(requests);
  silent = false;
  a.core.contacts.hostAsks.retry();
  await waitFor(() => x.core.contacts.requests.list().some(request => request.id === queued.id), 10000);
  expect(x.core.contacts.requests.list().find(request => request.id === queued.id)!.from).toMatchObject({ coreId: aId, threadId: aThread });
  await waitFor(() => requestOn(a, stale.id)?.status === 'refused', 10000);
  expect(requestOn(a, stale.id)!.reason).toContain('Bots host stayed unreachable for 7 days');
  expect(x.core.contacts.requests.list().some(request => request.id === stale.id)).toBe(false);
  await waitFor(() => requestOn(a, queued.id)?.stage !== 'host', 10000);
  // X's bot sends it to C, which reads A's thread at its alias on X; C's refusal comes back to A's thread.
  // A hand tried before X read the roster waits 30 s for its retry: offer it again until C follows.
  await waitFor(() => { if (!x.core.contacts.has(cId)) a.core.contacts.groupLink.sweep(true); return x.core.contacts.linkOf(cId) === 'connected'; }, 20000);
  await xClient.call('contacts.bot.forward', { threadId: xBot.threadId, id: queued.id, contact: x.core.contacts.find(cId)!.name });
  const incoming = () => c.core.contacts.requests.list().find(request => request.direction === 'in' && request.text === 'Who runs the build farm?');
  await waitFor(() => incoming() !== undefined, 10000);
  expect(incoming()!.from).toMatchObject({ coreId: xId, threadId: memberThreadId(aId, aThread) });
  await cClient.call('contacts.decide', { id: incoming()!.id, accept: false, reason: 'No contact knows' });
  await waitFor(() => requestOn(a, queued.id)?.status === 'refused', 10000);
  expect(requestOn(a, queued.id)!.reason).toBe('No contact knows');
  await waitFor(() => requestOn(x, queued.id)?.pendingMember === undefined, 10000);
}, 60000);

test('a relation made before the move carries letters both ways after it, through the Bots host', async () => {
  const { a, x, c, aClient, cClient, aId, xId, cId } = await setup();
  const aThread = await thread(aClient, (await project(a, aClient, 'alpha')).id, 'Alpha work');
  const cThread = await thread(cClient, (await project(c, cClient, 'mine')).id, 'Guest work');
  remoteOn(a, aThread);
  remoteOn(c, cThread);
  // The bots put the two threads in touch; no project is shared.
  a.core.contacts.relations.add({ id: 'crel_before', coreId: cId, contact: a.core.contacts.find(cId)!.name, local: { threadId: aThread, title: 'Alpha work' }, remote: c.core.coordination.describe(cThread), requestId: 'creq_before' });
  c.core.contacts.relations.add({ id: 'crel_before', coreId: aId, contact: c.core.contacts.find(aId)!.name, local: { threadId: cThread, title: 'Guest work' }, remote: a.core.coordination.describe(aThread), requestId: 'creq_before' });
  const before = await c.core.coordination.send({ threadId: cThread, to: { coreId: aId, threadId: aThread }, text: 'Before the move', requestId: crypto.randomUUID() });
  await waitFor(() => letters(a, aThread).some(letter => letter.id === before.id), 10000);

  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.find(xId) !== undefined && !a.core.contacts.has(cId), 20000);
  // C re-keyed its side to X and A's thread alias; X holds the relation at that alias; A keeps none of its own.
  expect(c.core.contacts.relations.list()).toEqual([expect.objectContaining({ coreId: xId, remote: expect.objectContaining({ coreId: xId, threadId: memberThreadId(aId, aThread) }) })]);
  expect(x.core.contacts.relations.list()).toEqual([expect.objectContaining({ coreId: cId, local: expect.objectContaining({ threadId: memberThreadId(aId, aThread) }), remote: expect.objectContaining({ threadId: cThread }) })]);
  expect(a.core.contacts.relations.list()).toEqual([]);
  await waitFor(() => x.core.contacts.linkOf(cId) === 'connected', 10000);
  await waitFor(() => a.core.contacts.members.relayedOf(cId).some(entry => (entry.relations?.length ?? 0) > 0), 10000);

  const after = await c.core.coordination.send({ threadId: cThread, to: { coreId: xId, threadId: memberThreadId(aId, aThread) }, text: 'After the move', requestId: crypto.randomUUID() });
  await waitFor(() => letters(a, aThread).some(letter => letter.id === after.id), 10000);
  await a.core.coordination.send({ threadId: aThread, to: { coreId: cId, threadId: cThread }, text: 'Back from alpha', requestId: crypto.randomUUID() });
  await waitFor(() => letters(c, cThread).some(letter => letter.text === 'Back from alpha'), 10000);
  expect(letters(c, cThread).find(letter => letter.text === 'Back from alpha')!.from).toMatchObject({ coreId: xId, threadId: memberThreadId(aId, aThread) });
}, 90000);

test('a Bots role change moves the Contacts bot first, under one move id per role revision, and the links follow once the host holds it', async () => {
  const { a, x, c, aClient, xId, cId } = await setup();
  await contactsBotOf(a, aClient);
  const sent: string[] = [];
  const realMove = a.core.workforce.moves.move.bind(a.core.workforce.moves);
  let fail = true;
  a.core.workforce.moves.move = async params => {
    sent.push(params.requestId ?? '');
    if (fail) throw new Error('unreachable: test');
    return realMove(params);
  };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => sent.length > 0, 10000);
  await Bun.sleep(1000);
  // The move failed: A keeps its bot and its contact, X holds neither.
  expect(contactsBot(a.core)).not.toBeNull();
  expect(contactsBot(x.core)).toBeNull();
  expect(a.core.contacts.has(cId)).toBe(true);
  expect(x.core.contacts.has(cId)).toBe(false);
  fail = false;
  a.core.contacts.groupLink.sweep(true);
  await waitFor(() => contactsBot(x.core) !== null && contactsBot(a.core) === null, 20000);
  await waitFor(() => c.core.contacts.find(xId) !== undefined && !a.core.contacts.has(cId), 20000);
  const id = botMoveId(a.core.group.roster!.botsHomeRev!, xId);
  // Every attempt, the failed ones and the one that went, sent the same move.
  expect(sent.length).toBeGreaterThan(1);
  expect(new Set(sent)).toEqual(new Set([id]));
}, 90000);

test('a member that announced its Contacts bot leaves the group before sending it: the Bots host starts a fresh one', async () => {
  const { a, x, aClient, aId, xId } = await setup();
  await contactsBotOf(a, aClient);
  a.core.workforce.moves.move = async () => { throw new Error('unreachable: test'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => x.core.journal.getSetting('contacts:bot-coming') === aId, 10000);
  expect(contactsBot(x.core)).toBeNull();
  x.core.group.remove(aId);
  await waitFor(() => contactsBot(x.core) !== null, 10000);
  expect(x.core.journal.getSetting('contacts:bot-coming')).toBeUndefined();
}, 60000);

test('the Bots role moves on, from X to a third member Y, then back to A: a relation made before the first move still carries letters both ways, and the contact names the current host', async () => {
  const { a, x, c, aClient, cClient, aId, xId, cId } = await setup();
  const y = await startTestCore();
  cores.push(y);
  named(y, 'pc-yankee');
  y.core.contacts.selfUrl = async () => y.url;
  y.core.contacts.setSettings({ minTier: 2 });
  const yId = y.core.coordination.card().coreId;
  await y.core.group.join((await a.core.group.invite()).invite);
  const members = [a, x, y];
  await waitFor(() => members.every(side => side.core.group.peers().length === 2), 10000);
  const aThread = await thread(aClient, (await project(a, aClient, 'alpha')).id, 'Alpha work');
  const cThread = await thread(cClient, (await project(c, cClient, 'mine')).id, 'Guest work');
  remoteOn(a, aThread);
  remoteOn(c, cThread);
  a.core.contacts.relations.add({ id: 'crel_before', coreId: cId, contact: a.core.contacts.find(cId)!.name, local: { threadId: aThread, title: 'Alpha work' }, remote: c.core.coordination.describe(cThread), requestId: 'creq_before' });
  c.core.contacts.relations.add({ id: 'crel_before', coreId: aId, contact: c.core.contacts.find(aId)!.name, local: { threadId: cThread, title: 'Guest work' }, remote: a.core.coordination.describe(aThread), requestId: 'creq_before' });

  let holder = a;
  const steps: [TestCore, string][] = [[x, xId], [y, yId], [a, aId]];
  for (const [step, [host, hostId]] of steps.entries()) {
    await aClient.call('group.botsHome', { coreId: hostId });
    await waitFor(() => members.every(side => side.core.group.roleOf('botsHome') === hostId), 10000);
    // A hand that reached the host before it read the new roster waits 30 s: offered again every second instead.
    const before = holder.core.coordination.card().coreId, from = holder;
    let swept = 0;
    await waitFor(() => {
      if (Date.now() - swept > 1000) { swept = Date.now(); from.core.contacts.groupLink.sweep(true); }
      return c.core.contacts.find(hostId) !== undefined && !from.core.contacts.has(cId) && host.core.contacts.has(cId);
    }, 30000);
    holder = host;
    // C names the current host only, and holds the relation with A's thread at its address there.
    expect(c.core.contacts.find(before)).toBeUndefined();
    const at = hostId === aId ? aThread : memberThreadId(aId, aThread);
    expect(c.core.contacts.relations.list()).toEqual([expect.objectContaining({ id: 'crel_before', coreId: hostId, remote: expect.objectContaining({ coreId: hostId, threadId: at }) })]);
    expect(host.core.contacts.relations.list()).toEqual([expect.objectContaining({ id: 'crel_before', coreId: cId, local: expect.objectContaining({ threadId: at }) })]);
    for (const other of members.filter(side => side !== host)) expect(other.core.contacts.relations.list()).toEqual([]);
    await waitFor(() => host.core.contacts.linkOf(cId) === 'connected', 10000);
    if (hostId !== aId) await waitFor(() => a.core.contacts.members.relayedOf(cId).some(entry => entry.via === hostId && (entry.relations?.length ?? 0) > 0), 10000);
    const out = await c.core.coordination.send({ threadId: cThread, to: { coreId: hostId, threadId: at }, text: `To alpha ${step}`, requestId: crypto.randomUUID() });
    await waitFor(() => letters(a, aThread).some(letter => letter.id === out.id), 10000);
    await a.core.coordination.send({ threadId: aThread, to: { coreId: cId, threadId: cThread }, text: `From alpha ${step}`, requestId: crypto.randomUUID() });
    await waitFor(() => letters(c, cThread).some(letter => letter.text === `From alpha ${step}`), 10000);
    expect(letters(c, cThread).find(letter => letter.text === `From alpha ${step}`)!.from).toMatchObject({ coreId: hostId, threadId: at });
  }
}, 180000);
