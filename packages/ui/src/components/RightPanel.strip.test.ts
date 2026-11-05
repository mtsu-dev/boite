import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { rightPanel } from '../lib/right-panel.svelte';
import { Store } from '../lib/store.svelte';
import { work } from '../lib/work-prefs.svelte';
import RightPanel from './RightPanel.svelte';

let app: ReturnType<typeof mount> | undefined, store: Store, client: FakeClient | undefined;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
const kinds = () => [...document.querySelectorAll<HTMLElement>('[data-testid=panel-tabs] [role=tab]')].map((tab) => tab.dataset.kind ?? tab.dataset.testid);
/** Buttons pressed or not beside the tablist: only Maximize, the drawers live in More. */
const drawers = () => [...document.querySelectorAll<HTMLElement>('[data-testid=panel-titlebar] [aria-pressed]:not([data-testid=panel-maximize])')].map((button) => button.dataset.testid);
const more = () => [...document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [data-value]')].map((row) => row.dataset.value);

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  localStorage.clear(); rightPanel.load(); work.load(); work.setPanel('launcher'); work.showPreset('developer');
});

afterEach(async () => {
  if (app) await unmount(app); app = undefined;
  store?.detach(); client?.close(); client = undefined;
  vi.restoreAllMocks(); document.body.innerHTML = '';
  localStorage.clear(); rightPanel.load(); work.load();
});

async function open(): Promise<void> {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-trace');
  store.panel.closeAll();
  app = mount(RightPanel, { target: document.body, props: { store, panel: store.panel, attach: () => ({ destroy() {} }), onexit() {} } });
  await settle();
}

test('the strip keeps one order, open or not, and leaves the drawers and the rest to More', async () => {
  await open();
  expect(kinds()).toEqual(['changes', 'files', 'agent-browser', 'tasks', 'agents']);
  expect(drawers()).toEqual([]);

  // Opening Tasks turns its button into the tab, in the same place.
  document.querySelector<HTMLButtonElement>('[data-testid=panel-kind][data-kind=tasks]')!.click();
  await settle();
  expect(kinds()).toEqual(['changes', 'files', 'agent-browser', 'tasks', 'agents']);
  expect(document.querySelector('[data-testid=panel-tab][data-kind=tasks]')?.getAttribute('aria-selected')).toBe('true');

  // More offers the drawers and what the strip does not show, never a kind it already shows.
  document.querySelector<HTMLButtonElement>('[data-testid=panel-add]')!.click();
  await settle();
  expect(more().slice(0, 2)).toEqual(['terminal', 'board']);
  expect(more()).toContain('trace');
  expect(more()).toContain('messages');
  for (const kind of ['changes', 'files', 'agent-browser', 'tasks', 'agents']) expect(more()).not.toContain(kind);

  // The terminal still opens its drawer under the chat, from More now.
  document.querySelector<HTMLElement>('[data-testid=panel-add-menu] [data-value=terminal]')!.click();
  await settle();
  expect(store.terminalShown(store.openThread!.id)).toBe(true);
  expect(document.querySelectorAll('[data-testid=panel-close]').length).toBe(1);
});
