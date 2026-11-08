import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import ThreadHeader from './ThreadHeader.svelte';
import { strings } from '../lib/strings';

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
  // Find first (a phone has no Ctrl+F), the frequent actions, the named group, then Delete: seven rows at most, no section of panels.
  expect(menu.querySelectorAll('.section')).toHaveLength(0);
  expect(rows[0]).toBe('find');
  expect(rows).toContain('rename');
  expect(rows.length).toBeLessThanOrEqual(7);
  expect(rows.at(-1)).toBe('delete');
  // The rest opens in the same sheet, under its way back, and the way back returns.
  menu.querySelector<HTMLButtonElement>('[data-value="more"]')!.click(); await settle();
  const group = values(document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!);
  expect(group[0]).toBe('back');
  expect(group).toContain('retitle');
  expect(group).not.toContain('copy');
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger-menu] [data-value="back"]')!.click(); await settle();
  expect(values(document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!)).toEqual(rows);
  for (const tool of ['phone-browser-toggle', 'changes', 'panel']) expect(rows).not.toContain(tool);
  for (const panel of ['changes', 'phone-browser-toggle', 'agents', 'panel', 'board', 'coordination']) expect(rows).not.toContain(panel);
  const list = menu;
  expect(list.textContent).not.toMatch(/contact/i);
  // The phone's way to the panels is the header's panel button, as on a desktop.
  const was = store.panelOpen;
  document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]')!.click(); await settle();
  expect(store.panelOpen).toBe(!was);
});

test("a desktop header's menu has find first, seven rows at most and names its group for what it holds, with no panel", async () => {
  await start();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger]')!.click(); await settle();
  const menu = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  expect(menu.querySelector('[data-value="kind:changes"]')).toBeNull();
  // Every row in view on a 900 px window: the default 360 px cap scrolled Delete out of sight.
  expect(parseFloat(menu.style.maxHeight)).toBeGreaterThan(360);
  // Find first, the frequent actions, the named group, then Delete: seven rows at most.
  const actions = [...menu.querySelectorAll<HTMLElement>('[data-value]')].map(node => node.dataset['value']);
  expect(actions[0]).toBe('find');
  expect(actions.length).toBeLessThanOrEqual(7);
  for (const id of ['find', 'rename', 'pin', 'done', 'archive']) expect(menu.querySelector(`[data-value="${id}"]`)).not.toBeNull();
  const group = menu.querySelector<HTMLButtonElement>('[data-value="more"]');
  expect(group?.textContent).toContain(strings.thread.manage);
  group!.click(); await settle();
  // The group swaps in place: what the thread is first (its branch), then the rest.
  const list = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  for (const id of ['back', 'retitle', 'move', 'copy']) expect(list.querySelector(`[data-value="${id}"]`)).not.toBeNull();
  expect(list.querySelector('[data-value="rename"]')).toBeNull();
  for (const id of ['kind:changes', 'agents', 'terminal-toggle', 'coordination']) expect(list.querySelector(`[data-value="${id}"]`)).toBeNull();
});

test("a desktop header's panel button shows and hides the panel, with no list of its own beside it", async () => {
  await start();
  expect(document.querySelector('[data-testid=terminal-toggle]')).toBeNull();
  expect(document.querySelector('[data-testid=board-toggle]')).toBeNull();
  // Its chevron's list moved into the panel, as the panel selector.
  expect(document.querySelector('[data-testid=panel-menu]')).toBeNull();
  const was = store.panelOpen;
  document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]')!.click(); await settle();
  expect(store.panelOpen).toBe(!was);
  document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]')!.click(); await settle();
  expect(store.panelOpen).toBe(was);
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
