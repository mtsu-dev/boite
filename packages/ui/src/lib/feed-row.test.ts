import { expect, test } from 'vitest';
import type { PermissionRequest, ThreadSummary } from '@boite/contracts';
import { feedAsk, feedWhere } from './feed-row';

const id = (value: string) => value as ThreadSummary['id'];
const push = { id: 'p', threadId: 'push', toolName: 'Bash', input: { command: 'git push origin csv-import' }, description: null, createdAt: 0 } as unknown as PermissionRequest;

test('a held permission is asked by what it does, the composer\'s title; anything else by its reason unless that only names the place', () => {
  const owner = { pendingQuestions: [{ threadId: id('asks') }], pendingPermissions: [push, { ...push, threadId: id('asks') }] };
  expect(feedAsk(owner, id('push'), { reason: 'Wants to run:', place: 'orbit' })).toBe('Push csv-import');
  // A question waits first: its own words, never the permission behind it.
  expect(feedAsk(owner, id('asks'), { reason: 'Which retry policy?', place: 'orbit' })).toBe('Which retry policy?');
  // A failure whose reason is its project says nothing more than the place line.
  expect(feedAsk(owner, id('failed'), { reason: 'orbit', place: 'orbit' })).toBeNull();
});

test('the place line names the project, then the machine once there are several or while it is out of reach', () => {
  const machine = (connection: string) => ({ label: 'studio', store: { connection } });
  expect(feedWhere({ place: 'orbit', machine: machine('ready') }, false)).toEqual({ project: 'orbit', host: undefined, text: 'orbit' });
  expect(feedWhere({ place: 'orbit', machine: machine('ready') }, true)).toMatchObject({ project: 'orbit', host: { label: 'studio', away: false }, text: 'orbit on studio' });
  expect(feedWhere({ place: 'orbit', machine: machine('disconnected') }, false)).toMatchObject({ host: { away: true, state: 'offline' }, text: 'orbit on studio · Offline' });
});
