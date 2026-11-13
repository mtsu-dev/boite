import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ExperimentsPage from './ExperimentsPage.svelte';
import { BUILD_STORAGE_KEY, DESKTOP_STORAGE_KEY, EXPERIMENTS_STORAGE_KEY, followDesktopOf, heardBuild, heardDesktop, isExperimentEnabled, readExperiments, setExperiment, subscribeExperiments, writeExperiments } from '../lib/experiments';
import { experimentsShown } from '../lib/experiments.svelte';
import { navOf, desktopPage, phonePage } from '../lib/settings-tabs';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { strings } from '../lib/strings';
import { workspace } from '../lib/workspace.svelte';

let running: Record<string, unknown> | null = null;

beforeEach(() => {
  window.localStorage.clear();
});

/** A core that runs experiments (a source build) and one that does not (a Release). */
const NIGHTLY = '2.0.0-nightly.20261111.1';
const RELEASE = '2.0.0';
const FINISHED = ['theme-grain', 'session-import', 'prompt-cache', 'resident-agents', 'recording-indicators', 'pinned-quotas'];

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

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

test('on a Nightly the page lists exactly the five experiments, and a toggle writes the chosen ids', async () => {
  primarySays(NIGHTLY);
  running = mount(ExperimentsPage, { target: document.body });
  flushSync();
  await tick();

  // The page says these are unfinished before it offers anything.
  expect(query('[data-testid=experiments-page] > header h1').textContent?.trim()).toBe('Experiments');
  query<HTMLButtonElement>('[data-testid=experiments-page] > header [data-testid=info-tip]').click();
  flushSync();
  expect(query('[data-testid=info-tip-text]').textContent).toContain('unfinished');

  expect([...document.querySelectorAll('[data-testid^=experiment-]')].map((node) => node.getAttribute('data-testid'))).toEqual(
    ['whip', 'contacts', 'auto-goal', 'teams', 'debates'].map((id) => `experiment-${id}`));
  // A finished feature is on in every build and has no switch; graduated features have theirs in the page they belong to.
  for (const id of [...FINISHED, 'chat-artifacts', 'open-chat-links', 'preview-comments', 'edge-scrollbars', 'press-preload', 'goal2']) {
    expect(document.querySelector(`[data-testid=experiment-${id}]`)).toBeNull();
  }

  const whip = query<HTMLInputElement>('[data-testid=experiment-whip]');
  expect(whip.checked).toBe(false);
  expect(whip.closest('label')?.textContent).toContain('Whip');
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBeNull();
  const help = whip.closest('label')!.querySelector<HTMLButtonElement>('[data-testid=info-tip]')!;
  help.click();
  flushSync();
  expect(document.getElementById(help.getAttribute('aria-describedby')!)?.textContent).toContain('pointer');
  expect(whip.checked).toBe(false);

  whip.click();
  flushSync();
  await tick();
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["whip"]');
  expect(query<HTMLInputElement>('[data-testid=experiment-whip]').checked).toBe(true);

  query<HTMLInputElement>('[data-testid=experiment-whip]').click();
  flushSync();
  await tick();
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('[]');
  expect(query<HTMLInputElement>('[data-testid=experiment-whip]').checked).toBe(false);
});

test('with empty storage every finished feature is on, and none of them can be switched', () => {
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBeNull();
  expect(isExperimentEnabled('resident-agents')).toBe(true);
  expect([...readExperiments()].sort()).toEqual([...FINISHED].sort());
  // No switch, so no flip: nothing is stored and Bots stays on.
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBeNull();
  expect(isExperimentEnabled('resident-agents')).toBe(true);
  // On a Release too.
  primarySays(RELEASE);
  for (const id of FINISHED) expect(readExperiments()).toContain(id);
});

test('on a Release no experiment is on though storage holds it, Settings has no Experiments page, and a switch is refused', () => {
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["whip","teams"]');
  primarySays(RELEASE);
  expect(isExperimentEnabled('whip')).toBe(false);
  expect(isExperimentEnabled('teams')).toBe(false);
  expect(experimentsShown()).toBe(false);
  // The tab is absent from the nav, desktop and phone, and a route to it lands on the first page.
  expect(navOf('advanced', true)).not.toContain('experiments');
  expect(desktopPage('experiments', true)).toBe('general');
  expect(phonePage('experiments', null, true)).toBe('home');
  setExperiment('debates', true);
  setExperiment('whip', false);
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["whip","teams"]');
  // The page, were it drawn, lists nothing.
  running = mount(ExperimentsPage, { target: document.body });
  flushSync();
  expect(document.querySelectorAll('[data-testid^=experiment-]').length).toBe(0);
});

test('a Release primary heard after a Nightly one turns the switches off without erasing the stored choice', async () => {
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["whip","debates"]');
  const owner = primarySays(NIGHTLY);
  const heard: string[][] = [];
  onTestFinished(subscribeExperiments((enabled) => { heard.push(enabled); }));
  expect([isExperimentEnabled('whip'), isExperimentEnabled('debates'), experimentsShown()]).toEqual([true, true, true]);
  expect(navOf('advanced', true)).toContain('experiments');

  // Another machine's core is not the one that decides.
  heardBuild({}, RELEASE);
  expect(isExperimentEnabled('whip')).toBe(true);

  heardBuild(owner, RELEASE);
  flushSync();
  expect([isExperimentEnabled('whip'), isExperimentEnabled('debates'), experimentsShown()]).toEqual([false, false, false]);
  expect(heard.at(-1)).not.toContain('whip');
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["whip","debates"]');
  // The version is kept for the next load.
  expect(window.localStorage.getItem(BUILD_STORAGE_KEY)).toBe(RELEASE);

  // Back on a Nightly, the device finds its switches as it left them.
  heardBuild(owner, NIGHTLY);
  flushSync();
  expect([isExperimentEnabled('whip'), isExperimentEnabled('debates'), experimentsShown()]).toEqual([true, true, true]);
});

test('a stored list that still names goal2 loads the rest and drops it on the next save', async () => {
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["goal2","debates"]');
  running = mount(ExperimentsPage, { target: document.body });
  flushSync();
  await tick();
  expect(query<HTMLInputElement>('[data-testid=experiment-debates]').checked).toBe(true);
  query<HTMLInputElement>('[data-testid=experiment-whip]').click();
  flushSync();
  await tick();
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["whip","debates"]');
});

test('a click on a row name flips its switch, the "i" beside it only opens the tip', async () => {
  running = mount(ExperimentsPage, { target: document.body });
  flushSync();
  await tick();

  const whip = query<HTMLInputElement>('[data-testid=experiment-whip]');
  const row = whip.closest('label')!;
  // The switch is named by its title alone, not by the button's label too.
  expect(document.getElementById(whip.getAttribute('aria-labelledby')!)?.textContent).toBe('Whip');

  row.querySelector<HTMLButtonElement>('[data-testid=info-tip]')!.click();
  flushSync();
  expect(whip.checked).toBe(false);
  expect(query('[data-testid=info-tip-text]').textContent).toBeTruthy();

  document.getElementById(whip.getAttribute('aria-labelledby')!)!.click();
  flushSync();
  await tick();
  expect(whip.checked).toBe(true);
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["whip"]');
});

test('the owner turns the live device stream and background compaction on; a paired device does not see the switches, nor does a Release machine', async () => {
  const saved: unknown[] = [];
  const store = { owner: true, core: { version: NIGHTLY }, settings: { deviceStream: false, backgroundCompaction: false }, providers: [], accountsOf: () => [], modelsOf: () => [], saveSettings: async (patch: unknown) => { saved.push(patch); return true; } } as unknown as Store;
  running = mount(ExperimentsPage, { target: document.body, props: { store } });
  flushSync();
  await tick();
  for (const id of ['device-stream-on', 'background-compaction-on']) {
    const toggle = query<HTMLInputElement>(`[data-testid=${id}]`);
    expect(toggle.checked).toBe(false);
    toggle.click();
    flushSync();
    await tick();
  }
  expect(saved).toEqual([{ deviceStream: true }, { backgroundCompaction: true }]);
  unmount(running);
  running = mount(ExperimentsPage, { target: document.body, props: { store: { ...store, owner: false } as unknown as Store } });
  flushSync();
  await tick();
  expect(document.querySelector('[data-testid=device-stream-settings]')).toBeNull();
  expect(document.querySelector('[data-testid=background-compaction-settings]')).toBeNull();
  // The machine's own experiments are absent where its core is a Release, the owner's included.
  unmount(running);
  running = mount(ExperimentsPage, { target: document.body, props: { store: { ...store, core: { version: RELEASE } } as unknown as Store } });
  flushSync();
  await tick();
  expect(document.querySelector('[data-testid=device-stream-on]')).toBeNull();
  expect(document.querySelector('[data-testid=background-compaction-on]')).toBeNull();
  expect(document.querySelector('[data-testid=cache-keepalive-settings]')).toBeNull();
});
test('a phone keeps the switches its desktop app chose through a Release, and has them again on a Nightly before any new report', async () => {
  const client = new FakeClient({ delayMs: 0, version: RELEASE });
  const store = new Store();
  followDesktopOf(store);
  onTestFinished(() => { followDesktopOf(null); store.detach(); client.close(); });
  // The Release core passes the desktop app's list on as chosen, not cut down to what it runs.
  client.reportDesktopExperiments(['whip', 'teams']);
  store.attach(client);
  await store.connect();
  for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); }
  expect(JSON.parse(window.localStorage.getItem(DESKTOP_STORAGE_KEY)!).experiments).toEqual(['whip', 'teams']);
  expect(readExperiments()).toEqual(FINISHED);
  // The machine goes back to a Nightly: the hello alone brings the followed switches back.
  heardBuild(store, NIGHTLY);
  expect([isExperimentEnabled('whip'), isExperimentEnabled('teams'), isExperimentEnabled('debates')]).toEqual([true, true, false]);
});

test('a phone has the desktop app\'s experiments until it flips one of its own, and can follow again', async () => {
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["teams"]');
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store();
  followDesktopOf(store);
  onTestFinished(() => { followDesktopOf(null); store.detach(); client.close(); });
  client.reportDesktopExperiments(['debates']);
  store.attach(client);
  await store.connect();
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); } };
  await settle();
  running = mount(ExperimentsPage, { target: document.body });
  await settle();
  const on = (id: string) => query<HTMLInputElement>(`[data-testid=experiment-${id}]`).checked;

  // The report's answer names the desktop app's switches; this phone's own wait underneath.
  expect(query<HTMLInputElement>('[data-testid=experiments-follow]').checked).toBe(true);
  expect([on('debates'), on('teams')]).toEqual([true, false]);
  expect(isExperimentEnabled('debates')).toBe(true);
  // A flip on the desktop reaches the open page.
  client.reportDesktopExperiments(['debates', 'whip']);
  await settle();
  expect(on('whip')).toBe(true);
  // A second machine's desktop app is not the one followed.
  heardDesktop(new Store(), ['contacts']);
  expect(isExperimentEnabled('contacts')).toBe(false);

  // A flip here keeps what was shown, with it, as this phone's own.
  query<HTMLInputElement>('[data-testid=experiment-teams]').click();
  await settle();
  expect(query<HTMLInputElement>('[data-testid=experiments-follow]').checked).toBe(false);
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["whip","teams","debates"]');
  client.reportDesktopExperiments(['contacts']);
  await settle();
  expect([on('contacts'), on('whip')]).toEqual([false, true]);

  query<HTMLInputElement>('[data-testid=experiments-follow]').click();
  await settle();
  expect([on('contacts'), on('whip'), on('teams')]).toEqual([true, false, false]);
});

test('a core that has heard no desktop app keeps its own set, not another machine\'s', () => {
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '["whip"]');
  const owner = {};
  followDesktopOf(owner);
  onTestFinished(() => followDesktopOf(null));
  heardDesktop(owner, ['contacts'], 'core-a');
  heardDesktop(owner, null, 'core-a');
  expect(isExperimentEnabled('contacts')).toBe(true);
  heardDesktop(owner, null, 'core-b');
  expect([isExperimentEnabled('contacts'), isExperimentEnabled('whip')]).toEqual([false, true]);
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
  expect(query<HTMLInputElement>('[data-testid=experiment-whip]').checked).toBe(false);
});
test('Automatic goals is off by default; on, its threshold row sits under the switch and saves a valid length', async () => {
  const saved: unknown[] = [];
  const store = { owner: true, core: { version: NIGHTLY }, settings: {}, providers: [], accountsOf: () => [], modelsOf: () => [], saveSettings: async (patch: unknown) => { saved.push(patch); return true; } } as unknown as Store;
  running = mount(ExperimentsPage, { target: document.body, props: { store } });
  flushSync();
  await tick();
  const toggle = query<HTMLInputElement>('[data-testid=experiment-auto-goal]');
  expect(toggle.checked).toBe(false);
  expect(toggle.closest('label')?.textContent).toContain('Automatic goals');
  expect(document.querySelector('[data-testid=auto-goal-settings]')).toBeNull();

  toggle.click();
  flushSync();
  await tick();
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBe('["auto-goal"]');
  const row = query('[data-testid=auto-goal-settings]');
  expect(toggle.closest('label')!.nextElementSibling).toBe(row);
  const field = query<HTMLInputElement>('[data-testid=auto-goal-min-chars]');
  expect(field.value).toBe('1500');
  expect(row.textContent).toContain('Prompt length');

  field.value = '150';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
  await tick();
  expect(query('[data-testid=auto-goal-min-chars-error]').textContent).toContain('200 to 20000');
  expect(saved).toEqual([]);

  field.value = '800';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
  await tick();
  expect(saved).toEqual([{ autoGoalMinChars: 800 }]);

  // A paired device has the switch, never the core's threshold.
  unmount(running);
  running = mount(ExperimentsPage, { target: document.body, props: { store: { ...store, owner: false } as unknown as Store } });
  flushSync();
  await tick();
  expect(query<HTMLInputElement>('[data-testid=experiment-auto-goal]').checked).toBe(true);
  expect(document.querySelector('[data-testid=auto-goal-settings]')).toBeNull();
});

test('Contacts and Teams wait on nothing: Bots is always on, and Contacts is made with the Operator', async () => {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store();
  store.attach(client);
  await store.connect();
  onTestFinished(() => { store.detach(); client.close(); });
  running = mount(ExperimentsPage, { target: document.body, props: { store } });
  flushSync();
  const contacts = () => query<HTMLInputElement>('[data-testid=experiment-contacts]');
  const teams = () => query<HTMLInputElement>('[data-testid=experiment-teams]');

  expect(isExperimentEnabled('resident-agents')).toBe(true);
  expect([contacts().disabled, contacts().getAttribute('aria-disabled'), teams().disabled]).toEqual([false, null, false]);
  const help = contacts().closest('label')!.querySelector<HTMLButtonElement>('[data-testid=info-tip]')!;
  help.click();
  flushSync();
  expect(document.getElementById(help.getAttribute('aria-describedby')!)?.textContent).toBe(strings.experiments.contacts.hint);

  teams().click();
  flushSync();
  expect(isExperimentEnabled('teams')).toBe(true);
  expect((await client.call('contacts.get', {})).bot).toBeNull();
  const call = vi.spyOn(client, 'call');
  contacts().click();
  flushSync();
  // On, the group's one Operator is made, named in the app's language.
  await vi.waitFor(async () => expect((await client.call('contacts.get', {})).bot).not.toBeNull());
  expect(call.mock.calls.filter(([method]) => method === 'agents.builtin.ensure').map(([, params]) => params)).toEqual([{ kind: 'contacts', name: strings.agents.builtin.name.contacts }]);
  expect(isExperimentEnabled('contacts')).toBe(true);
});

test('turning Contacts on makes nothing when a machine of the group has the Operator, and a failure is told with the switch left on', async () => {
  const [home, other] = [new FakeClient({ delayMs: 0, coreId: 'core-home' }), new FakeClient({ delayMs: 0, coreId: 'core-other' })];
  const stores = [new Store(), new Store()];
  for (const [i, client] of [home, other].entries()) { stores[i]!.attach(client); await stores[i]!.connect(); }
  onTestFinished(() => { for (const store of stores) store.detach(); home.close(); other.close(); workspace.machines = []; });
  workspace.machines = [{ id: 'home', label: 'Home', store: stores[0]! }, { id: 'other', label: 'Other', store: stores[1]! }];
  await other.call('agents.builtin.ensure', { kind: 'contacts' });
  running = mount(ExperimentsPage, { target: document.body, props: { store: stores[0] } });
  flushSync();
  const ensured = vi.spyOn(home, 'call');
  query<HTMLInputElement>('[data-testid=experiment-contacts]').click();
  await vi.waitFor(() => expect(ensured.mock.calls.some(([method]) => method === 'contacts.get')).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 20));
  // One Operator for the whole group: the other machine has it, this one makes none.
  expect(ensured.mock.calls.some(([method]) => method === 'agents.builtin.ensure')).toBe(false);
  expect((await home.call('contacts.get', {})).bot).toBeNull();

  // Nobody has one and the core refuses: the error is told and the switch stays on.
  unmount(running!, { outro: false });
  running = null;
  document.body.innerHTML = '';
  workspace.machines = [];
  window.localStorage.setItem(EXPERIMENTS_STORAGE_KEY, '[]');
  ensured.mockRestore();
  const real = home.call.bind(home);
  vi.spyOn(home, 'call').mockImplementation(async (method, params) => {
    if (method === 'agents.builtin.ensure') throw new Error('selection: no signed-in account on this machine to run the bot');
    return real(method, params);
  });
  running = mount(ExperimentsPage, { target: document.body, props: { store: stores[0] } });
  flushSync();
  query<HTMLInputElement>('[data-testid=experiment-contacts]').click();
  await vi.waitFor(() => expect(stores[0]!.error).toContain('no signed-in account'));
  flushSync();
  expect([isExperimentEnabled('contacts'), query<HTMLInputElement>('[data-testid=experiment-contacts]').checked]).toEqual([true, true]);
});
