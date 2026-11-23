import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import ThreadCard from './ThreadCard.svelte';
import ThreadHeader from './ThreadHeader.svelte';
import { strings } from '../lib/strings';
import { panelSwitch } from '../lib/panel-switch.svelte';
import { contextMenu } from '../lib/context-menu.svelte';
import { PULL_REQUEST_POLL_MS } from '../lib/pull-request';
import { Files } from '@lucide/svelte';
import PanelSwitcher from './PanelSwitcher.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

async function renameOpen(text: string): Promise<HTMLInputElement> {
  document.querySelector<HTMLButtonElement>('[data-testid=thread-title]')!.click();
  flushSync();
  const input = document.querySelector<HTMLInputElement>('[data-testid=thread-rename-input]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return input;
}

async function start(): Promise<ReturnType<typeof vi.spyOn>> {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  mounted = mount(ThreadHeader, { target: document.body, props: { store } });
  await settle();
  return vi.spyOn(store, 'rename').mockResolvedValue();
}

test('the open thread names the work it is waiting on and shows when the wait began', async () => {
  await start();
  const since = Date.now() - 60_000;
  store.openThread = { ...store.openThread!, status: 'idle', backgroundWait: { state: 'waiting', for: 'release build', since, until: null } };
  await settle();
  const wait = document.querySelector('[data-testid=thread-header] [data-testid=thread-wait]');
  expect(wait?.textContent).toContain('Waiting on release build');
  expect(wait?.querySelector('[data-testid=agent-elapsed]')?.textContent).toMatch(/^1m \d\ds$/);
  store.openThread = { ...store.openThread!, backgroundWait: null };
  await settle();
  expect(document.querySelector('[data-testid=thread-header] [data-testid=thread-wait]')).toBeNull();
});

test('an idle parent shows its active children until they finish, and a child question takes priority', async () => {
  await start();
  const parent = { ...store.openThread!, status: 'idle' as const, openQuestions: 0, backgroundWait: null, backgroundWork: null, pullRequestWatches: [] };
  store.openThread = parent;
  const before = store.threads;
  const children = ['one', 'two'].map(id => ({ ...parent, id, parentThreadId: parent.id, status: 'running' as const, runningSince: Date.now() - 60_000 }));
  const wait = () => document.querySelector('[data-testid=thread-header] [data-testid=thread-wait]');
  store.threads = [...before, ...children];
  await settle();
  expect(wait()?.textContent).toContain(strings.app.rail.subagentsMany.replace('{count}', '2'));
  expect(wait()?.querySelector('[data-testid=agent-elapsed]')?.textContent).toMatch(/^1m \d\ds$/);
  store.threads = [...before, children[0]!, { ...children[1]!, status: 'waiting' }];
  await settle();
  expect(wait()?.textContent?.trim()).toBe(strings.sidebar.state.waiting);
  store.threads = before;
  await settle();
  expect(wait()).toBeNull();
});

test('a paused pull request watch shows its reason and next read instead of its last CI result', async () => {
  await start();
  const since = Date.now() - 600_000;
  const watch = {
    url: 'https://github.com/example/repo/pull/12', repository: 'example/repo', number: 12, since,
    seen: { checkedAt: since, head: 'abc', base: 'main', checks: { total: 2, running: 2, failed: 0 }, conflicting: false }, paused: null,
  };
  const thread = { ...store.openThread!, status: 'idle' as const, backgroundWait: null, backgroundWork: null };
  store.openThread = { ...thread, pullRequestWatches: [watch] };
  await settle();
  const wait = () => document.querySelector('[data-testid=thread-header] [data-testid=thread-wait]');
  expect(wait()?.textContent).toContain('CI running #12');
  const paused = { ...watch, paused: { reason: 'rate-limit' as const, until: Date.now() + 60_000, message: 'rate limit' } };
  store.openThread = { ...thread, pullRequestWatches: [paused] };
  await settle();
  expect(wait()?.textContent).toMatch(/GitHub rate limit · retry .+/);
  expect(wait()?.querySelector('[data-testid=agent-elapsed]')).toBeNull();

  const active = { ...watch, url: 'https://github.com/example/repo/pull/34', number: 34, since: Date.now() - 120_000 };
  store.openThread = { ...thread, pullRequestWatches: [paused, active] };
  await settle();
  expect(wait()?.textContent).toContain('CI running #34');
  expect(wait()?.textContent).not.toContain('#12');
  expect(wait()?.querySelector('[data-testid=agent-elapsed]')?.textContent).toMatch(/^2m \d\ds$/);
});

test('a rename begun on one thread writes to that thread after another surface opens a different one', async () => {
  const rename = await start();
  const input = await renameOpen('Title for the trace thread');
  const other = store.threads.find(thread => thread.id !== 't-trace' && !thread.archived)!;
  await store.open(other.id);
  await settle();
  expect(store.openThread?.id).toBe(other.id);
  input.dispatchEvent(new FocusEvent('blur'));
  await settle();
  expect(rename.mock.calls).toEqual([['t-trace', 'Title for the trace thread']]);
  expect(document.querySelector('[data-testid=thread-rename-input]')).toBeNull();
});

test('Enter commits once and Escape commits nothing, whatever blur follows', async () => {
  const rename = await start();
  let input = await renameOpen('Kept');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  await settle();
  expect(rename.mock.calls).toEqual([['t-trace', 'Kept']]);

  input = await renameOpen('Dropped');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur'));
  await settle();
  expect(rename).toHaveBeenCalledTimes(1);
});

test('a header unmounted with its rename open, as a machine switch does, still writes the title typed so far', async () => {
  const rename = await start();
  await renameOpen('Typed before the switch');
  await unmount(mounted!);
  mounted = undefined;
  await settle();
  expect(rename.mock.calls).toEqual([['t-trace', 'Typed before the switch']]);
});

for (const phone of [true, false]) test(`the thread menu opens its pull request by keyboard or touch, ${phone ? 'on a phone, whose row draws no mark' : 'on a desktop, whose row mark is pointer-only'}`, async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: phone && media.includes('max-width'), onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  const pr = { number: 214, url: 'https://github.com/example/repo/pull/214', state: 'OPEN' as const };
  const original = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation((async (method: string, params: unknown) => method === 'threads.pullRequest' ? pr : original(method as never, params as never)) as typeof client.call);
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  mounted = mount(ThreadHeader, { target: document.body, props: { store } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
  // The folder group, beside the move.
  document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu] [data-value=more]')!.click(); await settle();
  const row = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu] [data-value=thread-pr]')!;
  expect(row.textContent).toContain('#214');
  row.click(); await settle();
  expect(opened).toHaveBeenCalledWith(pr.url, '_blank', 'noopener,noreferrer');
});

test.each([
  { scenario: 'a later manual refresh', delay: 1, remount: false },
  { scenario: 'a manual refresh in the same millisecond', delay: 0, remount: false },
  { scenario: 'a manual refresh and header remount', delay: 1, remount: true }
])('an automatic lookup finishing after $scenario keeps the newer PR in the header and on disk', async ({ delay, remount }) => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch && thread.branch !== 'HEAD' && thread.status === 'idle')!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  await store.open(thread.id);
  const stale = { number: 214, url: 'https://github.com/example/repo/pull/214', state: 'OPEN' as const };
  const fresh = { number: 215, url: 'https://github.com/example/repo/pull/215', state: 'OPEN' as const };
  let finishAuto!: (pr: typeof stale) => void;
  const auto = new Promise<typeof stale>(resolve => { finishAuto = resolve; });
  let finishManual!: (pr: typeof fresh) => void;
  const manual = new Promise<typeof fresh>(resolve => { finishManual = resolve; });
  const lookup = vi.fn().mockResolvedValueOnce(stale).mockReturnValueOnce(auto).mockReturnValueOnce(manual);
  const original = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation((method, params) =>
    method === 'threads.pullRequest' ? lookup(params) : original(method, params));
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const card = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now } });
  try {
    await settle();
    clock.mockReturnValue(now + PULL_REQUEST_POLL_MS); // Expire the cached result before the sidebar's next timer runs.
    mounted = mount(ThreadHeader, { target: document.body, props: { store } });
    await settle();
    expect(lookup).toHaveBeenCalledTimes(2);

    clock.mockReturnValue(now + PULL_REQUEST_POLL_MS + delay);
    document.querySelector('[data-testid=thread-row]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    contextMenu.current!.onpick('more');
    contextMenu.current!.onpick('pr');
    contextMenu.close();
    await settle();
    expect(lookup).toHaveBeenLastCalledWith({ threadId: thread.id, refresh: true });
    if (remount) {
      await unmount(mounted);
      clock.mockReturnValue(now + PULL_REQUEST_POLL_MS + delay + 1);
      mounted = mount(ThreadHeader, { target: document.body, props: { store } });
      await settle();
      expect(lookup).toHaveBeenCalledTimes(3);
    }
    finishManual(fresh);
    await settle();
    expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#215');

    finishAuto(stale);
    await settle();
    document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
    document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger-menu] [data-value=more]')!.click(); await settle();
    expect.soft(document.querySelector('[data-testid=thread-menu-trigger-menu] [data-value=thread-pr]')?.textContent).toContain('#215');

    window.dispatchEvent(new Event('pagehide'));
    const key = Object.keys(localStorage).find(key => key.startsWith('boite.pull-requests.v1:'))!;
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ pullRequest: fresh });
  } finally {
    finishAuto(stale);
    finishManual(fresh);
    contextMenu.close();
    await unmount(card);
  }
});

test('removing a linked PR lets both views discover its replacement in the same millisecond', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch && thread.branch !== 'HEAD' && thread.status === 'idle')!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  await store.open(thread.id);
  const url = 'https://github.com/example/repo/pull/410';
  const [linked] = await client.call('threads.linkPullRequest', { threadId: thread.id, url });
  const replacement = { number: 411, url: 'https://github.com/example/repo/pull/411', state: 'OPEN' as const };
  const lookup = vi.fn().mockResolvedValueOnce(linked).mockResolvedValueOnce(replacement);
  const original = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation((method, params) =>
    method === 'threads.pullRequest' ? lookup(params) : original(method, params));
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  mounted = mount(ThreadHeader, { target: document.body, props: { store } });
  const card = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now } });
  try {
    await settle();
    expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#410');
    await client.call('threads.unlinkPullRequest', { threadId: thread.id, url });
    await settle();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect.soft(document.querySelector('[data-testid=thread-pr]')?.textContent ?? '').toContain('#411');

    document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
    document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger-menu] [data-value=more]')!.click(); await settle();
    expect.soft(document.querySelector('[data-testid=thread-menu-trigger-menu] [data-value=thread-pr]')?.textContent ?? '').toContain('#411');

    window.dispatchEvent(new Event('pagehide'));
    const key = Object.keys(localStorage).find(key => key.startsWith('boite.pull-requests.v1:'))!;
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ pullRequest: replacement });
  } finally {
    await unmount(card);
  }
});

test("a phone's header is back, the title, one menu of the thread's actions and the panel button; no panel in the menu, no contact requests", async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  mounted = mount(ThreadHeader, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector('[data-testid=thread-place]')?.closest('[data-testid=thread-menu-trigger]')).toBeNull();
  expect(document.querySelector('[data-testid=phone-browser-toggle]')).toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
  const menu = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  const values = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-value]')].map(node => node.dataset['value']);
  const rows = values(menu);
  // Find first (a phone has no Ctrl+F), the thread actions, the named group, then Delete.
  expect(menu.querySelectorAll('.section')).toHaveLength(0);
  expect(rows[0]).toBe('find');
  // The made-again title beside Rename: both name the thread.
  expect(rows.indexOf('retitle')).toBe(rows.indexOf('rename') + 1);
  expect(rows.length).toBeLessThanOrEqual(9);
  expect(rows.at(-1)).toBe('delete');
  // The phone offers the ID up front and leaves Copy path to the desktop.
  expect(rows).toContain('more');
  expect(rows).toContain('copy-thread-id');
  expect(rows).not.toContain('copy');
  menu.querySelector<HTMLElement>('[data-value=more]')!.click(); await settle();
  expect(values(menu)).toEqual(expect.arrayContaining(['thread-pr', 'move']));
  expect(values(menu)).not.toContain('copy');
  for (const tool of ['phone-browser-toggle', 'changes', 'panel']) expect(rows).not.toContain(tool);
  for (const panel of ['changes', 'phone-browser-toggle', 'agents', 'panel', 'board', 'coordination']) expect(rows).not.toContain(panel);
  const list = menu;
  expect(list.textContent).not.toMatch(/contact/i);
  // The phone's way to the panels is the header's panel button, as on a desktop.
  const was = store.panelOpen;
  document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]')!.click(); await settle();
  expect(store.panelOpen).toBe(!was);
});

test("a desktop header's menu has find first, nine rows at most and names its group for what it holds, with no panel", async () => {
  await start();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
  const menu = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  expect(menu.querySelector('[data-value="kind:changes"]')).toBeNull();
  // Every row in view on a 900 px window: the default 360 px cap scrolled Delete out of sight.
  expect(parseFloat(menu.style.maxHeight)).toBeGreaterThan(360);
  // Find first, the thread actions, the named group, then Delete.
  const actions = [...menu.querySelectorAll<HTMLElement>('[data-value]')].map(node => node.dataset['value']);
  expect(actions[0]).toBe('find');
  expect(actions.length).toBeLessThanOrEqual(9);
  for (const id of ['find', 'rename', 'retitle', 'pin', 'copy-thread-id', 'done', 'archive']) expect(menu.querySelector(`[data-value="${id}"]`)).not.toBeNull();
  expect(actions.indexOf('retitle')).toBe(actions.indexOf('rename') + 1);
  const group = menu.querySelector<HTMLButtonElement>('[data-value="more"]');
  // Named for what it holds: no bot here, so the move and the folder.
  expect(group?.textContent?.trim()).toBe(strings.thread.manageNoBot);
  group!.click(); await settle();
  // The group swaps in place under a back row that keeps its name: the folder's rows, no title.
  const list = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  expect(list.querySelector('[data-value="back"]')?.textContent).toContain(strings.thread.manageNoBot);
  for (const id of ['back', 'move', 'copy']) expect(list.querySelector(`[data-value="${id}"]`)).not.toBeNull();
  for (const id of ['rename', 'retitle']) expect(list.querySelector(`[data-value="${id}"]`)).toBeNull();
  for (const id of ['kind:changes', 'agents', 'terminal-toggle', 'coordination']) expect(list.querySelector(`[data-value="${id}"]`)).toBeNull();
});

test("a desktop header's panel button is a glyph that opens the panel and closes it on the next click", async () => {
  await start();
  if (store.panelOpen) { store.togglePanel(); await settle(); }
  const door = () => document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]');
  // The glyph alone, its name in the tooltip: no word, no count, no chevron.
  expect(door()!.textContent?.trim()).toBe('');
  expect(door()!.querySelectorAll('svg')).toHaveLength(1);
  expect(door()!.title).toContain(strings.thread.panelHint);
  expect(door()!.getAttribute('aria-pressed')).toBe('false');
  door()!.click(); await settle();
  expect(store.panelOpen).toBe(true);
  // With the panel there and its switcher handed over, the header keeps the same toggle: no launcher opens from it.
  panelSwitch.name = 'Files'; panelSwitch.title = 'Files'; panelSwitch.glyph = Files;
  panelSwitch.items = () => [{ id: 'files', label: 'Files', active: true }];
  panelSwitch.pick = vi.fn();
  panelSwitch.door = PanelSwitcher;
  panelSwitch.store = store; await settle();
  expect(door()!.getAttribute('aria-pressed')).toBe('true');
  door()!.click(); await settle();
  expect(document.querySelector('[data-testid=panel-add-menu]')).toBeNull();
  expect(store.panelOpen).toBe(false);
  expect(door()!.getAttribute('aria-pressed')).toBe('false');
  panelSwitch.store = null; panelSwitch.door = null;
  expect(document.querySelector('[data-testid=terminal-toggle]')).toBeNull();
  expect(document.querySelector('[data-testid=board-toggle]')).toBeNull();
});

test("a desktop header names its place, project then title, and the project brings the thread list back", async () => {
  await start();
  const crumb = document.querySelector<HTMLButtonElement>('[data-testid=thread-project-crumb]')!;
  expect(crumb.textContent?.trim()).toBeTruthy();
  expect(crumb.compareDocumentPosition(document.querySelector('[data-testid=thread-title]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  store.sidebarCollapsed = true;
  crumb.click(); await settle();
  expect(store.sidebarCollapsed).toBe(false);
});
