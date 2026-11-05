import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import { flushSync, mount, unmount } from 'svelte';
import { setExperiment } from '../lib/experiments';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import MobileNavigation from './MobileNavigation.svelte';

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
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

test('a phone row is one line: its linked PR and branch wait in the conversation header', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(t => !t.parentThreadId && !t.archived && t.projectId !== null)!;
  thread.branch = 'calm-topic';
  const url = 'https://github.com/example/repo/pull/9951';
  await client.call('threads.linkPullRequest', { threadId: thread.id, url });
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  const row = document.querySelector<HTMLElement>(`[data-thread-id="${thread.id}"]`)!;
  expect(row).not.toBeNull();
  expect(row.querySelector('[data-testid=thread-pr]')).toBeNull();
  expect(row.querySelector('[data-testid=thread-branch]')).toBeNull();
  expect(row.textContent).not.toContain('#9951');
  expect(row.textContent).not.toContain('calm-topic');
});

test('selecting a conversation beyond the first mobile window finishes loading its history', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const root = document.querySelector<HTMLElement>('[data-testid=mobile-list]');
    return new DOMRect(0, this === root ? 0 : -(root?.scrollTop ?? 0), 390, this.dataset.windowKey ? 77 : 400);
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
  // The project folds past six rows (the desktop's lanes); opened, all thousand go through the window.
  document.querySelector<HTMLButtonElement>('[data-testid=mobile-more]')!.click(); await settle();
  const selector = `[data-testid="mobile-thread-${summary.id}"]`;
  expect(document.querySelector(selector)).toBeNull();
  const root = document.querySelector<HTMLElement>('[data-testid=mobile-list]')!;
  root.scrollTop = 63_800; root.dispatchEvent(new Event('scroll')); await settle();
  expect(document.querySelectorAll('[data-testid^=mobile-thread-]').length).toBeLessThan(50);
  const row = document.querySelector<HTMLButtonElement>(selector)!;
  expect(row).not.toBeNull(); row.click(); await settle();
  expect(store.openThread?.id).toBe(summary.id);
  expect(store.openThread?.messages).toEqual(history.messages);
  expect(store.loadingThreadId).toBeNull();
});

test('the logo goes back to the conversations, as Back does in a conversation', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'activity' } });
  await settle();
  const list = () => document.querySelector('[data-testid=mobile-list]')?.getAttribute('aria-label');
  expect(list()).toBe('Inbox');
  document.querySelector<HTMLButtonElement>('[data-testid=mobile-home]')!.click(); await settle();
  expect(list()).toBe('Threads');
  store.showSettings('machines'); await settle();
  expect(list()).toBeUndefined();
  document.querySelector<HTMLButtonElement>('[data-testid=mobile-home]')!.click(); await settle();
  expect(store.page).toBe('chat');
  expect(list()).toBe('Threads');
  await unmount(mounted); document.body.innerHTML = '';
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'chat' } }); await settle();
  expect(document.querySelector('[data-testid=mobile-home]')).toBeNull();
  expect(document.querySelector('[data-testid=mobile-back]')).not.toBeNull();
});

test('a parent on another machine shows its working sub-agents, counted, and the list heading picks the view while the lifecycle tabs count the work', async () => {
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
    expect(state()?.dataset['state']).toBe('delegating');
    expect(state()?.querySelector('[data-testid=thread-state-text]')?.textContent).toMatch(/^1m/);
    // A phone row is one line: agents at work are the ring's and the state's tooltip, never a chip or words on the row.
    expect(document.querySelector(`[data-machine-id="${remote.machineId}"][data-thread-id="${parent.id}"] [data-testid=thread-subagents]`)).toBeNull();
    expect(state()?.textContent).not.toContain('sub-agents');
    expect(state()?.getAttribute('title')).toMatch(/^Waiting on 2 sub-agents/);
    // A child is never a row of its own.
    expect(document.querySelector('[data-thread-id="child-1"]')).toBeNull();

    const rows = () => [...document.querySelectorAll<HTMLElement>('.mobile-list [data-testid=mobile-row]')].map(row => row.dataset['threadId']);
    const everything = rows().length;
    expect(everything).toBeGreaterThan(1);
    // The lifecycle tabs count the work under the heading: no "at work" chip beside them (round 5).
    expect(document.querySelector('[data-testid=mobile-lifecycle]')).not.toBeNull();
    expect(document.querySelector('[data-testid=mobile-at-work]')).toBeNull();
    // Opening the parent reads it. Both fake cores carry a thread of that id: open the remote one.
    document.querySelector<HTMLButtonElement>(`[data-machine-id="${remote.machineId}"][data-thread-id="${parent.id}"] [data-testid="mobile-thread-${parent.id}"]`)!.click(); await settle();
    expect(document.querySelector('.mobile-list')).toBeNull();
    await vi.waitFor(() => expect(remote.threads.find(t => t.id === parent.id)?.unread).toBe(false));
    document.querySelector<HTMLButtonElement>('[data-testid=mobile-back]')!.click(); await settle();
    // The heading's picker names the view and switches it, as the sidebar's does; Recent adds the project scope under it.
    const viewName = () => document.querySelector('[data-testid=mobile-view-name]')?.textContent;
    expect(viewName()).toBe('Recent');
    document.querySelector<HTMLButtonElement>('[data-testid=mobile-project-filter]')!.click(); await settle();
    const menu = document.querySelector('[data-testid=mobile-project-filter-menu]')!;
    expect(menu.querySelector('[data-value="view:recent"]')?.getAttribute('aria-checked')).toBe('true');
    expect(menu.querySelector('[data-value=all]')).not.toBeNull();
    menu.querySelector<HTMLButtonElement>('[data-value="view:projects"]')!.click(); await settle();
    expect(workspace.view).toBe('projects');
    expect(viewName()).toBe('Projects');
    // The Projects list reads the same store: the same radar there.
    expect(state()?.dataset['state']).toBe('delegating');
    workspace.view = 'recent'; await settle();

    // The last sub-agent ends: the radar goes. The parent was read when opened, so nothing replaces it.
    for (const row of remote.threads) if (row.parentThreadId === parent.id) { row.status = 'idle'; row.runningSince = null; }
    await settle();
    expect(document.querySelector(`[data-thread-id="${parent.id}"]`)).not.toBeNull();
    expect(state()).toBeNull();
    expect(rows().length).toBe(everything);
  } finally {
    remote.detach(); remoteClient.close();
  }
});

test('the Inbox tab lists what waits on the user, longest wait first, before the work going on, under a large title the bar takes over on scroll', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  const [older, newer, busy, quiet] = store.threads.filter(thread => !thread.archived && !thread.incognito && !thread.teamId && !thread.debateId && !thread.parentThreadId);
  const rest = { status: 'idle' as const, openQuestions: 0, subagentQuestions: [] as NonNullable<ThreadSummary['subagentQuestions']>, unread: false };
  store.pendingQuestions = []; store.pendingPermissions = [];
  store.threads = store.threads.map(thread => thread.id === older!.id ? { ...thread, ...rest, status: 'waiting', runningSince: 1_000 }
    : thread.id === newer!.id ? { ...thread, ...rest, status: 'waiting', runningSince: 5_000 }
    : thread.id === busy!.id ? { ...thread, ...rest, status: 'running', runningSince: 2_000 }
    : { ...thread, ...rest });
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'activity' } });
  await settle();
  const list = document.querySelector<HTMLElement>('[data-testid=mobile-list]')!;
  const order = Array.from(list.querySelectorAll<HTMLElement>('[data-testid=mobile-inbox-needs], [data-testid=mobile-inbox-working], [data-thread-id]'))
    .map(node => node.dataset.threadId ?? node.dataset.testid);
  expect(order.filter((id, index) => order.indexOf(id) === index)).toEqual(['mobile-inbox-needs', older!.id, newer!.id, 'mobile-inbox-working', busy!.id]);
  expect(order).not.toContain(quiet!.id);
  expect(document.querySelector('[data-testid=mobile-inbox-needs] .count')!.textContent).toBe('2');
  // C9: a waiting row says what it waits on in one word, its full reason in the title, and how long, in place of its state.
  const why = list.querySelector<HTMLElement>(`[data-thread-id="${older!.id}"] [data-testid=thread-wait-reason]`)!;
  expect([why.dataset['reason'], why.textContent?.trim(), why.querySelector('.ui-label')!.getAttribute('title')]).toEqual(['question', 'Question', 'Asks you']);
  expect(list.querySelector(`[data-thread-id="${older!.id}"] time.waited`)).not.toBeNull();
  expect(list.querySelector(`[data-thread-id="${busy!.id}"] [data-testid=thread-wait-reason]`)).toBeNull();

  // The list's name, large and hidden from readers, until it scrolls under the bar, whose title then fades in.
  const title = document.querySelector('[data-testid=mobile-title]')!;
  expect(list.querySelector('.large-title')!.textContent).toBe('Inbox');
  expect(list.querySelector('.large-title')!.getAttribute('aria-hidden')).toBe('true');
  expect(list.querySelector('h1')).toBeNull();
  expect(title.classList.contains('folded')).toBe(true);
  list.scrollTop = 120; list.dispatchEvent(new Event('scroll')); await settle();
  expect(title.classList.contains('folded')).toBe(false);
});

test('Contacts left the bar: the Bots page header carries it for the owner, a paired device gets no way in', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  setExperiment('contacts', true);
  setExperiment('resident-agents', true);
  onTestFinished(() => setExperiment('resident-agents', false));
  client = new FakeClient({ delayMs: 0, principal: 'session' });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  store.showAgents();
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await settle(); }
  expect(document.querySelector('[data-testid=mobile-contacts]')).toBeNull();
  await unmount(mounted); mounted = undefined; store.detach(); client.close(); document.body.innerHTML = '';

  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  store.showAgents();
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await vi.waitFor(async () => { await settle(); expect(document.querySelector('[data-testid=mobile-contacts]')).not.toBeNull(); });
  document.querySelector<HTMLButtonElement>('[data-testid=mobile-contacts]')!.click(); await settle();
  expect(store.page).toBe('home');
});

// Round 3's thread header shared its row with the contacts button and cut the title at 16 characters.
test('the contacts count waits on the list, never in a conversation header', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  setExperiment('contacts', true);
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  const header = () => document.querySelector('[data-testid=mobile-header]')!;
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await vi.waitFor(async () => { await settle(); expect(header().querySelector('[data-testid=contact-request-open]')).not.toBeNull(); });
  await unmount(mounted);
  await store.open(store.threads.find(t => !t.parentThreadId && !t.archived)!.id);
  mounted = mount(MobileNavigation, { target: document.body, props: { store, screen: 'chat' } });
  await vi.waitFor(async () => { await settle(); expect(header().querySelector('[data-testid=thread-title], [data-testid=thread-menu-trigger]')).not.toBeNull(); });
  for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await settle(); }
  expect(header().querySelector('[data-testid=contact-request-open]')).toBeNull();
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
