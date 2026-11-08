/*
 * The panel's strip shows the open panels, all alike; the active one's name
 * is the panel selector, the one door to every panel and tool.
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

let app: ReturnType<typeof mount> | undefined, store: Store, client: FakeClient;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

beforeEach(() => { localStorage.clear(); rightPanel.load(); work.load(); });
afterEach(async () => {
  if (app) await unmount(app); app = undefined;
  store?.detach(); client?.close(); document.body.innerHTML = '';
});

test('the active tab is the panel selector: the panels in use, every panel behind one row, a pick that lands and stays, an open kind gone back to', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  expect(store.openProject?.repository).toBe(true);
  store.panel.closeAll();
  store.panel.openFiles();
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
  await settle();

  // One treatment: every tab in the strip is an open panel, and the selector is the showing one's name.
  expect(document.querySelectorAll('[data-testid=panel-tabs] .tab:not([data-testid=panel-tab])')).toHaveLength(0);
  const selector = () => query<HTMLButtonElement>('[data-testid=panel-add]')!;
  expect(selector().closest('[data-testid=panel-tab]')?.getAttribute('data-kind')).toBe('files');
  expect(selector().textContent?.trim()).toBe('Files');
  selector().click(); await settle();
  const listed = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [data-value]')).map((row) => row.dataset['value']);
  // Short: the open Files and the thread's changes, one row to every panel, then the window's switch that left the head.
  expect(listed()).toEqual(['changes', 'files', 'all-panels', 'panel-maximize']);
  expect(query('[data-testid=panel-add-menu] [data-value=files]')?.classList.contains('active')).toBe(true);
  // "All panels" swaps the rows in place: every kind, open or not, once; the coordination and the way to hide some.
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=all-panels]')!.click(); await settle();
  expect(query('[data-testid=panel-add-menu]')).not.toBeNull();
  for (const card of offeredCards()) expect(listed().filter((id) => id === card.kind)).toHaveLength(1);
  expect(listed()).toEqual(expect.arrayContaining(['panels-in-use', 'coordination', 'customize']));
  expect(new Set(listed()).size).toBe(listed().length);
  expect(Array.from(document.querySelectorAll('[data-testid=panel-add-menu] .section')).map((one) => one.textContent)).toEqual(['Work', 'Agents', 'Tools']);

  // The pick lands: its click does not bubble into the old tab and bring it back.
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
  expect(selector().closest('[data-testid=panel-tab]')?.getAttribute('data-kind')).toBe('changes');
  expect(query('[data-testid=panel-tab][data-kind=files]')).not.toBeNull();

  // An open kind picked again is gone back to, not opened a second time.
  selector().click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=files]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('files');
  expect(document.querySelectorAll('[data-testid=panel-tab][data-kind=files]')).toHaveLength(1);

  // The list opens short again; the thread links open from the full one.
  selector().click(); await settle();
  expect(listed()).toContain('all-panels');
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=all-panels]')!.click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=coordination]')!.click(); await settle();
  expect([coordinationRequest.store === store, coordinationRequest.threadId]).toEqual([true, 't-trace']);
  closeCoordination();
});

test('an empty panel keeps the selector as its title', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
  await settle();
  expect(document.querySelectorAll('[data-testid=panel-tab]')).toHaveLength(0);
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
});

// The head held the Changes bar, a maximize and a dock beside the tabs: it now holds the selector and the close,
// the bar is the body's own first line and the window's switches are rows of the selector.
test('the panel head holds the selector and the close only: refresh in the body, maximize in the selector', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  store.panel.openChanges();
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
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
