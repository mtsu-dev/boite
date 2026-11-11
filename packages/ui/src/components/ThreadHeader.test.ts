import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import ThreadHeader from './ThreadHeader.svelte';
import { strings } from '../lib/strings';
import { panelSwitch } from '../lib/panel-switch.svelte';
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
  // Find first (a phone has no Ctrl+F), the frequent actions, the named group, then Delete: eight rows at most, no section of panels.
  expect(menu.querySelectorAll('.section')).toHaveLength(0);
  expect(rows[0]).toBe('find');
  // The made-again title beside Rename: both name the thread.
  expect(rows.indexOf('retitle')).toBe(rows.indexOf('rename') + 1);
  expect(rows.length).toBeLessThanOrEqual(8);
  expect(rows.at(-1)).toBe('delete');
  // No bot to give it to and no path on a phone: the folder group holds the thread's pull request and the move, never a copy.
  expect(rows).toContain('more');
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

test("a desktop header's menu has find first, eight rows at most and names its group for what it holds, with no panel", async () => {
  await start();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
  const menu = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  expect(menu.querySelector('[data-value="kind:changes"]')).toBeNull();
  // Every row in view on a 900 px window: the default 360 px cap scrolled Delete out of sight.
  expect(parseFloat(menu.style.maxHeight)).toBeGreaterThan(360);
  // Find first, the frequent actions, the named group, then Delete: eight rows at most.
  const actions = [...menu.querySelectorAll<HTMLElement>('[data-value]')].map(node => node.dataset['value']);
  expect(actions[0]).toBe('find');
  expect(actions.length).toBeLessThanOrEqual(8);
  for (const id of ['find', 'rename', 'retitle', 'pin', 'done', 'archive']) expect(menu.querySelector(`[data-value="${id}"]`)).not.toBeNull();
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

test("a desktop header's door reads Panels, then names the open panel and switches it", async () => {
  await start();
  // A door with its name, not a glyph to guess: "Panels" while none shows, and a tooltip that says what panels are.
  if (store.panelOpen) { store.togglePanel(); await settle(); }
  const door = () => document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]');
  expect(door()!.textContent?.trim()).toBe(strings.thread.panelMenu);
  expect(door()!.title).toContain(strings.thread.panelHint);
  expect(door()!.querySelector('[data-testid=panel-toggle-count]')).toBeNull();
  // Open with the panel still loading: pressed, named later.
  store.panel.openChanges(); store.panel.open('files'); await settle();
  expect(store.panelOpen).toBe(true);
  expect(door()!.getAttribute('aria-pressed')).toBe('true');
  // The panel says what shows: the door names it, its icon, its name and a chevron, and its list switches it.
  const pick = vi.fn();
  panelSwitch.name = 'Files'; panelSwitch.title = 'Files'; panelSwitch.glyph = Files;
  panelSwitch.items = () => [{ id: 'changes', label: 'Changes' }, { id: 'files', label: 'Files', active: true }];
  panelSwitch.pick = pick;
  panelSwitch.door = PanelSwitcher;
  panelSwitch.store = store; await settle();
  expect(door()).toBeNull();
  const named = document.querySelector<HTMLButtonElement>('[data-testid=panel-add]')!;
  expect(named.textContent?.trim()).toBe('Files');
  expect(named.querySelectorAll('svg')).toHaveLength(2);
  expect(named.getAttribute('aria-label')).toContain('Files');
  named.click(); await settle();
  expect(document.querySelector('[data-testid=panel-add-menu] [data-value=files] .check')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(pick).toHaveBeenCalledWith('changes');
  // Another machine's panel leaves this header's door plain.
  panelSwitch.store = new Store(); await settle();
  expect(door()!.getAttribute('aria-pressed')).toBe('true');
  panelSwitch.store = null; panelSwitch.door = null;
  // Closed, it is the door again, with what it holds.
  store.togglePanel(); await settle();
  expect(door()!.getAttribute('aria-pressed')).toBe('false');
  expect(door()!.textContent).toContain(strings.thread.panelMenu);
  expect(door()!.querySelector('[data-testid=panel-toggle-count]')?.textContent).toBe('2');
  expect(document.querySelector('[data-testid=terminal-toggle]')).toBeNull();
  expect(document.querySelector('[data-testid=board-toggle]')).toBeNull();
  expect(document.querySelector('[data-testid=panel-menu]')).toBeNull();
  door()!.click(); await settle();
  expect(store.panelOpen).toBe(true);
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
