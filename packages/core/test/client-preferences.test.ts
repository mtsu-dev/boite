import { afterEach, beforeEach, expect, test } from 'bun:test';
import { effectiveExperiments, type ClientPreferences, type ExperimentId, type SentFrom } from '@boite/contracts';
import { connect, type CoreClient } from '../src/client.ts';
import { ClientPreferencesBook } from '../src/client-preferences.ts';
import type { Connection } from '../src/router.ts';
import { startTestCore, type TestCore } from './harness.ts';

const report = (experiments: ExperimentId[], app = 'app-0000-0001'): ClientPreferences => ({ app, language: 'en', experiments, labels: {} });
const NIGHTLY = '2.0.0-nightly.20261111.1';
/** What a Nightly core reads from these switches: the finished features, then the experiments chosen. */
const on = (...chosen: ExperimentId[]): ExperimentId[] => effectiveExperiments(chosen, NIGHTLY);

test('phones follow the desktop app on this machine before one reached from elsewhere, and hear only its changes', () => {
  const moves: { experiments: ExperimentId[]; chosen: ExperimentId[] }[] = [];
  const book = new ClientPreferencesBook(() => {}, moved => moves.push(moved), NIGHTLY);
  let next = 0;
  const socket = (sentFrom: SentFrom | null, remote: boolean, principal = 'owner') => ({ id: `c${next++}`, subscriptions: new Set(), identity: { principal, sessionId: null, threadId: null }, sentFrom, remote, sendEvent() {} }) as unknown as Connection;
  const phone = socket({ client: 'pwa', device: 'phone' }, true);
  const laptop = socket({ client: 'shell', device: 'laptop' }, true);
  const here = socket({ client: 'shell', device: 'pc' }, false);

  // A phone is no desktop app, nor is a paired device that calls itself one.
  book.report(phone, report(['whip']));
  book.report(socket({ client: 'shell', device: 'paired' }, true, 'session'), report(['whip'], 'app-paired-01'));
  expect(book.desktopExperiments()).toBeNull();
  // A desktop app from elsewhere stands in while this machine's has not reported.
  book.report(laptop, report(['debates'], 'app-laptop-01'));
  book.report(here, report(['teams'], 'app-here-0001'));
  // Once this machine's has, another desktop app's flips no longer move what phones follow.
  book.report(laptop, report(['contacts'], 'app-laptop-01'));
  // The same switches again, as after a reconnect, say nothing.
  book.report(here, report(['teams'], 'app-here-0001'));
  book.report(here, report(['teams', 'whip'], 'app-here-0001'));
  // Each move carries the list an older app reads, in force here, and the switches as chosen for the apps that keep them.
  expect(moves).toEqual([
    { experiments: on('debates'), chosen: ['debates'] },
    { experiments: on('teams'), chosen: ['teams'] },
    { experiments: on('teams', 'whip'), chosen: ['whip', 'teams'] },
  ]);
  expect(book.desktopChosen()).toEqual(['whip', 'teams']);
  expect(book.desktopExperiments()).toEqual(on('teams', 'whip'));
});

test('a Release core keeps the finished features and no experiment, whatever an app reports, and passes on what the desktop app chose', () => {
  const moves: { experiments: ExperimentId[]; chosen: ExperimentId[] }[] = [];
  const book = new ClientPreferencesBook(() => {}, moved => moves.push(moved), '2.0.0');
  const here = { id: 'c0', subscriptions: new Set(), identity: { principal: 'owner', sessionId: null, threadId: null }, sentFrom: { client: 'shell', device: 'pc' }, remote: false, sendEvent() {} } as unknown as Connection;
  book.report(here, report(['whip', 'teams', 'debates', 'auto-goal', 'contacts']));
  const kept = book.desktopExperiments()!;
  expect(kept).toEqual(effectiveExperiments([], '2.0.0'));
  expect(kept).toContain('resident-agents');
  for (const id of ['whip', 'teams', 'debates', 'auto-goal', 'contacts'] as const) expect(kept).not.toContain(id);
  expect(book.current()!.experiments).toEqual(kept);
  // A phone that follows this desktop app keeps its choices for the day the machine runs a Nightly again.
  expect(book.desktopChosen()).toEqual(['whip', 'contacts', 'auto-goal', 'teams', 'debates']);
  // An app from before the stages reads `experiments` as what is on: it must never see an experiment a Release does not run.
  expect(moves).toEqual([{ experiments: kept, chosen: ['whip', 'contacts', 'auto-goal', 'teams', 'debates'] }]);
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

  const heard = phone.next('client.desktopExperiments', ({ experiments }) => experiments.includes('whip'));
  await desktop.call('client.preferences', report(['whip', 'teams'], 'app-desktop-1'));
  expect(await heard).toEqual({ experiments: effectiveExperiments(['whip', 'teams'], h.core.version), chosen: ['whip', 'teams'] });
  expect(await phone.call('client.preferences', report([], 'app-phone-001'))).toEqual({ ok: true, desktop: effectiveExperiments(['whip', 'teams'], h.core.version), desktopChosen: ['whip', 'teams'] });
});
