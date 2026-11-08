/*
 * The panel's strip shows the open panels, all alike, and keeps every other
 * kind behind More panels, so each stays one or two presses away and none is
 * listed twice.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { rightPanel } from '../lib/right-panel.svelte';
import { Store } from '../lib/store.svelte';
import { offeredCards } from '../lib/surface-labels';
import { work } from '../lib/work-prefs.svelte';
import RightPanel from './RightPanel.svelte';

let app: ReturnType<typeof mount> | undefined, store: Store, client: FakeClient;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

beforeEach(() => { localStorage.clear(); rightPanel.load(); work.load(); });
afterEach(async () => {
  if (app) await unmount(app); app = undefined;
  store?.detach(); client?.close(); document.body.innerHTML = '';
});

test('the strip offers no tab that is not open, and More panels lists every other kind once', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  expect(store.openProject?.repository).toBe(true);
  store.panel.closeAll();
  store.panel.openFiles();
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
  await settle();

  // One treatment: every tab in the strip is an open panel.
  expect(document.querySelectorAll('[data-testid=panel-tabs] .tab:not([data-testid=panel-tab])')).toHaveLength(0);
  expect(query('[data-testid=panel-add]')?.textContent).toContain('More panels');
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  const listed = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [data-value]')).map((row) => row.dataset['value']);
  // Every kind is reachable: a tab or a row behind More panels, exactly one of them.
  const open = (kind: string) => document.querySelector(`[data-testid=panel-tab][data-kind=${kind}]`) !== null;
  for (const card of offeredCards()) expect([listed.includes(card.kind), open(card.kind)].filter(Boolean)).toHaveLength(1);
  query<HTMLButtonElement>('[data-testid=panel-add-menu] [data-value=changes]')!.click(); await settle();
  expect(store.panel.active?.kind).toBe('changes');
  // Open now, it is a tab like the others and no longer listed.
  expect(query('[data-testid=panel-tab][data-kind=changes]')).not.toBeNull();
  query<HTMLButtonElement>('[data-testid=panel-add]')!.click(); await settle();
  expect(document.querySelector('[data-testid=panel-add-menu] [data-value=changes]')).toBeNull();
});
