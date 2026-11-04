import { afterEach, expect, test } from 'bun:test';
import { botView } from '../src/contacts/bot.ts';
import { memberThreadId } from '../src/contacts/members.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import { botsHome, letters, named, project, remoteOn, requestOn, setup, thread } from './contacts-group-fixture.ts';

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
});

test('a contact a member still holds is the whole group\'s: asked from the Bots host, from that member and from a third member, the host\'s bot forwards it through the member and each answer comes back', async () => {
  const { a, x, c, aClient, xClient, cClient, aId, xId, cId } = await setup(cores);
  const y = await startTestCore();
  cores.push(y);
  named(y, 'pc-yankee');
  y.core.contacts.setSettings({ minTier: 2 });
  const yId = y.core.coordination.card().coreId;
  await y.core.group.join((await a.core.group.invite()).invite);
  await waitFor(() => [a, x, y].every(side => side.core.group.peers().length === 2), 10000);
  const yClient = await y.connect();
  const xThread = await thread(xClient, (await project(x, xClient, 'xray')).id, 'Xray work');
  const aThread = await thread(aClient, (await project(a, aClient, 'alpha')).id, 'Alpha work');
  const yThread = await thread(yClient, (await project(y, yClient, 'yankee')).id, 'Yankee work');
  const cThread = await thread(cClient, (await project(c, cClient, 'mine')).id, 'Guest work');
  for (const [side, id] of [[x, xThread], [a, aThread], [y, yThread], [c, cThread]] as const) remoteOn(side, id);
  await cClient.call('contacts.update', { coreId: aId, trusted: true });
  const cBot = await contactsBotOf(c, cClient);
  // X hosts the bots, but C cannot reach X (it is on another network): A keeps the link.
  const xBot = await contactsBotOf(x, xClient);
  x.core.contacts.selfUrl = async () => 'http://127.0.0.1:9';
  await botsHome(a, aClient, x, xId);
  await waitFor(() => y.core.group.roleOf('botsHome') === xId, 10000);
  const name = a.core.contacts.find(cId)!.name;
  // X's bot lists C, linked through A.
  const alpha = x.core.group.peers().find(peer => peer.coreId === aId)!.name;
  // It names why the link stayed on A.
  await waitFor(() => botView(x.core).contacts.some(contact => contact.coreId === cId && contact.heldBy === alpha && contact.heldReason?.startsWith('unreachable') === true), 20000);
  expect(a.core.contacts.has(cId)).toBe(true);
  expect(x.core.contacts.has(cId)).toBe(false);
  const incoming = (words: string) => c.core.contacts.requests.list().find(request => request.direction === 'in' && request.text === words);

  // (1) A thread on the Bots host names C: X's bot forwards it through A, C reads X's thread at its alias on A, and the relation C makes carries letters both ways.
  const fromX = await xClient.call('collaboration.ask', { threadId: xThread, contact: name, text: 'Who runs the build farm?' });
  expect(fromX).toMatchObject({ status: 'pending', stage: 'bot' });
  await xClient.call('contacts.bot.forward', { threadId: xBot.threadId, id: fromX.id, contact: name });
  await waitFor(() => incoming('Who runs the build farm?') !== undefined, 10000);
  expect(incoming('Who runs the build farm?')!.from).toMatchObject({ coreId: aId, threadId: memberThreadId(xId, xThread) });
  await cClient.call('contacts.bot.connect', { threadId: cBot.threadId, id: incoming('Who runs the build farm?')!.id, target: cThread });
  await waitFor(() => requestOn(x, fromX.id)?.status === 'accepted', 10000);
  await waitFor(() => letters(x, xThread).some(letter => letter.text.includes('put you in touch')), 10000);
  await waitFor(() => requestOn(a, fromX.id)?.pendingMember === undefined, 10000);
  await waitFor(() => x.core.contacts.members.relayedOf(cId).some(entry => (entry.relations?.length ?? 0) > 0), 10000);
  const out = await x.core.coordination.send({ threadId: xThread, to: { coreId: cId, threadId: cThread }, text: 'Hello from xray', requestId: crypto.randomUUID() });
  await waitFor(() => letters(c, cThread).some(letter => letter.text === 'Hello from xray'), 10000);
  expect(letters(c, cThread).find(letter => letter.text === 'Hello from xray')!.from).toMatchObject({ coreId: aId, threadId: memberThreadId(xId, xThread) });
  expect(out.to.coreId).toBe(cId);
  await c.core.coordination.send({ threadId: cThread, to: { coreId: aId, threadId: memberThreadId(xId, xThread) }, text: 'Back to xray', requestId: crypto.randomUUID() });
  await waitFor(() => letters(x, xThread).some(letter => letter.text === 'Back to xray'), 10000);

  // (2) A thread of A, which relays its asks to X: X's bot forwards it back to A, which sends it as its own thread's.
  const fromA = await aClient.call('collaboration.ask', { threadId: aThread, contact: name, text: 'Is alpha on 8080?' });
  await waitFor(() => requestOn(x, fromA.id) !== undefined, 10000);
  await xClient.call('contacts.bot.forward', { threadId: xBot.threadId, id: fromA.id, contact: name });
  await waitFor(() => incoming('Is alpha on 8080?') !== undefined, 10000);
  expect(incoming('Is alpha on 8080?')!.from).toMatchObject({ coreId: aId, threadId: aThread });
  await cClient.call('contacts.decide', { id: incoming('Is alpha on 8080?')!.id, accept: false, reason: 'Not on 8080' });
  await waitFor(() => requestOn(a, fromA.id)?.status === 'refused' && requestOn(x, fromA.id)?.status === 'refused', 10000);
  expect(requestOn(a, fromA.id)!.reason).toBe('Not on 8080');
  await waitFor(() => letters(a, aThread).some(letter => letter.text.includes('Not on 8080')), 10000);

  // (3) A thread of Y, a third member: X forwards it through A, and the answer comes back to Y through X.
  const fromY = await yClient.call('collaboration.ask', { threadId: yThread, contact: name, text: 'Does yankee build?' });
  await waitFor(() => requestOn(x, fromY.id) !== undefined, 10000);
  await xClient.call('contacts.bot.forward', { threadId: xBot.threadId, id: fromY.id, contact: name });
  await waitFor(() => incoming('Does yankee build?') !== undefined, 10000);
  expect(incoming('Does yankee build?')!.from).toMatchObject({ coreId: aId, threadId: memberThreadId(yId, yThread) });
  await cClient.call('contacts.decide', { id: incoming('Does yankee build?')!.id, accept: false, reason: 'No yankee here' });
  await waitFor(() => requestOn(y, fromY.id)?.status === 'refused', 10000);
  expect(requestOn(y, fromY.id)!.reason).toBe('No yankee here');
  await waitFor(() => letters(y, yThread).some(letter => letter.text.includes('No yankee here')), 10000);
  await waitFor(() => requestOn(x, fromY.id)?.pendingMember === undefined, 10000);
}, 90000);

test('an ask names what boite threads contacts lists: a contact of a member that sends no held list is named with that member, an unknown one with the group', async () => {
  const { a, x, aClient, xClient, xId, cId } = await setup(cores);
  const xThread = await thread(xClient, (await project(x, xClient, 'xray')).id, 'Xray work');
  remoteOn(x, xThread);
  await contactsBotOf(x, xClient);
  x.core.contacts.selfUrl = async () => 'http://127.0.0.1:9';
  // A runs an older Boite: it tells no list of the contacts it holds.
  a.core.contacts.held.outgoing = () => [];
  await botsHome(a, aClient, x, xId);
  const name = a.core.contacts.find(cId)!.name;
  // `boite threads contacts` lists C through A's route, so the ask never calls it unknown.
  expect((await xClient.call('collaboration.contacts', { threadId: xThread })).map(contact => contact.coreId)).toContain(cId);
  const alpha = x.core.group.peers().find(peer => peer.coreId === a.core.coordination.card().coreId)!.name;
  expect(await thrown(xClient.call('collaboration.ask', { threadId: xThread, contact: name, text: 'Anyone?' }))).toThrow(`contact: ${name} is linked to ${alpha}, which has not told this machine about it yet`);
  expect(await thrown(xClient.call('collaboration.ask', { threadId: xThread, contact: 'Nobody', text: 'Anyone?' }))).toThrow('contact: Nobody is not a contact of any machine of this group; see boite threads contacts');
}, 60000);
