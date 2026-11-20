import { afterEach, beforeEach, expect, onTestFinished, test } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { EXPERIMENT_IDS } from '@boite/contracts';
import ExperimentsPage from './ExperimentsPage.svelte';
import { DESKTOP_STORAGE_KEY, EXPERIMENTS_STORAGE_KEY, chosenExperiments, desktopHeard, followDesktopOf, heardBuild, heardDesktop, readExperiments, setExperiment, writeExperiments } from '../lib/experiments';
import { experimentsShown } from '../lib/experiments.svelte';
import { navOf, desktopPage, phonePage } from '../lib/settings-tabs';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';

let running: Record<string, unknown> | null = null;

beforeEach(() => {
  window.localStorage.clear();
});

/** A core that runs experiments (a Nightly) and one that does not (a Release). */
const NIGHTLY = '2.0.0-nightly.20261111.1';
const RELEASE = '2.0.0';
/** Every feature is finished: each is in force in every build. */
const ALL = [...EXPERIMENT_IDS];

/** The primary machine's core says its version, as a hello does. */
function primarySays(version: string): object {
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardBuild(owner, version);
  return owner;
}

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  window.localStorage.clear();
  // Through the writer, so the reactive mirror forgets the build a test named.
  writeExperiments([]);
  window.localStorage.clear();
});

test('every feature is on in every build whatever storage holds, and with no switch to list no build has an Experiments page', async () => {
  expect(readExperiments()).toEqual(ALL);
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["goal2","whip"]');
  for (const version of [NIGHTLY, RELEASE]) {
    primarySays(version);
    expect(readExperiments(), version).toEqual(ALL);
    expect(experimentsShown(), version).toBe(false);
    // The tab is absent from the nav, desktop and phone, and a route to it lands on Home.
    expect(navOf('advanced', true), version).not.toContain('experiments');
    expect(desktopPage('experiments', true), version).toBe('home');
    expect(phonePage('experiments', null, true), version).toBe('home');
  }
  // A flip from an old path is stored for a later experiment and changes nothing in force.
  setExperiment('debates', false);
  expect(readExperiments()).toEqual(ALL);
  // The page, were it drawn, lists nothing.
  running = mount(ExperimentsPage, { target: document.body });
  flushSync();
  await tick();
  expect(document.querySelectorAll('[data-testid^=experiment-]').length).toBe(0);
});

test('a phone keeps the list its desktop app chose and has every feature, before and after a new report', async () => {
  const client = new FakeClient({ delayMs: 0, version: RELEASE });
  const store = new Store();
  followDesktopOf(store);
  onTestFinished(() => { followDesktopOf(null); store.detach(); client.close(); });
  // The core says both: the list in force, as an app from before the stages reads it, and the list as chosen beside it.
  client.reportDesktopExperiments(['whip', 'teams']);
  store.attach(client);
  await store.connect();
  for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); }
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual(['whip', 'teams']);
  expect(readExperiments()).toEqual(ALL);
  expect(await client.call('client.preferences', { app: 'app-old-0001', language: 'en', experiments: [], labels: {} })).toEqual({ ok: true, desktop: ALL, desktopChosen: ['whip', 'teams'] });
  const said: unknown[] = [];
  client.on('client.desktopExperiments', (payload) => said.push(payload));
  client.reportDesktopExperiments(['whip', 'teams']);
  for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); }
  expect(said).toEqual([{ experiments: ALL, chosen: ['whip', 'teams'] }]);
  expect(chosenExperiments()).toEqual(['whip', 'teams']);
  heardBuild(store, NIGHTLY);
  expect(readExperiments()).toEqual(ALL);
});

test('the followed cache keeps the chosen list a new core sends, and the historic list of a core from before it', () => {
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardBuild(owner, RELEASE);
  heardDesktop(owner, desktopHeard({ experiments: ALL, chosen: ['whip', 'teams'] }), 'core-a');
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual(['whip', 'teams']);
  // A core from before the separate field says one list only: that one is kept.
  heardDesktop(owner, desktopHeard({ experiments: ['debates'] }), 'core-a');
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual(['debates']);
  expect(desktopHeard({ desktop: null })).toBeNull();
  expect(desktopHeard({ desktop: ['teams'], desktopChosen: ['teams', 'whip'] })).toEqual(['teams', 'whip']);
});

test('a core that has heard no desktop app keeps its own set, not another machine\'s', () => {
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["whip"]');
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardDesktop(owner, ['contacts'], 'core-a');
  heardDesktop(owner, null, 'core-a');
  expect(chosenExperiments()).toEqual(['contacts']);
  heardDesktop(owner, null, 'core-b');
  expect(chosenExperiments()).toEqual(['whip']);
});

test('the desktop app follows no one', async () => {
  const shell = window as unknown as { __TAURI_INTERNALS__?: unknown };
  shell.__TAURI_INTERNALS__ = {};
  onTestFinished(() => { delete shell.__TAURI_INTERNALS__; followDesktopOf(null); });
  const owner = {};
  followDesktopOf(owner);
  heardDesktop(owner, ['whip']);
  running = mount(ExperimentsPage, { target: document.body });
  flushSync();
  await tick();
  expect(document.querySelector('[data-testid=experiments-follow]')).toBeNull();
  expect(chosenExperiments()).toEqual([]);
});
