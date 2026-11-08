import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import ThreadHeader from './ThreadHeader.svelte';

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

test("a phone's header is back, the title and one menu: the thread's tools, then the thread, with one browser entry and no contact requests", async () => {
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
  const sections = [...menu.querySelectorAll('.section')].map(node => node.textContent);
  expect(sections).toEqual(['Tools', 'This thread']);
  const rows = [...menu.children].map(node => (node as HTMLElement).dataset['value'] ?? node.textContent);
  // Tools before the thread's own actions: the browser once, rename and archive under the second heading.
  expect(rows.indexOf('phone-browser-toggle')).toBeLessThan(rows.indexOf('This thread'));
  expect(rows.indexOf('rename')).toBeGreaterThan(rows.indexOf('This thread'));
  // Six places at most before the thread's actions, "All tools" last for the rest, and no row twice.
  const tools = rows.slice(rows.indexOf('Tools') + 1, rows.indexOf('This thread'));
  expect(tools.length).toBeLessThanOrEqual(6);
  expect(tools.at(-1)).toBe('panel');
  const ids = rows.filter(row => row && !['Tools', 'This thread'].includes(row) && !/^sep-/.test(row));
  expect(new Set(ids).size).toBe(ids.length);
  expect(menu.textContent).not.toMatch(/contact/i);
  expect([...menu.querySelectorAll('[data-row]')].filter(row => row.textContent?.trim() === 'Browser')).toHaveLength(1);
  // The thread's actions group as a phone row's do: the rest waits behind All tools, with a way back.
  expect(rows.at(-1)).toBe('delete');
  expect(rows).toContain('more');
  expect(rows).not.toContain('retitle');
  menu.querySelector<HTMLButtonElement>('[data-value="more"]')!.click(); await settle();
  const toolRows = [...document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!.querySelectorAll<HTMLElement>('[data-value]')].map(node => node.dataset['value']);
  expect(toolRows.slice(0, 2)).toEqual(['back', 'retitle']);
  document.querySelector<HTMLButtonElement>('[data-testid=thread-menu-trigger-menu] [data-value="back"]')!.click(); await settle();
  const back = document.querySelector<HTMLElement>('[data-testid=thread-menu-trigger-menu]')!;
  back.querySelector<HTMLButtonElement>('[data-value="phone-browser-toggle"]')!.click(); await settle();
  expect([store.panelOpen, store.panel.active?.kind]).toEqual([true, 'agent-browser']);
});

test("a desktop header's panel button opens the panel and its list holds the panels, the terminal and the board", async () => {
  await start();
  expect(document.querySelector('[data-testid=terminal-toggle]')).toBeNull();
  expect(document.querySelector('[data-testid=board-toggle]')).toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=panel-menu]')!.click(); await settle();
  const menu = document.querySelector<HTMLElement>('[data-testid=panel-menu-menu]')!;
  expect(menu.querySelector('[data-value="kind:changes"]')).not.toBeNull();
  expect(menu.querySelector('[data-value="terminal-toggle"]')).not.toBeNull();
  menu.querySelector<HTMLButtonElement>('[data-value="kind:changes"]')!.click(); await settle();
  expect([store.panelOpen, store.panel.active?.kind]).toEqual([true, 'changes']);
  document.querySelector<HTMLButtonElement>('[data-testid=panel-toggle]')!.click(); await settle();
  expect(store.panelOpen).toBe(false);
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
