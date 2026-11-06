/*
 * A phone shows one panel surface at a time, and its header's list is the only
 * way to the others: every open tab stays in it, a kind put away in Appearance
 * after it opened included.
 */
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { rightPanel } from '../lib/right-panel.svelte';
import { Store } from '../lib/store.svelte';
import { work } from '../lib/work-prefs.svelte';
import RightPanel from './RightPanel.svelte';

let app: ReturnType<typeof mount> | undefined, store: Store | undefined, client: FakeClient | undefined;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };

afterEach(async () => {
  if (app) await unmount(app); app = undefined;
  store?.detach(); client?.close();
  vi.restoreAllMocks(); document.body.innerHTML = '';
  localStorage.clear(); rightPanel.load(); work.load();
});

test('an open tab whose kind was put away stays in the phone picker', async () => {
  localStorage.clear(); rightPanel.load(); work.load(); work.setPanel('launcher');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
  await settle();

  const changes = store.panel.open('changes');
  work.show('panel.changes', false);
  // Another tab comes in front: the hidden kind's tab is still open behind it.
  store.panel.open('trace'); await settle();
  expect(store.panel.surfaces.some(surface => surface.id === changes.id)).toBe(true);

  document.querySelector<HTMLButtonElement>('[data-testid=panel-picker]')!.click(); await settle();
  const row = document.querySelector<HTMLButtonElement>(`[data-testid=panel-picker-menu] [data-value="surface:${changes.id}"]`);
  expect(row).not.toBeNull();
  // The list's own row for the kind stays put away.
  expect(document.querySelector('[data-testid=panel-picker-menu] [data-value=changes]')).toBeNull();
  row!.click(); await settle();
  expect(store.panel.active?.id).toBe(changes.id);
});
