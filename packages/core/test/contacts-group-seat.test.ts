import { afterEach, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { botView } from '../src/contacts/bot.ts';
import { moveInput } from '../src/contacts/group-link.ts';
import { dialContact, type ContactSocketData } from '../src/contacts/link-hello.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import { botsHome, letters, project, remoteOn, requestOn, setup, thread } from './contacts-group-fixture.ts';

/* A contact that cannot reach the group's Bots host still moves there: the Bots host dials it, or it dials the Bots host's Funnel. */

const cores: TestCore[] = [];
const scratch: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
  for (const server of servers.splice(0)) server.stop(true);
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

test('a contact its member dials, which cannot reach the Mochis host, moves there with the Mochis host dialing it, and works with the member off', async () => {
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

test('a contact that dials its member and cannot reach the Mochis host\'s tailnet name moves through the Mochis host\'s Funnel', async () => {
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

/** X stops right after C followed it, before it stored C, and comes back on its data `away` ms later: it dials C again by itself. */
async function restartBeforeCommit(away: number): Promise<void> {
  const sides = await setup(cores, true);
  const { a, x, c, aClient, xId, cId } = sides;
  unreachable(x);
  x.core.contacts.groupLink.commit = () => { throw new Error('stopped before commit'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.has(xId) && !x.core.contacts.has(cId), 20000);
  // Away longer than a handed contact waits (1 h): only the hand's time ages, as if X had been off that long.
  const incoming = x.core.journal.getSetting('contacts:incoming') as { at: number }[];
  x.core.journal.setSetting('contacts:incoming', incoming.map(entry => ({ ...entry, at: entry.at - away })));
  const back = await restarted(x);
  // Back on its data, X dials C at the seat it was handed: nothing waits for A.
  await waitFor(() => back.core.contacts.has(cId) && back.core.contacts.linked(cId), 20000);
  expect(back.core.contacts.find(cId)).toMatchObject({ role: 'guest', url: c.url });
  await flowsWithoutHolder({ ...sides, x: back, xClient: await back.connect() });
}

test('a Mochis host that stopped after the contact took its hello, before keeping the contact, dials it again once it is back', async () => {
  await restartBeforeCommit(0);
}, 90000);

test('a Mochis host back two hours after the contact took its hello still dials it again', async () => {
  await restartBeforeCommit(2 * 3_600_000);
}, 90000);

/** X marks C's seat dialed, then its hello never leaves: C never followed X, which resumes the dial on its sweeps. */
async function strandedBeforeHello(): Promise<{ sides: Awaited<ReturnType<typeof setup>>; restore: () => void }> {
  const sides = await setup(cores, true);
  const { a, x, aClient, xId, cId } = sides;
  unreachable(x);
  const hello = x.core.contacts.helloHeaders.bind(x.core.contacts);
  x.core.contacts.helloHeaders = () => { throw new Error('outbound outage'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => a.core.contacts.groupLink.stuck(cId) !== undefined && x.core.contacts.groupLink.resuming(), 10000);
  return { sides, restore: () => { x.core.contacts.helloHeaders = hello; } };
}

/** Restarts `x` on a copy of its data, at the same address: what it kept only in memory is gone. */
async function restarted(x: TestCore): Promise<TestCore> {
  const saved = mkdtempSync(join(tmpdir(), 'boite-seat-restart-'));
  scratch.push(saved);
  const dataDir = join(saved, 'data');
  cpSync(x.dataDir, dataDir, { recursive: true });
  const port = Number(new URL(x.url).port);
  await x.stop();
  const back = await startTestCore({ dataDir, port });
  cores.push(back);
  unreachable(back);
  return back;
}

test('removing a contact on the member cancels the seat the Mochis host still dials', async () => {
  const { sides: { x, c, aClient, xClient, aId, xId, cId }, restore } = await strandedBeforeHello();
  const xray = await project(x, xClient, 'xray');
  await aClient.call('contacts.grant', { coreId: cId, projectId: xray.id, machine: xId });
  await aClient.call('contacts.remove', { coreId: cId });
  await waitFor(() => !x.core.contacts.groupLink.resuming(), 10000);
  restore();
  x.core.contacts.groupLink.sweep();
  // The cancel took the entry: A's late dial of that seat finds nothing to take.
  expect(await thrown(x.core.contacts.groupLink.handed(x.core.group.peers().find(peer => peer.coreId === aId)!, { action: 'dial', contact: cId }))).toThrow('handed no guest seat');
  expect(x.core.contacts.has(cId)).toBe(false);
  expect(c.core.contacts.has(xId)).toBe(false);
}, 60000);

test('a Mochis host that missed the cancel asks the member before it dials the seat again', async () => {
  const { sides: { a, c, x, aClient, xId, cId } } = await strandedBeforeHello();
  const request = a.core.coordination.request.bind(a.core.coordination);
  a.core.coordination.request = (peer, op, payload) => (payload as { action?: unknown } | null)?.action === 'cancel' ? Promise.reject(new Error('lost on the way')) : request(peer, op, payload);
  await aClient.call('contacts.remove', { coreId: cId });
  // An ask that names no admission is rejected, never read as "not handing".
  expect(await thrown(a.core.contacts.groupLink.handed(a.core.group.peers().find(peer => peer.coreId === xId)!, { action: 'pending', contact: cId }))).toThrow('hand.admission');
  // Back with a fresh hello and no wait in memory, X still holds C's seat entry, which C still honours.
  const back = await restarted(x);
  await waitFor(() => !back.core.contacts.groupLink.resuming(), 10000);
  expect(back.core.contacts.has(cId)).toBe(false);
  expect(c.core.contacts.has(xId)).toBe(false);
}, 60000);

test('a bare 403 from the contact keeps the Mochis host dialing its seat until the contact takes the hello', async () => {
  const { a, x, c, aClient, xId, cId } = await setup(cores, true);
  unreachable(x);
  x.core.contacts.groupLink.commit = () => { throw new Error('stopped before commit'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.has(xId) && !x.core.contacts.has(cId), 20000);
  const incoming = x.core.journal.getSetting('contacts:incoming') as { at: number }[];
  x.core.journal.setSetting('contacts:incoming', incoming.map(entry => ({ ...entry, at: entry.at - 8 * 24 * 3_600_000 })));
  // What C answers with contacts off by policy, or what a proxy in front of it answers: nothing signed by C.
  const hello = c.core.contacts.hello.bind(c.core.contacts);
  let refusals = 0;
  c.core.contacts.hello = () => { refusals += 1; return new Response('forbidden', { status: 403 }); };
  const back = await restarted(x);
  await waitFor(() => refusals > 0, 10000);
  await Bun.sleep(200);
  expect(back.core.contacts.groupLink.resuming()).toBe(true);
  c.core.contacts.hello = hello;
  const clock = Date.now;
  // Past the 10 minute wait after a failed dial.
  Date.now = () => clock() + 11 * 60_000;
  try {
    back.core.contacts.groupLink.sweep();
    await waitFor(() => back.core.contacts.has(cId) && back.core.contacts.linked(cId), 20000);
  } finally { Date.now = clock; }
}, 90000);

test('a contact that signs its refusal of the Mochis host\'s hello ends the resume of a seat it never took', async () => {
  const { sides: { x, c, cClient, aId, xId, cId }, restore } = await strandedBeforeHello();
  await cClient.call('contacts.remove', { coreId: aId });
  restore();
  const clock = Date.now;
  Date.now = () => clock() + 11 * 60_000;
  try {
    x.core.contacts.groupLink.sweep();
    await waitFor(() => !x.core.contacts.groupLink.resuming(), 10000);
  } finally { Date.now = clock; }
  expect(x.core.contacts.has(cId)).toBe(false);
  expect(c.core.contacts.has(xId)).toBe(false);
}, 60000);

/** Holds `core`'s `contact.hand` requests with `action` until `release`: before they leave, or once answered (`after`). Counts the ones delivered. */
function holdRequests(core: TestCore, action: string, after: boolean): { held: () => boolean; release: () => void; delivered: () => number } {
  let release: (() => void) | undefined;
  let delivered = 0;
  const request = core.core.coordination.request.bind(core.core.coordination);
  core.core.coordination.request = async (peer, op, payload) => {
    if (op !== 'contact.hand' || (payload as { action?: unknown } | null)?.action !== action) return request(peer, op, payload);
    const wait = () => new Promise<void>(resolve => { release = resolve; });
    if (!after) await wait();
    const answer = await request(peer, op, payload);
    if (after) await wait();
    delivered += 1;
    return answer;
  };
  return { held: () => release !== undefined, release: () => { const go = release; release = undefined; go?.(); }, delivered: () => delivered };
}

/**
 * X asks A about C's seat and A says it still hands C; the answer is slow, and
 * meanwhile A's owner removes C, whose cancel is slower still. `followed`: C
 * already took X's hello before X stopped short of keeping it.
 */
async function lateCancel(followed: boolean): Promise<void> {
  const sides = await setup(cores, true);
  const { a, x, c, aClient, xClient, xId, cId } = sides;
  const xray = await project(x, xClient, 'xray');
  await aClient.call('contacts.grant', { coreId: cId, projectId: xray.id, machine: xId });
  unreachable(x);
  const hello = x.core.contacts.helloHeaders.bind(x.core.contacts);
  if (followed) x.core.contacts.groupLink.commit = () => { throw new Error('stopped before commit'); };
  else x.core.contacts.helloHeaders = () => { throw new Error('outbound outage'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => a.core.contacts.groupLink.stuck(cId) !== undefined && x.core.contacts.groupLink.resuming(), 20000);
  expect(c.core.contacts.has(xId)).toBe(followed);
  Reflect.deleteProperty(x.core.contacts.groupLink, 'commit');
  x.core.contacts.helloHeaders = hello;
  // The answer is slow to come back; the cancel is slow to leave.
  const pending = holdRequests(x, 'pending', true);
  const cancel = holdRequests(a, 'cancel', false);
  try {
    x.core.contacts.groupLink.sweep();
    await waitFor(pending.held, 10000);
    await aClient.call('contacts.remove', { coreId: cId });
    await waitFor(() => cancel.held() && x.core.contacts.members.relayedOf(cId).length === 0, 10000);
    pending.release();
    // C that followed X is taken back on the stale answer; C that only held a seat refuses the resume.
    await waitFor(() => followed ? x.core.contacts.has(cId) : !x.core.contacts.groupLink.resuming(), 10000);
    expect(c.core.contacts.has(xId)).toBe(followed);
    cancel.release();
    await waitFor(() => cancel.delivered() > 0, 10000);
    expect(x.core.contacts.has(cId)).toBe(false);
    expect(x.core.journal.getSetting('contacts:incoming')).toEqual([]);
    // Removing C here sends X's own cancel of it to A: the sweeps stop once A acknowledges it.
    await waitFor(() => !x.core.contacts.groupLink.resuming(), 10000);
  } finally { pending.release(); cancel.release(); }
}

test('a cancel slower than the member\'s answer still removes the contact the Mochis host took back on it', async () => {
  await lateCancel(true);
}, 60000);

test('a resume the member allowed before its owner removed the contact never takes a seat the contact still holds', async () => {
  await lateCancel(false);
}, 60000);

test('a contact that followed the Mochis host is recovered after the member that handed it left the group', async () => {
  const { a, x, c, aClient, aId, xId, cId } = await setup(cores, true);
  unreachable(x);
  x.core.contacts.groupLink.commit = () => { throw new Error('stopped before commit'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.has(xId) && !x.core.contacts.has(cId), 20000);
  await waitFor(() => a.core.contacts.groupLink.stuck(cId) !== undefined, 10000);
  x.core.group.remove(aId);
  await a.stop();
  // A can neither answer nor cancel any more: C, which only knows X now, decides.
  const back = await restarted(x);
  await waitFor(() => back.core.contacts.has(cId) && back.core.contacts.linked(cId), 20000);
  expect(back.core.contacts.groupLink.resuming()).toBe(false);
  expect(back.core.journal.getSetting('contacts:incoming')).toEqual([]);
}, 60000);

test('a contact removed, linked again and removed again while the Mochis host is out of reach loses the first link there too', async () => {
  const { a, x, c, aClient, xClient, cClient, xId, cId } = await setup(cores, true);
  const xray = await project(x, xClient, 'xray');
  await aClient.call('contacts.grant', { coreId: cId, projectId: xray.id, machine: xId });
  unreachable(x);
  x.core.contacts.groupLink.commit = () => { throw new Error('stopped before commit'); };
  await botsHome(a, aClient, x, xId);
  await waitFor(() => c.core.contacts.has(xId) && !x.core.contacts.has(cId) && a.core.contacts.groupLink.stuck(cId) !== undefined, 20000);
  Reflect.deleteProperty(x.core.contacts.groupLink, 'commit');
  x.core.contacts.groupLink.sweep();
  await waitFor(() => x.core.contacts.has(cId), 10000);
  const first = a.core.contacts.find(cId)!.addedAt;
  // X misses every hand and cancel from A while A's owner removes C, links it again and removes it again.
  const request = a.core.coordination.request.bind(a.core.coordination);
  let out = true;
  a.core.coordination.request = (peer, op, payload) => out && peer.coreId === xId && op === 'contact.hand'
    ? Promise.reject(new Error('temporary outage'))
    : request(peer, op, payload);
  const cancels = () => (a.core.journal.getSetting('contacts:hand-cancels') as { admission: number }[] | undefined) ?? [];
  await aClient.call('contacts.remove', { coreId: cId });
  await aClient.call('contacts.join', { link: (await cClient.call('contacts.invite', {})).link });
  await waitFor(() => a.core.contacts.linked(cId) && a.core.contacts.find(cId)?.capabilities?.groupLink === 1, 10000);
  const second = a.core.contacts.find(cId)!.addedAt;
  expect(second).not.toBe(first);
  await aClient.call('contacts.remove', { coreId: cId });
  expect(cancels().map(cancel => cancel.admission)).toEqual([first, second]);
  out = false;
  a.core.contacts.groupLink.sweep();
  await waitFor(() => cancels().length === 0, 10000);
  expect(x.core.contacts.has(cId)).toBe(false);
  expect(x.core.journal.getSetting('contacts:handed')).toEqual([]);
}, 60000);

test('a server that takes the upgrade without the Mochis host\'s key does not win the move over the Mochis host', async () => {
  const { a, x, c, aClient, xId, cId } = await setup(cores);
  // Answers every upgrade at once and holds no key of X: a wrong or replaced public origin.
  const impostor = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request, server) { return server.upgrade(request) ? undefined : new Response('no'); }, websocket: { message() {} } });
  servers.push(impostor);
  // X itself, 200 ms further away.
  const real = Bun.serve<ContactSocketData['contact']>({ hostname: '127.0.0.1', port: 0,
    async fetch(request, server) {
      await Bun.sleep(200);
      const verdict = x.core.contacts.hello(request);
      if (verdict instanceof Response) return verdict;
      return server.upgrade(request, { data: verdict }) ? undefined : new Response('not an upgrade', { status: 400 });
    },
    websocket: {
      open(socket) { x.core.contacts.attach(socket.data, socket); },
      message(socket, frame) { x.core.contacts.frame(socket.data, frame); },
      close(socket) { x.core.contacts.detach(socket.data); },
    },
  });
  servers.push(real);
  const tailnet = `http://127.0.0.1:${real.port}`;
  x.core.contacts.selfUrl = async () => tailnet;
  x.core.contacts.publicUrl = () => `http://127.0.0.1:${impostor.port}`;
  await botsHome(a, aClient, x, xId);
  await waitFor(() => x.core.contacts.has(cId) && !a.core.contacts.has(cId), 20000);
  expect(c.core.contacts.find(xId)?.url).toBe(tailnet);
  await waitFor(() => x.core.contacts.linked(cId) && c.core.contacts.linked(xId), 10000);
}, 60000);
