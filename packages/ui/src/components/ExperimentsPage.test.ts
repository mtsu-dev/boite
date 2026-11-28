import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { EXPERIMENT_IDS, EXPERIMENT_STAGES, isSettingExperiment, listedExperiments, withFinished } from '@boite/contracts';
import ExperimentsPage from './ExperimentsPage.svelte';
import SettingsShell from './SettingsShell.svelte';
import { DESKTOP_STORAGE_KEY, EXPERIMENTS_STORAGE_KEY, chosenExperiments, desktopHeard, followDesktopOf, heardBuild, heardDesktop, isExperimentEnabled, readExperiments, setExperiment, writeExperiments } from '../lib/experiments';
import { experimentOn, experimentsShown } from '../lib/experiments.svelte';
import { navOf, desktopPage, phonePage } from '../lib/settings-tabs';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { strings } from '../lib/strings';

let running: Record<string, unknown> | null = null;

beforeEach(() => {
  window.localStorage.clear();
});

/** A core that runs experiments (a Nightly) and one that does not (a Release). */
const NIGHTLY = '2.0.0-nightly.20261111.1';
const RELEASE = '2.0.0';
const ALL = [...EXPERIMENT_IDS];
const APP = ALL.filter(id => !isSettingExperiment(id));
/** The finished features: each is in force in every build. */
const FINISHED = EXPERIMENT_IDS.filter((id) => EXPERIMENT_STAGES[id] === 'release');

test('desktop and phone hide experimental settings in Release and offer them on the Nightly Experiments page', async () => {
  const ids = ['contacts', 'auto-goal', 'background-compaction', 'device-stream'];
  // The per-type background switch stays in Advanced (checked below); the rows here left General and Advanced.
  const oldRows = ['setting-contacts', 'setting-auto-goals', 'auto-goal-min-chars', 'device-stream-on'];
  const get = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); } };
  onTestFinished(() => { vi.unstubAllGlobals(); });
  Element.prototype.scrollIntoView ??= vi.fn();
  for (const version of [RELEASE, NIGHTLY]) {
    for (const phone of [false, true]) {
      vi.stubGlobal('matchMedia', (media: string) => Object.assign(new EventTarget(), {
        media, matches: phone && media.includes('max-width: 720px'), onchange: null, addListener() {}, removeListener() {},
      }));
      const client = new FakeClient({ delayMs: 0, version });
      const store = new Store();
      try {
        followDesktopOf(store);
        store.attach(client);
        await store.connect();
        running = mount(SettingsShell, { target: document.body, props: { store } });
        await settle();
        expect(!!get('settings-tab-experiments')).toBe(version === NIGHTLY);
        for (const section of ['agent-replies', 'auto-compact']) {
          store.showSettings(section === 'agent-replies' ? 'general' : 'advanced', section);
          await settle();
          for (const id of oldRows) expect(get(id), `${version} ${phone ? 'phone' : 'desktop'} ${id}`).toBeNull();
        }
        get('compaction-target-agent')!.click();
        await vi.waitFor(() => expect(get('compaction-customize')).not.toBeNull());
        expect(!!get('background-compaction-on')).toBe(version === NIGHTLY);
        store.showSettings('experiments');
        await settle();
        if (version === RELEASE) expect(get('experiments-page')).toBeNull();
        else {
          for (const id of ids) expect(get(`experiment-${id}`)).not.toBeNull();
          setExperiment('auto-goal', true);
          expect(isExperimentEnabled('auto-goal')).toBe(false);
          get<HTMLInputElement>('experiment-auto-goal')!.click();
          await vi.waitFor(() => expect(get('auto-goal-min-chars')).not.toBeNull());
          expect(await client.call('settings.get', {})).toMatchObject({ autoGoals: true });
          expect(experimentOn('auto-goal')).toBe(true);
          const contacts = get<HTMLInputElement>('experiment-contacts')!;
          for (const on of [true, false]) {
            contacts.click();
            await vi.waitFor(() => expect(store.settings?.contacts).toBe(on));
          }
          // With automatic goals on, their threshold shows on Experiments and still not in General.
          store.showSettings('general', 'agent-replies');
          await settle();
          for (const id of ['setting-auto-goals', 'auto-goal-min-chars']) expect(get(id), `${phone ? 'phone' : 'desktop'} ${id} on`).toBeNull();
        }
      } finally {
        if (running) await unmount(running, { outro: false });
        running = null;
        store.detach();
        client.close();
        followDesktopOf(null);
      }
    }
  }
});

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

test('a finished feature is on in every build and experiments have their switches from a Nightly up', async () => {
  expect(readExperiments()).toEqual(FINISHED);
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["goal2","whip","draft-backdrop","discord-presence"]');
  primarySays(RELEASE);
  expect(readExperiments()).toEqual(FINISHED);
  expect(experimentsShown()).toBe(false);
  // The tab is absent from the nav, desktop and phone, and a route to it lands on Home.
  expect(navOf('advanced', true)).not.toContain('experiments');
  expect(desktopPage('experiments', true)).toBe('home');
  expect(phonePage('experiments', null, true)).toBe('home');
  // A Release has no switch to flip: the stored choice stays as it was.
  setExperiment('draft-backdrop', false);
  expect(chosenExperiments()).toEqual(['draft-backdrop', 'discord-presence']);

  // The same device on a Nightly finds its switch as it left it.
  primarySays(NIGHTLY);
  expect(readExperiments()).toEqual([...FINISHED, 'draft-backdrop', 'discord-presence']);
  expect(experimentsShown()).toBe(true);
  expect(navOf('advanced', true)).toContain('experiments');
  expect(desktopPage('experiments', true)).toBe('experiments');
  // A finished feature has no switch, on any build.
  setExperiment('resident-agents', false);
  expect(readExperiments()).toEqual([...FINISHED, 'draft-backdrop', 'discord-presence']);

  running = mount(ExperimentsPage, { target: document.body, props: { store: new Store() } });
  flushSync();
  await tick();
  const switches = () => [...document.querySelectorAll<HTMLInputElement>('input[data-testid^=experiment-]')];
  expect(switches().map((node) => node.dataset['testid']).sort()).toEqual(listedExperiments(NIGHTLY).map(id => `experiment-${id}`).sort());
  const backdrop = () => document.querySelector<HTMLInputElement>('input[data-testid=experiment-draft-backdrop]')!;
  expect(backdrop().checked).toBe(true);
  expect(backdrop().closest('label')?.textContent).toContain(strings.experiments['draft-backdrop'].title);
  // The rich presence's switch, on, has its preview under it, fetched on demand: idle with no agent at work.
  await vi.waitFor(() => expect(document.querySelector('[data-testid=presence-details]')?.textContent).toBe(strings.presence.idle));
  backdrop().click();
  flushSync();
  await tick();
  expect(backdrop().checked).toBe(false);
  expect(readExperiments()).toEqual([...FINISHED, 'discord-presence']);
});

test('a phone keeps the list its desktop app chose, and has the experiment of it once its core runs experiments', async () => {
  const client = new FakeClient({ delayMs: 0, version: RELEASE });
  const store = new Store();
  followDesktopOf(store);
  onTestFinished(() => { followDesktopOf(null); store.detach(); client.close(); });
  // The core says both: the list in force, as an app from before the stages reads it, and the list as chosen beside it.
  client.reportDesktopExperiments(ALL);
  store.attach(client);
  await store.connect();
  for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); }
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual(ALL);
  // A Release core cuts the experiment from what is in force, never from what was chosen.
  expect(readExperiments()).toEqual(FINISHED);
  expect(await client.call('client.preferences', { app: 'app-old-0001', language: 'en', experiments: [], labels: {} })).toEqual({ ok: true, desktop: withFinished(FINISHED), desktopChosen: withFinished(ALL) });
  const said: unknown[] = [];
  client.on('client.desktopExperiments', (payload) => said.push(payload));
  client.reportDesktopExperiments(ALL);
  for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); }
  // Both lists also name the finished ids, for a phone older than the core; this app keeps only the ones it knows.
  expect(said).toEqual([{ experiments: withFinished(FINISHED), chosen: withFinished(ALL) }]);
  expect(chosenExperiments()).toEqual(APP);
  heardBuild(store, NIGHTLY);
  expect(readExperiments()).toEqual(APP);
});

test('the followed cache keeps the chosen list a new core sends, and the historic list of a core from before it', () => {
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardBuild(owner, RELEASE);
  heardDesktop(owner, desktopHeard({ experiments: ALL, chosen: ['resident-agents'] }), 'core-a');
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual(['resident-agents']);
  // A core from before the separate field says one list only: that one is kept.
  heardDesktop(owner, desktopHeard({ experiments: [] }), 'core-a');
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual([]);
  expect(desktopHeard({ desktop: null })).toBeNull();
  expect(desktopHeard({ desktop: ALL, desktopChosen: [] })).toEqual([]);
});

test('a core that has heard no desktop app keeps its own set, not another machine\'s', () => {
  // An id since finished and removed is dropped from what storage holds.
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["whip", "resident-agents"]');
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardDesktop(owner, [], 'core-a');
  heardDesktop(owner, null, 'core-a');
  expect(chosenExperiments()).toEqual([]);
  heardDesktop(owner, null, 'core-b');
  expect(chosenExperiments()).toEqual(['resident-agents']);
});

test('the desktop app follows no one', async () => {
  const shell = window as unknown as { __TAURI_INTERNALS__?: unknown };
  shell.__TAURI_INTERNALS__ = {};
  onTestFinished(() => { delete shell.__TAURI_INTERNALS__; followDesktopOf(null); });
  const owner = {};
  followDesktopOf(owner);
  heardDesktop(owner, ['resident-agents']);
  running = mount(ExperimentsPage, { target: document.body, props: { store: new Store() } });
  flushSync();
  await tick();
  expect(document.querySelector('[data-testid=experiments-follow]')).toBeNull();
  expect(chosenExperiments()).toEqual([]);
});
