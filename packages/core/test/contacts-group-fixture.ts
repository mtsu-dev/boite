import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentLetter } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';

/* A group "Team" of A and X and a contact C of A, shared by the group-link suites. */

export async function project(harness: TestCore, client: CoreClient, name: string): Promise<{ id: string }> {
  const path = join(harness.dataDir, 'projects', name);
  mkdirSync(path, { recursive: true });
  return client.call('projects.add', { path, name });
}

export async function thread(client: CoreClient, projectId: string, title: string): Promise<string> {
  const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo');
  if (!account) throw new Error('no echo account');
  return (await client.call('threads.create', { projectId, providerId: 'echo', accountId: account.id, title })).id;
}

export const letters = (harness: TestCore, threadId: string): AgentLetter[] => harness.core.coordination.get(threadId).messages;

/** Every core of a test runs on one machine: each gets its own host name, so a leak can be told apart. */
export function named(harness: TestCore, hostname: string): void {
  const real = harness.core.info.bind(harness.core);
  harness.core.info = () => ({ ...real(), hostname });
}

/** What the contact keeps of this owner, as one text: its records, requests, relations and letters. */
export function storedBy(harness: TestCore): string {
  const settings = ['contacts', 'contacts:requests', 'contacts:relations', 'contacts:recent'].map(key => harness.core.journal.getSetting(key) ?? null);
  const rows = harness.core.journal.db.query('SELECT data FROM coordination_letters').all() as { data: string }[];
  return JSON.stringify([settings, rows.map(row => row.data)]);
}

/** A group "Team" of A and X, and a contact C that joined A. No Bots host yet. */
export async function setup(cores: TestCore[]) {
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

export async function botsHome(a: TestCore, client: CoreClient, x: TestCore, xId: string): Promise<void> {
  await client.call('group.botsHome', { coreId: xId });
  await waitFor(() => a.core.group.roleOf('botsHome') === xId && x.core.group.roleOf('botsHome') === xId, 10000);
  // The first hand may have reached X before X read the new roster: offered again now.
  a.core.contacts.groupLink.sweep(true);
}

export const remoteOn = (harness: TestCore, threadId: string): void => { harness.core.coordination.configure(threadId, { mode: 'brief', remote: true, resources: '', paused: false }); };
export const requestOn = (harness: TestCore, id: string) => harness.core.contacts.requests.list().find(request => request.id === id && request.direction === 'out');
