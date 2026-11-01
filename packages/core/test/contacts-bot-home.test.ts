import { afterEach, expect, test } from 'bun:test';
import type { CoordinationPeer } from '@boite/contracts';
import { botMoveId } from '../src/contacts/bot-home.ts';
import { contactsBot } from '../src/contacts/bot.ts';
import { contactsBotOf } from './contacts-fixture.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';

/* The Contacts bot follows the Bots role (`contacts/bot-home.ts`) even when the answer of its move is lost. */

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
});

test('the answer of the Contacts bot move is lost: the handoff waits, the next sweep finishes the same move, and one bot is left', async () => {
  const a = await startTestCore(), x = await startTestCore();
  cores.push(a, x);
  const aClient = await a.connect();
  const aId = a.core.coordination.card().coreId, xId = x.core.coordination.card().coreId;
  await a.core.group.create('Team');
  await x.core.group.join((await a.core.group.invite()).invite);
  await waitFor(() => a.core.group.peers().some(peer => peer.coreId === xId) && x.core.group.peers().some(peer => peer.coreId === aId), 10000);
  const { agentId, threadId } = await contactsBotOf(a, aClient);
  // The first answer of the move never comes back: X made the bot, A did not hear it.
  const request = a.core.coordination.request.bind(a.core.coordination);
  const moves: string[] = [];
  a.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    const answer = await request(peer, operation, payload);
    if (operation !== 'bot.move') return answer;
    moves.push((payload as { requestId: string }).requestId);
    if (moves.length === 1) throw new Error('the connection dropped');
    return answer;
  };
  const sweep = (): true => { a.core.contacts.groupLink.sweep(true); return true; };
  await aClient.call('group.botsHome', { coreId: xId });
  await waitFor(() => a.core.group.roleOf('botsHome') === xId && x.core.group.roleOf('botsHome') === xId, 10000);
  a.core.contacts.groupLink.sweep(true);
  await waitFor(() => moves.length >= 1 && contactsBot(x.core) !== null, 10000);
  await Bun.sleep(500);
  // Both hold it for now: A has not finished its half, so it must try again.
  expect(contactsBot(a.core)?.agentId).toBe(agentId);
  // The next sweep sends the same move: X answers with the bot it made and A lets its copy go.
  await waitFor(() => sweep() && contactsBot(a.core) === null, 20000);
  expect(new Set(moves)).toEqual(new Set([botMoveId(a.core.group.roster!.botsHomeRev!, xId)]));
  expect(contactsBot(x.core)?.agentId).toBe(agentId);
  expect(x.core.workforce.records.list('profile').filter(profile => profile.builtin === 'contacts' && profile.status !== 'archived')).toHaveLength(1);
  expect(a.core.workforce.records.find('profile', agentId)).toBeNull();
  expect(a.core.journal.getThread(threadId)?.archived).toBe(true);
  expect(a.core.workforce.moves.unfinished(botMoveId(a.core.group.roster!.botsHomeRev!, xId))).toBe(false);
}, 60_000);
