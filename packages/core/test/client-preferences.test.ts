import { afterEach, beforeEach, expect, test } from 'bun:test';
import { effectiveExperiments, withFinished, type ClientPreferences, type ExperimentId, type FinishedExperimentId, type SentFrom } from '@boite/contracts';
import { connect, type CoreClient } from '../src/client.ts';
import { ClientPreferencesBook } from '../src/client-preferences.ts';
import type { Connection } from '../src/router.ts';
import { startTestCore, type TestCore } from './harness.ts';

const report = (experiments: ExperimentId[], app = 'app-0000-0001'): ClientPreferences => ({ app, language: 'en', experiments, labels: {} });
const NIGHTLY = '2.0.0-nightly.20261111.1';
/** What a Nightly core reads from these switches: the finished features, then the experiments chosen. */
const on = (...chosen: ExperimentId[]): ExperimentId[] => effectiveExperiments(chosen, NIGHTLY);
type Told = ExperimentId | FinishedExperimentId;

test('phones follow the desktop app on this machine before one reached from elsewhere, and hear only its changes', () => {
  const moves: { experiments: Told[]; chosen: Told[] }[] = [];
  const book = new ClientPreferencesBook(() => {}, moved => moves.push(moved), NIGHTLY);
  let next = 0;
  const socket = (sentFrom: SentFrom | null, remote: boolean, principal = 'owner') => ({ id: `c${next++}`, subscriptions: new Set(), identity: { principal, sessionId: null, threadId: null }, sentFrom, remote, sendEvent() {} }) as unknown as Connection;
  const phone = socket({ client: 'pwa', device: 'phone' }, true);
  const laptop = socket({ client: 'shell', device: 'laptop' }, true);
  const here = socket({ client: 'shell', device: 'pc' }, false);

  // A phone is no desktop app, nor is a paired device that calls itself one.
  book.report(phone, report(['resident-agents']));
  book.report(socket({ client: 'shell', device: 'paired' }, true, 'session'), report(['resident-agents'], 'app-paired-01'));
  expect(book.desktopExperiments()).toBeNull();
  // A desktop app from elsewhere stands in while this machine's has not reported.
  book.report(laptop, report([], 'app-laptop-01'));
  book.report(here, report(['resident-agents'], 'app-here-0001'));
  // Once this machine's has, another desktop app's flips no longer move what phones follow.
  book.report(laptop, report(['resident-agents'], 'app-laptop-01'));
  // The same switches again, as after a reconnect, say nothing.
  book.report(here, report(['resident-agents'], 'app-here-0001'));
  book.report(here, report([], 'app-here-0001'));
  // Each move carries the list an older app reads, in force here, and the switches as chosen for the apps that keep them.
  expect(moves).toEqual([
    { experiments: withFinished(on()), chosen: withFinished([]) },
    { experiments: withFinished(on('resident-agents')), chosen: withFinished(['resident-agents']) },
    { experiments: withFinished(on()), chosen: withFinished([]) },
  ]);
  expect(book.desktopChosen()).toEqual(withFinished([]));
  expect(book.desktopExperiments()).toEqual(withFinished(on()));
});

test('a Release core keeps every finished feature, whatever an app reports, and still names removed ids to an older phone', () => {
  const moves: { experiments: Told[]; chosen: Told[] }[] = [];
  const book = new ClientPreferencesBook(() => {}, moved => moves.push(moved), '2.0.0');
  const here = { id: 'c0', subscriptions: new Set(), identity: { principal: 'owner', sessionId: null, threadId: null }, sentFrom: { client: 'shell', device: 'pc' }, remote: false, sendEvent() {} } as unknown as Connection;
  // An older app still reports the five experiments that were finished and left the list.
  book.report(here, { ...report([]), experiments: ['whip', 'teams', 'debates', 'auto-goal', 'contacts'] });
  // The core's own reading keeps only the ids it knows.
  expect(book.current()!.experiments).toEqual(['resident-agents']);
  // A phone older than this core still gates Contacts and Teams on their ids, in both lists it reads: they stay named.
  const kept = book.desktopExperiments()!;
  expect(kept).toEqual(withFinished(['resident-agents']));
  expect(book.desktopChosen()).toEqual(expect.arrayContaining(['contacts', 'teams', 'debates', 'whip', 'auto-goal']));
  expect(moves).toEqual([{ experiments: kept, chosen: withFinished([]) }]);
});

let h: TestCore;
const clients: CoreClient[] = [];
beforeEach(async () => { h = await startTestCore(); });
afterEach(async () => { for (const client of clients.splice(0)) client.close(); await h.stop(); });

test('a phone hears the desktop app\'s experiments in its report\'s answer and on every flip', async () => {
  const as = async (name: string) => {
    const opened = await connect(h.url, h.token, { client: { version: 'test', name } });
    clients.push(opened);
    return opened;
  };
  const phone = await as('pwa');
  const desktop = await as('shell');
  expect(await phone.call('client.preferences', report([], 'app-phone-001'))).toEqual({ ok: true, desktop: null, desktopChosen: null });

  const heard = phone.next('client.desktopExperiments', ({ chosen }) => chosen?.includes('resident-agents') === true);
  await desktop.call('client.preferences', report(['resident-agents'], 'app-desktop-1'));
  expect(await heard).toEqual({ experiments: withFinished(effectiveExperiments(['resident-agents'], h.core.version)), chosen: withFinished(['resident-agents']) });
  expect(await phone.call('client.preferences', report([], 'app-phone-001'))).toEqual({ ok: true, desktop: withFinished(effectiveExperiments(['resident-agents'], h.core.version)), desktopChosen: withFinished(['resident-agents']) });
});
