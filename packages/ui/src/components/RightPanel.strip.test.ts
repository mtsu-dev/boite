/*
 * The panel's strip shows the open panels, all alike, as glyphs, then the "+"
 * launcher to every panel and tool; the header's glyph opens and closes the panel.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { rightPanel } from '../lib/right-panel.svelte';
import { Store } from '../lib/store.svelte';
import { offeredCards } from '../lib/surface-labels';
import { work } from '../lib/work-prefs.svelte';
import { closeCoordination, coordinationRequest } from '../lib/coordination-request.svelte';
import RightPanel from './RightPanel.svelte';
import PanelDoor from './PanelDoor.svelte';

let app: ReturnType<typeof mount> | undefined, door: ReturnType<typeof mount> | undefined, store: Store, client: FakeClient;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
/** The panel beside the header's door, as the thread's header holds it. */
const mountPanel = () => {
  door = mount(PanelDoor, { target: document.body, props: { store, count: store.panel.surfaces.length, ontoggle: () => store.togglePanel(), testid: 'panel-toggle' } });
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
};

beforeEach(() => { localStorage.clear(); rightPanel.load(); work.load(); });
afterEach(async () => {
  if (app) await unmount(app); app = undefined;
  if (door) await unmount(door); door = undefined;
  store?.detach(); client?.close(); document.body.innerHTML = '';
});

test('the strip\'s + launcher switches the panel: every panel in one scroll, the recent ones first, a pick that lands and stays, an open kind gone back to', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  expect(store.openProject?.repository).toBe(true);
  store.panel.closeAll();
  store.panel.openFiles();
  mountPanel();
  await settle();

  // One treatment: every tab in the strip is an open panel's glyph, the "+" after them; the header keeps its toggle, pressed.
  expect(document.querySelectorAll('[data-testid=panel-tabs] .tab:not([data-testid=panel-tab])')).toHaveLength(0);
  const selector = () => query<HTMLButtonElement>('[data-testid=panel-add]')!;
  const head = query('[data-testid=panel-titlebar]')!;
  expect(head.contains(selector())).toBe(true);
  expect(query('[data-testid=panel-toggle]')?.getAttribute('aria-pressed')).toBe('true');
  selector().click(); await settle();
  const listed = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [data-value]')).map((row) => row.dataset['value']);
  const sections = () => Array.from(document.querySelectorAll('[data-testid=panel-add-menu] .section')).map((one) => one.textContent);
  // One list: the open Files leads as the panel used last, then every kind once in its family, the coordination,
  // the way to hide some. The window's switches and the close are the strip's own buttons. No row to more panels.
  expect(listed()[0]).toBe('files');
  for (const card of offeredCards()) expect(listed().filter((id) => id === card.kind)).toHaveLength(1);
  expect(listed()).toEqual(expect.arrayContaining(['changes', 'coordination', 'customize']));
  expect(listed()).not.toContain('all-panels');
  expect(listed()).not.toContain('panel-maximize');
  expect(listed()).not.toContain('panel-hide');
  expect(new Set(listed()).size).toBe(listed().length);
  expect(sections()).toEqual(['Used in this thread', 'Work', 'Agents', 'Tools']);
  expect(query('[data-testid=panel-add-menu] [data-value=files]')?.classList.contains('active')).toBe(true);
  expect(query('[data-testid=panel-add-menu] [data-value=files] .check')).not.toBeNull();

  // The pick lands: its click does not bubble into the old tab and bring it back.
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
  expect(query('[data-testid=panel-tab][data-kind=changes]')?.getAttribute('aria-selected')).toBe('true');
  expect(query('[data-testid=panel-tab][data-kind=files]')).not.toBeNull();

  // An open kind picked again is gone back to, not opened a second time; the recent ones lead, newest first.
  selector().click(); await settle();
  expect(listed().slice(0, 2)).toEqual(['changes', 'files']);
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=files]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('files');
  expect(document.querySelectorAll('[data-testid=panel-tab][data-kind=files]')).toHaveLength(1);

  // The thread links open from the same list.
  selector().click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=coordination]')!.click(); await settle();
  expect([coordinationRequest.store === store, coordinationRequest.threadId]).toEqual([true, 't-trace']);
  closeCoordination();

  // The header's glyph closes the panel on its second click.
  query<HTMLButtonElement>('[data-testid=panel-toggle]')!.click(); await settle();
  expect(store.panelOpen).toBe(false);
  expect(query('[data-testid=panel-toggle]')?.getAttribute('aria-pressed')).toBe('false');
});

test('the launcher finds a panel by its name or its line: Enter opens the first, the arrows walk the rows, Escape closes', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  store.panel.openChanges();
  mountPanel();
  await settle();
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  const field = query<HTMLInputElement>('[data-testid=panel-add-menu] [data-testid=panel-find]')!;
  // The search comes first and holds the keys.
  expect(document.activeElement).toBe(field);
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [data-row]')).map((row) => row.dataset['value']);
  const type = (text: string) => { field.value = text; field.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (key: string) => (document.activeElement ?? field).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  // A word of its line finds a panel whose name does not say it.
  type('programs'); await settle();
  expect(rows()).toEqual(['trace']);
  type('zzz'); await settle();
  expect(rows()).toEqual([]);
  expect(query('[data-testid=panel-find-none]')).not.toBeNull();
  type('files'); await settle();
  expect(rows()[0]).toBe('files');
  // The arrows leave the field for the rows and come back up to it.
  key('ArrowDown'); await settle();
  expect((document.activeElement as HTMLElement).dataset['value']).toBe('files');
  key('ArrowUp'); await settle();
  expect(document.activeElement).toBe(field);
  key('Enter'); await settle();
  expect(store.panel.active?.kind).toBe('files');
  expect(query('[data-testid=panel-add-menu]:not(.closing)')).toBeNull();
  // Escape closes the launcher and gives the keys back to the door.
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  key('Escape'); await settle();
  expect(query('[data-testid=panel-add-menu]:not(.closing)')).toBeNull();
  expect(document.activeElement).toBe(query('[data-testid=panel-add]'));
});

// A panel switch moves the body only: the head and its selector stay where they were.
test('a panel switch slides the body in and keeps the head still', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  store.panel.openChanges();
  mountPanel();
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20)); await settle();
  store.panel.openFiles(); await settle();
  expect(query('.surface[data-arriving]')).not.toBeNull();
  expect(query('[data-testid=panel-titlebar] [data-arriving]')).toBeNull();
});

test('an empty panel keeps its + launcher', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  // A panel set to open on its cards opens empty.
  work.setPanel('launcher');
  store.togglePanel();
  mountPanel();
  await settle();
  expect(store.panelOpen).toBe(true);
  expect(document.querySelectorAll('[data-testid=panel-tab]')).toHaveLength(0);
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
});

// The panel has one head: it says what the showing surface holds, then that surface's actions, then the
// window's maximize and the close, last.
test('the panel head says what the surface holds and carries its actions, then maximize and the close last', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  store.panel.openChanges();
  mountPanel();
  await settle();
  const head = query('[data-testid=panel-titlebar]')!;
  await vi.waitFor(() => expect(head.querySelector('[data-testid=changes-count]')).not.toBeNull());
  // Its words are the content's, never the panel's name a second time.
  expect(head.querySelector('[data-testid=panel-surface-head]')?.textContent).not.toContain('Changes');
  expect(head.querySelector('[data-testid=changes-refresh]')).not.toBeNull();
  expect(query('[data-testid=changes-panel] .panel-toolbar')).toBeNull();
  const controls = Array.from(head.querySelectorAll<HTMLElement>('button')).filter((one) => !one.closest('[data-testid=panel-tab]'));
  expect(controls.at(-1)?.dataset.testid).toBe('panel-close');
  // Every action there is named, by its words or its tooltip.
  for (const one of controls) expect(one.getAttribute('aria-label') || one.textContent?.trim() || one.title).toBeTruthy();
  expect(controls.at(-2)?.dataset.testid).toBe('panel-maximize');
  query<HTMLButtonElement>('[data-testid=panel-titlebar] [data-testid=panel-maximize]')!.click(); await settle();
  expect(rightPanel.maximized).toBe(true);
  rightPanel.maximized = false;
  store.panel.openFiles(); await settle();
  expect(query('[data-testid=changes-refresh]')).toBeNull();
  await vi.waitFor(() => expect(head.querySelector('[data-testid=files-refresh]')).not.toBeNull());
});
