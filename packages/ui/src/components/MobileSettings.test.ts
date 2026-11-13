import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import App from '../App.svelte';
import { store } from '../lib/store.svelte';
import { closeTour } from '../lib/onboarding.svelte';
import { archiveThread } from '../lib/archive';
import type { FakeClient } from '../lib/fake-client';
import { workspace } from '../lib/workspace.svelte';
import { experimentOn } from '../lib/experiments.svelte';
import { strings } from '../lib/strings';

/** The phone's Settings on the map: the archive it can fill is a card of Conversations, two taps from the list. */

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn(async (_url: string) => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

let running: Record<string, unknown> | null = null;
// jsdom has no scrolling: a page opened on a card scrolls to it.
Element.prototype.scrollIntoView ??= vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  window.localStorage.clear();
});

async function waitFor(check: () => boolean, attempts = 2000): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`gave up waiting, body was:\n${document.body.textContent ?? ''}`);
}

function query<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

/** A phone-width window: only the layout query answers yes. */
function phoneWidth() {
  vi.stubGlobal('matchMedia', (media: string) => Object.assign(new EventTarget(), {
    media, matches: media.includes('max-width: 720px'), onchange: null, addListener() {}, removeListener() {}
  }));
}

test('a thread archived on the phone comes back from its own settings list', async () => {
  phoneWidth();
  window.history.replaceState(null, '', '/?fake=1&open=recent');
  const target = document.createElement('div');
  document.body.appendChild(target);
  store.booted = false;
  store.openThread = null;
  store.draft = null;
  store.page = 'chat';
  store.composerStates = {};
  store.projectPickerOpen = false;
  closeTour();
  running = mount(App, { target });
  await waitFor(() => store.booted && (store.openThread !== null || store.draft !== null));

  const client = store.client as FakeClient;
  expect(await archiveThread(store, 't-trace')).toBe(true);
  await waitFor(() => !store.threads.some((t) => t.id === 't-trace' && !t.archived));
  const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
  const merged = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: account.id, title: 'Merged phone conversation', worktree: { branch: 'merged-phone-fixture' } });
  client.setMergedPrFixture(merged.id, { repository: 'github.com/example/repo', branch: merged.branch!, tip: 'a'.repeat(40), clean: true, candidates: [{ repository: 'github.com/example/repo', branch: merged.branch!, sha: 'a'.repeat(40), number: 7, url: 'https://github.com/example/repo/pull/7', mergedAt: '2026-10-01T12:00:00Z' }] });
  // This version asks the agent after a merge; a `pr-merged` archive is one an older core made.
  const turn = await client.call('turns.start', { threadId: merged.id, prompt: 'Finish the change.' });
  await waitFor(() => store.threads.find(thread => thread.id === merged.id)?.status === 'idle');
  expect((await client.call('threads.get', { threadId: merged.id })).turns.find(row => row.id === turn.id)?.status).toBe('done');
  await client.call('threads.markRead', { threadId: merged.id });
  client.setMergedPrArchive(merged.id, { number: 7, url: 'https://github.com/example/repo/pull/7' });
  store.showSettings();
  await waitFor(() => document.querySelector('[data-testid=settings-tab-conversations]') !== null);
  query<HTMLButtonElement>('[data-testid=settings-tab-conversations]').click();
  // The archive is a card of Conversations, read when asked for, as on the desktop.
  await waitFor(() => document.querySelector('[data-testid=archived-show]') !== null);
  query<HTMLButtonElement>('[data-testid=archived-show]').click();
  await waitFor(() => document.querySelector('[data-testid=archived-restore]') !== null);
  expect(query('[data-testid=archived-list]').textContent).toContain('Finish the trace tab');
  const mergedReason = query(`[data-thread-id="${merged.id}"] [data-testid=archive-merged-reason]`);
  expect(mergedReason.textContent).toContain('Archived after PR #7 merged');
  expect(mergedReason.querySelector('a')?.getAttribute('href')).toBe('https://github.com/example/repo/pull/7');
  expect(mergedReason.querySelector('time')?.getAttribute('datetime')).not.toBeNull();
  query<HTMLButtonElement>('[data-thread-id=t-trace] [data-testid=archived-restore]').click();
  await waitFor(() => store.threads.find((t) => t.id === 't-trace')?.archived === false);

  // Back returns to the list: a page is one level under it.
  query<HTMLButtonElement>('[data-testid=mobile-settings-back]').click();
  await waitFor(() => document.querySelector('[data-testid=mobile-settings-home]') !== null);

  // The desktop's jump to the card (palette, project menu) lands on the same page here.
  // The jump scrolls the card into view, which jsdom does not draw.
  Element.prototype.scrollIntoView ??= vi.fn();
  store.showSettings('general', 'archived');
  await waitFor(() => document.querySelector('[data-testid=archived-list], [data-testid=archived-empty]') !== null);
  expect(document.querySelector('[data-testid=archived-show]')).toBeNull();
  expect(query('[data-testid=mobile-settings-detail]')).toBeTruthy();
  expect(query(`[data-thread-id="${merged.id}"] [data-testid=archive-merged-reason]`).textContent).toContain('PR #7');
  query<HTMLButtonElement>(`[data-thread-id="${merged.id}"] [data-testid=archived-restore]`).click();
  await waitFor(() => store.threads.find(thread => thread.id === merged.id)?.archived === false);
  // A restored checkout is never asked about.
  expect(await client.sweepMergedPrArchives()).toBe(0);
});

test('the phone settings list the map\'s pages, each a page of cards a phone has, the search landing on a card', async () => {
  phoneWidth();
  // The usage chart and the composer measure themselves; jsdom has no observer.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.history.replaceState(null, '', '/?fake=1');
  const target = document.createElement('div');
  document.body.appendChild(target);
  store.booted = false;
  store.openThread = null;
  store.draft = null;
  store.page = 'chat';
  store.composerStates = {};
  store.projectPickerOpen = false;
  closeTour();
  running = mount(App, { target });
  await waitFor(() => store.booted && (store.openThread !== null || store.draft !== null));

  const shown = (id: string) => () => document.querySelector(`[data-testid=${id}]`) !== null;
  const home = shown('mobile-settings-home');
  const back = async () => { query<HTMLButtonElement>('[data-testid=mobile-settings-back]').click(); await waitFor(home); };
  const open = async (page: string) => { query<HTMLButtonElement>(`[data-testid=settings-tab-${page}]`).click(); await waitFor(() => document.querySelector(`[data-testid=mobile-settings-detail] [data-testid=settings-page][data-page=${page}]`) !== null); };
  const has = (id: string) => document.querySelector(`[data-testid=mobile-settings-detail] [data-testid=${id}]`) !== null;
  store.showSettings();
  await waitFor(home);
  expect([...document.querySelectorAll<HTMLElement>('[data-testid=mobile-settings-home] .row')].map(row => row.dataset.testid)).toEqual(
    ['appearance', 'input', 'conversations', 'ai', 'agents', 'safeguards', 'devices', 'version', 'help'].map((page) => `settings-tab-${page}`));
  // One list, no family over it; Devices says which machine this phone reaches.
  expect(document.querySelector('[data-testid=settings-family]')).toBeNull();
  expect(query('[data-testid=mobile-settings-connection-value]').textContent?.trim()).not.toBe('');
  // The header already says Settings.
  expect(document.querySelector('[data-testid=mobile-settings-home] h1')).toBeNull();
  expect(query('[data-testid=settings]').dataset.detail).toBeUndefined();

  // The desktop's search is the list's first row: its results take the list's place, a pick opens the page on its card.
  expect(query('[data-testid=mobile-settings-home]').firstElementChild?.getAttribute('data-testid')).toBe('settings-home');
  const search = query<HTMLInputElement>('[data-testid=mobile-settings-home] [data-testid=settings-search]');
  const type = async (text: string) => { search.value = text; search.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); };
  // A desktop card is not among a phone's results.
  await type(strings.keyboard.resetAll);
  await waitFor(shown('settings-search-empty'));
  await type(strings.settings.muteAgents);
  await waitFor(shown('settings-search-results'));
  expect(document.querySelector('[data-testid=mobile-settings-pages]')).toBeNull();
  const result = query<HTMLButtonElement>('[data-testid=settings-search-result]');
  expect([result.dataset.page, result.dataset.section]).toEqual(['safeguards', 'quiet']);
  result.click();
  await waitFor(() => has('setting-mute-agents'));
  expect(store.settingsSection).toMatchObject({ id: 'quiet', flash: true });
  await waitFor(() => query('#settings-quiet').classList.contains('settings-flash'));
  // A page carries its own header, so the app drops its own over it: one header a screen.
  expect(query('[data-testid=settings]').dataset.detail).toBe('true');
  expect(query('[data-testid=mobile-settings-header] h1 .ui-label').textContent).toBe(strings.settingsMap.pages.safeguards);
  await back();
  expect(query<HTMLInputElement>('[data-testid=settings-search]').value).toBe('');

  // Appearance holds what a phone has of it, and says once that it is this device's.
  await open('appearance');
  expect(has('appearance-page')).toBe(true);
  expect(query('[data-testid=mobile-settings-page-scope]').textContent?.trim()).toBe(strings.settingsMap.scope.device);
  for (const id of ['chat-width-comfortable', 'terminal-gpu', 'settings-buttons', 'start-in-drafts', 'setting-edge-scrollbars']) expect(document.querySelector(`[data-testid=${id}]`), id).toBeNull();
  await back();

  // Input is the voice on a phone: the shortcuts stay on the desktop.
  await open('input');
  expect(has('voice-settings')).toBe(true);
  expect(has('keyboard-page')).toBe(false);
  await back();

  // Conversations: this phone's switches, then the machine's cards, each of those tagged.
  await open('conversations');
  for (const id of ['setting-chat-artifacts', 'setting-preview-comments', 'chat-group-changes', 'chat-expand-diffs', 'archived-threads']) expect(has(id), id).toBe(true);
  for (const id of ['setting-async-questions', 'setting-short-answers', 'setting-tool-summaries']) expect(document.querySelector(`[data-testid=agent-replies] [data-testid=${id}]`), id).not.toBeNull();
  expect(document.querySelector('#settings-worktrees')).not.toBeNull();
  expect(query('[data-testid=mobile-settings-page-scope]').dataset.scope).toBe('device');
  expect(document.querySelector('#settings-conversations [data-testid=card-scope]')).toBeNull();
  expect(query('[data-testid=agent-replies] [data-testid=card-scope]').dataset.kind).toBe('machine');
  for (const id of ['setting-group-working-threads', 'setting-notifications']) expect(has(id), id).toBe(false);
  await back();

  // AI accounts: the providers, the keys, the limits, then the usage, on one page.
  await open('ai');
  await waitFor(() => has('secrets-card') && has('limits-page') && has('usage-page'));
  expect(has('accounts-page')).toBe(true);
  expect(document.querySelector('[data-testid=mobile-usage-tabs]')).toBeNull();
  expect(has('browser-profiles-card')).toBe(false);
  await back();

  // Agents: compaction is one card of it.
  await open('agents');
  await waitFor(() => has('compaction-settings') && has('brain-page') && has('plugins-page'));
  for (const type of ['common', 'agent', 'subagent', 'bot']) expect(document.querySelector(`[data-testid=compaction-target-${type}]`)).not.toBeNull();
  query<HTMLButtonElement>('[data-testid=compaction-target-subagent]').click();
  await waitFor(() => document.querySelector('[data-testid=compaction-inherited]') !== null);
  expect(query<HTMLInputElement>('[data-testid=compaction-customize]').checked).toBe(false);
  await back();

  // Safeguards: sound and windows, the limits, the browser's profiles, privacy.
  await open('safeguards');
  await waitFor(() => has('telemetry-settings'));
  for (const id of ['setting-mute-agents', 'window-allowlist', 'resources-page', 'browser-profiles-card']) expect(has(id), id).toBe(true);
  await back();

  // Devices: the machines, and this phone's own card, without the desktop app's.
  await open('devices');
  await waitFor(() => has('phone-settings'));
  expect(has('phone-notification-kinds')).toBe(true);
  expect(has('setting-listen-on-lan')).toBe(false);
  expect(has('settings-card-device')).toBe(false);
  expect(query('[data-testid=mobile-settings-page-scope]').textContent?.trim()).toBe(strings.settingsMap.scope.group);
  await back();

  // Version: the updates, then the experiments of a build that runs them, Bots not among them.
  await open('version');
  expect(experimentOn('resident-agents')).toBe(true);
  await waitFor(() => has('experiment-whip'));
  expect(has('app-updates-card')).toBe(true);
  expect(document.querySelector('[data-testid=experiment-resident-agents]')).toBeNull();
  query<HTMLInputElement>('[data-testid=experiment-whip]').click();
  await waitFor(() => experimentOn('whip'));
  expect(document.querySelector('[data-testid=mobile-tabs]')).toBeNull();
  await back();

  // Troubleshooting: the diagnostics, the tasks, then the task manager.
  await open('help');
  await waitFor(() => document.querySelector('#settings-task-manager') !== null);
  expect(has('settings-version')).toBe(false);
  await back();

  // A page from before the map is still a route: it opens where its content went.
  query<HTMLButtonElement>('[data-testid=settings-tab-limits]').click();
  await waitFor(() => store.settingsTab === 'limits' && has('limits-page'));
  expect(query('[data-testid=settings-page]').dataset.page).toBe('ai');
});

test('on a phone too, a page of one machine is picked above it without moving the window', async () => {
  phoneWidth();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.history.replaceState(null, '', '/?fake=1&machines=1');
  const target = document.createElement('div');
  document.body.appendChild(target);
  store.booted = false;
  store.page = 'chat';
  closeTour();
  running = mount(App, { target });
  await waitFor(() => store.booted && workspace.machines.length === 2 && workspace.machines.every((machine) => machine.store.connection === 'ready'));
  const remote = workspace.machines.find((machine) => machine.store !== store)!;
  await remote.store.client!.call('settings.set', { muteAgents: true });
  await store.client!.call('settings.set', { muteAgents: true });
  store.showSettings('general', 'quiet');
  await waitFor(() => document.querySelector('[data-testid=settings-machine]') !== null && document.querySelector('[data-testid=setting-mute-agents]') !== null);
  query<HTMLButtonElement>('[data-testid=settings-machine]').click();
  await waitFor(() => document.querySelector('[data-testid=settings-machine-menu]') !== null);
  query<HTMLElement>(`[data-testid=settings-machine-menu] [data-value="${remote.id}"]`).click();
  await waitFor(() => query('[data-testid=settings-machine]').textContent?.includes(remote.label) === true);
  query<HTMLInputElement>('[data-testid=setting-mute-agents]').click();
  await waitFor(() => remote.store.settings?.muteAgents === false);
  expect(store.settings?.muteAgents).toBe(true);
  expect(workspace.active).toBe(store);
  // On a page that changes one machine whole, the header's scope word is the picker, and there is one.
  store.showSettings('voice');
  await waitFor(() => document.querySelector('[data-testid=mobile-settings-page-scope] [data-testid=settings-machine]') !== null);
  expect(document.querySelectorAll('[data-testid=settings-machine]')).toHaveLength(1);
});
