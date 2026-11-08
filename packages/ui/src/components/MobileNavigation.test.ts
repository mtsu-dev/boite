import { afterEach, expect, test, vi } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import { flushSync, mount, unmount } from 'svelte';
import { setExperiment } from '../lib/experiments';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import MobileNavigation from './MobileNavigation.svelte';
import { activityReturn } from '../lib/activity-return.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const previousActive = workspace.active;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined; store?.detach(); client?.close();
  workspace.machines = []; workspace.active = previousActive;
  setExperiment('contacts', false);
  activityReturn.away = null; activityReturn.back = null;
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

test('a phone row gives its title the width: a linked pull request stays in the thread, off the row', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(t => !t.parentThreadId && !t.archived && t.projectId !== null)!;
  thread.branch = null;
  await client.call('threads.linkPullRequest', { threadId: thread.id, url: 'https://github.com/example/repo/pull/9951' });
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  const row = document.querySelector<HTMLElement>(`[data-testid=mobile-row][data-thread-id="${thread.id}"]`)!;
  expect(row.querySelector('.title')?.textContent).toBe(thread.title);
  expect(row.querySelector('[data-testid=thread-pr]')).toBeNull();
});

test('Activity gives each row its reason and its time, a sub-agent under its parent', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  // A sub-agent that asks, under a top thread.
  const parent = store.threads.find(thread => !thread.parentThreadId && thread.projectId && thread.id !== store.openThread?.id)!;
  const child = { ...parent, id: 'helper-child', title: 'Check the parser', status: 'waiting', parentThreadId: parent.id } as ThreadSummary;
  store.threads = [...store.threads, child];
  store.pendingQuestions = [...store.pendingQuestions, { id: 'q-helper', threadId: child.id, text: 'Which retry policy?', options: [], createdAt: Date.now() } as never];
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'activity' } });
  await settle();
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=mobile-row]'));
  expect(rows.length).toBeGreaterThan(0);
  // Since when ends the title's line, after the mark (ThreadHeadline.svelte).
  for (const row of rows) expect(row.querySelector('.headline > time.at')?.textContent?.trim()).toBeTruthy();
  const helpers = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=thread-helper]'));
  const reasons = rows.map(row => row.querySelector('[data-testid=mobile-row-reason] .text')?.textContent ?? '');
  // A question is its own reason, a permission says what it runs.
  const asked = store.pendingQuestions.map(question => question.text.split('\n')[0]!.trim());
  expect(reasons.some(reason => /^Wants to run /.test(reason) || asked.includes(reason))).toBe(true);
  // Triage: what asks the user under "Needs you", before the updates' heading when there is one.
  const needs = document.querySelector<HTMLElement>('[data-testid=activity-needs]')!;
  // The section says its number, the tab badge's own: one count for both.
  expect(needs.firstChild?.textContent).toBe('Needs you');
  expect(needs.querySelector('.feed-count')?.textContent).toBe(document.querySelector('[data-testid=mobile-activity-waiting]')?.textContent);
  const updates = document.querySelector<HTMLElement>('[data-testid=activity-updates]');
  const asking = rows.find(row => asked.includes(row.querySelector('[data-testid=mobile-row-reason] .text')?.textContent ?? '') || /^Wants to run /.test(row.textContent ?? ''))!;
  expect(needs.compareDocumentPosition(asking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  if (updates) expect(updates.compareDocumentPosition(asking) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  // The asking row says what to do there; its verb opens the thread like the row does.
  const verb = asking.querySelector<HTMLButtonElement>('[data-testid=thread-verb]')!;
  expect(['Answer', 'Allow']).toContain(verb.textContent);
  if (updates) for (const row of rows.filter(row => updates.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)) expect(row.querySelector('[data-testid=thread-verb]')).toBeNull();
  const pressed = [...document.querySelectorAll('[data-testid=mobile-list] [data-testid=thread-verb]')].indexOf(verb);
  verb.click(); await settle();
  expect(store.openThread?.id).toBe(asking.dataset['threadId']);
  // The way back to Activity is kept, for the phone's own screens (lib/activity-return.svelte.ts).
  expect(activityReturn.away).toMatchObject({ threadId: asking.dataset['threadId'], phone: true, index: pressed });
  // One thread, one row: a sub-agent that asks is a line inside its parent's row, never a row of its own.
  expect(helpers.length).toBeGreaterThan(0);
  for (const helper of helpers) {
    const child = store.threads.find(t => t.id === helper.dataset['threadId'])!;
    expect(helper.closest<HTMLElement>('[data-testid=mobile-row]')!.dataset['threadId']).toBe(child.parentThreadId);
  }
  for (const row of rows) expect(store.threads.find(t => t.id === row.dataset['threadId'])?.parentThreadId ?? null).toBeNull();
});

test('selecting a conversation beyond the first mobile window finishes loading its history', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const root = document.querySelector<HTMLElement>('[data-testid=mobile-list]');
    return new DOMRect(0, this === root ? 0 : -(root?.scrollTop ?? 0), 390, this.dataset.windowKey ? 66 : 400);
  });
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const summary = store.threads[0]!;
  const history = await client.call('threads.get', { threadId: summary.id });
  expect(history.messages.length).toBeGreaterThan(0);
  store.threads = Array.from({ length: 1000 }, (_, index) => ({ ...summary, id: index === 999 ? summary.id : `offscreen-${index}`, updatedAt: 1000 - index }));
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  // A big project opens folded to a few rows; its "N more" line unfolds it in place, into the window below.
  expect(document.querySelectorAll('[data-testid^=mobile-thread-]').length).toBeLessThan(10);
  document.querySelector<HTMLButtonElement>('[data-testid=project-more]')!.click(); await settle();
  const selector = `[data-testid="mobile-thread-${summary.id}"]`;
  expect(document.querySelector(selector)).toBeNull();
  const root = document.querySelector<HTMLElement>('[data-testid=mobile-list]')!;
  root.scrollTop = 65_700; root.dispatchEvent(new Event('scroll')); await settle();
  expect(document.querySelectorAll('[data-testid^=mobile-thread-]').length).toBeLessThan(50);
  const row = document.querySelector<HTMLButtonElement>(selector)!;
  expect(row).not.toBeNull(); row.click(); await settle();
  expect(store.openThread?.id).toBe(summary.id);
  expect(store.openThread?.messages).toEqual(history.messages);
  expect(store.loadingThreadId).toBeNull();
});

test('the header holds the search, opened in place, and the new thread; the bar goes back to the threads', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'activity' } });
  await settle();
  const list = () => document.querySelector('[data-testid=mobile-list]')?.getAttribute('aria-label');
  const id = (testid: string) => document.querySelector<HTMLElement>(`[data-testid=${testid}]`);
  expect(list()).toBe('Activity');
  id('mobile-conversations')!.click(); await settle();
  expect(list()).toBe('Threads');
  // The header names the list's two views, the one on marked, a press switching them; the display menu is beside them.
  const views = () => [...id('mobile-view-switch')!.querySelectorAll('[role=radio]')].map(side => `${side.textContent?.trim()}:${side.getAttribute('aria-checked')}`);
  expect(views()).toEqual(['Projects:true', 'Recent:false']);
  id('mobile-view-switch')!.querySelector<HTMLButtonElement>('[data-value=recent]')!.click(); await settle();
  expect([workspace.view, ...views()]).toEqual(['recent', 'Projects:false', 'Recent:true']);
  workspace.setView('projects'); await settle();
  expect(id('mobile-title')?.querySelector('[data-testid=mobile-grouping-options]')).toBeNull();
  expect(id('mobile-grouping-options')).not.toBeNull();
  store.showSettings('machines'); await settle();
  expect(list()).toBeUndefined();
  expect(id('mobile-search-open')).toBeNull();
  id('mobile-conversations')!.click(); await settle();
  expect(store.page).toBe('chat');
  expect(list()).toBe('Threads');

  // The magnifier swaps the title for the field; closing it clears the filter.
  expect(id('mobile-search')).toBeNull();
  const rows = () => document.querySelectorAll('.mobile-list [data-thread-id]').length;
  const everything = rows();
  id('mobile-search-open')!.click(); await settle();
  await new Promise(resolve => requestAnimationFrame(resolve));
  const field = id('mobile-search') as HTMLInputElement;
  expect(document.activeElement).toBe(field);
  expect(id('mobile-title')).toBeNull();
  expect(id('mobile-new')).toBeNull();
  field.value = 'no thread is called this'; field.dispatchEvent(new Event('input')); await settle();
  expect(rows()).toBe(0);
  id('mobile-search-close')!.click(); await settle();
  expect(id('mobile-search')).toBeNull();
  expect(rows()).toBe(everything);

  // A row has no menu button to see: a long press, Android's contextmenu, opens its menu.
  const row = document.querySelector<HTMLElement>('.mobile-list [data-thread-id]')!;
  const threadId = row.dataset['threadId'];
  row.querySelector('[data-testid^=mobile-thread-]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await settle();
  expect(id(`mobile-thread-menu-${threadId}-menu`)?.querySelector('[data-value=rename]')).not.toBeNull();
  // A short first level, then one named group that opens in the same sheet and comes back: a new title is in it, the path is not.
  const menuValues = () => Array.from(id(`mobile-thread-menu-${threadId}-menu`)?.querySelectorAll<HTMLElement>('[data-value]') ?? []).map(item => item.dataset['value']);
  const first = menuValues();
  expect(first.length).toBeLessThanOrEqual(7);
  expect(first).not.toContain('retitle');
  id(`mobile-thread-menu-${threadId}-menu`)!.querySelector<HTMLButtonElement>('[data-value=more]')!.click(); await settle();
  expect(menuValues()).toContain('retitle');
  expect(menuValues()).not.toContain('copy');
  id(`mobile-thread-menu-${threadId}-menu`)!.querySelector<HTMLButtonElement>('[data-value=back]')!.click(); await settle();
  expect(menuValues()).toEqual(first);
  // No panel in a row's menu: the panels have their own selector, in the panel.
  expect(menuValues().filter(value => value?.startsWith('kind:') || value === 'board-toggle')).toEqual([]);

  // The new thread is the header's neutral "+", out of the bottom bar.
  expect(document.querySelector('[data-testid=mobile-tabs] [data-testid=mobile-new]')).toBeNull();
  id('mobile-new')!.click(); await settle();
  expect(store.draft).not.toBeNull();
  expect(document.querySelector('.mobile-list')).toBeNull();
  expect(id('mobile-back')).not.toBeNull();
  expect(id('mobile-new')).toBeNull();
});

test('a parent on another machine shows its working sub-agents, counted, and Recent filters what is at work', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  // The phone's own core is not the one the parent runs on: a second machine, not the active one.
  const remoteClient = new FakeClient({ delayMs: 0, coreId: 'fake-builder', coreName: 'Builder' });
  const remote = new Store(); remote.machineId = 'http://builder.test'; remote.visible = false;
  remote.attach(remoteClient); await remote.connect();
  try {
    const parent = remote.threads.find(t => !t.parentThreadId && !t.archived && t.projectId !== null && t.status === 'idle')!;
    const now = Date.now();
    remote.threads = [
      ...remote.threads.map(t => t.id === parent.id ? { ...t, unread: true, pinned: false, backgroundWork: null } : t),
      { ...parent, id: 'child-1', parentThreadId: parent.id, status: 'running', runningSince: now - 60_000, unread: false },
      { ...parent, id: 'child-2', parentThreadId: parent.id, status: 'queued', runningSince: null, unread: false }
    ];
    workspace.machines = [{ id: 'local', label: 'Local', store }, { id: remote.machineId, label: 'Builder', store: remote }];
    workspace.active = store;
    workspace.view = 'recent';
    mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
    await settle();
    const state = () => document.querySelector<HTMLElement>(`[data-machine-id="${remote.machineId}"][data-thread-id="${parent.id}"] [data-testid=thread-state]`);
    // Recent marks the state, as a computer's Recent row does; the count stays in the tooltip, never written out.
    expect(state()?.dataset['state']).toBe('delegating');
    expect(state()?.textContent).not.toContain('sub-agents');
    // The mark ends the title's own line, as on the desktop, instead of a line of its own under it.
    expect(state()?.parentElement?.classList.contains('headline')).toBe(true);
    expect(state()?.getAttribute('title')).toMatch(/^Waiting on 2 sub-agents/);
    // A child is never a row of its own.
    expect(document.querySelector('[data-thread-id="child-1"]')).toBeNull();

    const rows = () => [...document.querySelectorAll<HTMLElement>('.mobile-list .row')].map(row => row.dataset['threadId']);
    const everything = rows().length;
    expect(everything).toBeGreaterThan(1);
    // The filter lives in the display menu, its count on the menu's button: the list keeps no row of chips.
    expect(document.querySelector('.mobile-list [data-testid=mobile-at-work]')).toBeNull();
    const count = () => document.querySelector('[data-testid=mobile-filter-count]')?.textContent ?? null;
    expect(count()).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid=mobile-grouping-options]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid=mobile-at-work]')).not.toBeNull());
    const chip = () => document.querySelector<HTMLButtonElement>('[data-testid=mobile-at-work]');
    expect(chip()?.textContent?.trim()).toBe('1 at work');
    expect(chip()?.getAttribute('aria-checked')).toBe('false');
    chip()!.click(); await settle();
    expect(chip()?.getAttribute('aria-checked')).toBe('true');
    expect(count()).toBe('1');
    expect(rows()).toEqual([parent.id]);

    // Opening the parent and coming Back finds the list still filtered.
    document.querySelector<HTMLButtonElement>(`[data-testid="mobile-thread-${parent.id}"]`)!.click(); await settle();
    expect(document.querySelector('.mobile-list')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid=mobile-back]')!.click(); await settle();
    expect(count()).toBe('1');
    expect(rows()).toEqual([parent.id]);

    // The Projects list reads the same store: the same radar there. Back in Recent, the filter holds.
    workspace.view = 'projects'; await settle();
    expect(state()?.dataset['state']).toBe('delegating');
    // Work is a grey mark alone: its word and how long it has run are in the tooltip.
    expect(state()?.querySelector('[data-testid=thread-state-text]')).toBeNull();
    expect(state()?.getAttribute('title')).toMatch(/sub-agents\n1m/);
    workspace.view = 'recent'; await settle();
    expect(count()).toBe('1');
    expect(rows()).toEqual([parent.id]);

    // The last sub-agent ends: the radar, the chip and its filter go. The parent was read when opened, so nothing replaces the radar.
    for (const row of remote.threads) if (row.parentThreadId === parent.id) { row.status = 'idle'; row.runningSince = null; }
    await settle();
    expect(document.querySelector(`[data-thread-id="${parent.id}"]`)).not.toBeNull();
    expect(state()).toBeNull();
    expect(count()).toBeNull();
    expect(rows().length).toBe(everything);
  } finally {
    remote.detach(); remoteClient.close();
  }
});

test("a contact's page opened from the list leaves for the board on the chat screen, and Back returns to the list", async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  setExperiment('contacts', true);
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  // What the contact's row under the projects does.
  store.showHome('core-chris'); await settle();
  expect(document.querySelector('.mobile-list')).toBeNull();

  await store.openProjectBoard('p-boite'); await settle();
  expect([store.page, store.openThread?.projectId, store.boardShown]).toEqual(['chat', 'p-boite', true]);
  expect(document.querySelector('.mobile-list')).toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=mobile-back]')!.click(); await settle();
  expect(document.querySelector('.mobile-list')).not.toBeNull();
});

test("a project header's menu starts a thread there and leaves the list for its composer", async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  workspace.setView('projects');
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  const group = document.querySelector<HTMLElement>('[data-testid=mobile-project-group][data-project-id=p-boite]')!;
  group.querySelector<HTMLButtonElement>('[data-testid=mobile-project-menu]')!.click(); await settle();
  const { contextMenu } = await import('../lib/context-menu.svelte');
  expect(contextMenu.current?.items.map(item => item.id)).toContain('new');
  contextMenu.current!.onpick('new'); await settle();
  // The draft was made, yet the list stayed over it.
  expect(store.draft?.projectId).toBe('p-boite');
  expect(document.querySelector('.mobile-list')).toBeNull();
});

test('with two machines the machine line shows on the threads list only: Activity gathers every machine', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }, { id: 'pc', label: 'PC', store: new Store() }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  expect(document.querySelector('[data-testid=mobile-connection]')?.textContent).toContain('Local');
  // One row: the machine sits beside the view switch and the display menu, not on a line of its own over them.
  expect(document.querySelector('[data-testid=mobile-connection]')?.parentElement?.dataset['testid']).toBe('mobile-header');
  await unmount(mounted);
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'activity' } });
  await settle();
  expect(document.querySelector('[data-testid=mobile-connection]')).toBeNull();
});

test("an unreachable machine's project header reads Offline as on the desktop: a grey dot, the word in its name", async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const remoteClient = new FakeClient({ delayMs: 0, coreId: 'fake-builder', coreName: 'Builder' });
  const remote = new Store(); remote.machineId = 'http://builder.test'; remote.visible = false;
  remote.attach(remoteClient); await remote.connect();
  try {
    workspace.machines = [{ id: 'local', label: 'Local', store }, { id: remote.machineId, label: 'Builder', store: remote }];
    workspace.active = store;
    workspace.view = 'projects';
    mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
    await settle();
    const host = () => document.querySelector<HTMLElement>(`[data-testid=mobile-project-group][data-machine-id="${remote.machineId}"] [data-testid=mobile-project-host]`);
    expect(host()?.getAttribute('aria-label')).toBe('Builder');
    expect(host()?.querySelector('.off-dot')).toBeNull();
    remote.connection = 'closed'; await settle();
    expect(host()?.classList.contains('offline')).toBe(true);
    expect(host()?.querySelector('.off-dot')).not.toBeNull();
    expect(host()?.getAttribute('aria-label')).toBe('Builder, Offline');
    expect(host()?.textContent).toBe('Builder');
  } finally {
    remote.detach(); remoteClient.close();
  }
});
