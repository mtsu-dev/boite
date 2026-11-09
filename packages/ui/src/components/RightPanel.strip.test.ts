/*
 * The panel's strip shows the open panels, all alike, as glyphs; the header's
 * door names the showing one and is the panel switcher, the one door to every
 * panel and tool.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
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

test('the header door names the showing panel and switches it: every panel in one scroll, the recent ones first, a pick that lands and stays, an open kind gone back to', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  expect(store.openProject?.repository).toBe(true);
  store.panel.closeAll();
  store.panel.openFiles();
  mountPanel();
  await settle();

  // One treatment: every tab in the strip is an open panel's glyph; the door outside the panel says the showing one's name, once.
  expect(document.querySelectorAll('[data-testid=panel-tabs] .tab:not([data-testid=panel-tab])')).toHaveLength(0);
  const selector = () => query<HTMLButtonElement>('[data-testid=panel-add]')!;
  const head = query('[data-testid=panel-titlebar]')!;
  expect(head.contains(selector())).toBe(false);
  expect(selector().textContent?.trim()).toBe('Files');
  expect(head.querySelector('[data-testid=panel-add], [data-testid=panel-title]')).toBeNull();
  expect(query('[data-testid=panel-toggle]')).toBeNull();
  selector().click(); await settle();
  const listed = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [data-value]')).map((row) => row.dataset['value']);
  const sections = () => Array.from(document.querySelectorAll('[data-testid=panel-add-menu] .section')).map((one) => one.textContent);
  // One list: the open Files leads as the panel used last, then every kind once in its family, the coordination,
  // the way to hide some, the window's switch, then the way to close it. No row to more panels.
  expect(listed()[0]).toBe('files');
  for (const card of offeredCards()) expect(listed().filter((id) => id === card.kind)).toHaveLength(1);
  expect(listed()).toEqual(expect.arrayContaining(['changes', 'coordination', 'customize']));
  expect(listed()).not.toContain('all-panels');
  expect(listed().slice(-2)).toEqual(['panel-maximize', 'panel-hide']);
  expect(new Set(listed()).size).toBe(listed().length);
  expect(sections()).toEqual(['Recent', 'Work', 'Agents', 'Tools']);
  expect(query('[data-testid=panel-add-menu] [data-value=files]')?.classList.contains('active')).toBe(true);
  expect(query('[data-testid=panel-add-menu] [data-value=files] .check')).not.toBeNull();

  // The pick lands: its click does not bubble into the old tab and bring it back.
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
  expect(selector().textContent?.trim()).toBe('Changes');
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

  // The list's last row closes the panel; the door reads "Panels" again and holds the focus.
  selector().click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-testid=panel-hide]')!.click(); await settle();
  expect(store.panelOpen).toBe(false);
  expect(query('[data-testid=panel-toggle]')?.textContent).toContain('Panels');
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

test('an empty panel keeps the door as its switcher, named Panels', async () => {
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
  expect(query('[data-testid=panel-add]')?.textContent?.trim()).toBe('Panels');
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
});

// The head held the Changes bar, a maximize and a dock beside the tabs: it now holds the tabs and the close,
// the bar is the body's own first line and the window's switches are rows of the door's list.
test('the panel head holds the tabs and the close only: refresh in the body, maximize in the switcher', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  store.panel.openChanges();
  mountPanel();
  await settle();
  const head = query('[data-testid=panel-titlebar]')!;
  const controls = Array.from(head.querySelectorAll<HTMLElement>('button')).filter((one) => !one.closest('[data-testid=panel-tab]'));
  expect(controls.map((one) => one.dataset.testid)).toEqual(['panel-close']);
  expect(head.querySelector('[data-testid=changes-refresh]')).toBeNull();
  expect(query('[data-testid=changes-panel] > .panel-toolbar [data-testid=changes-refresh]')).not.toBeNull();
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-testid=panel-maximize]')!.click(); await settle();
  expect(rightPanel.maximized).toBe(true);
  rightPanel.maximized = false;
  store.panel.openFiles(); await settle();
  expect(query('[data-testid=changes-refresh]')).toBeNull();
});
