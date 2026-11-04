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
/** The drawer toggles sit beside the tablist, after it, as buttons that are pressed or not. */
const drawers = () => [...document.querySelectorAll<HTMLElement>('[data-testid=panel-titlebar] [aria-pressed]:not([data-testid=panel-maximize])')].map((button) => button.dataset.testid);

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

test('the strip keeps one order, open or not, holds the terminal and the board, and leaves the rest to More', async () => {
  await open();
  expect(kinds()).toEqual(['changes', 'files', 'agent-browser', 'tasks', 'agents']);
  expect(drawers()).toEqual(['terminal-toggle', 'board-toggle']);

  // Opening Tasks turns its button into the tab, in the same place.
  document.querySelector<HTMLButtonElement>('[data-testid=panel-kind][data-kind=tasks]')!.click();
  await settle();
  expect(kinds()).toEqual(['changes', 'files', 'agent-browser', 'tasks', 'agents']);
  expect(drawers()).toEqual(['terminal-toggle', 'board-toggle']);
  expect(document.querySelector('[data-testid=panel-tab][data-kind=tasks]')?.getAttribute('aria-selected')).toBe('true');

  // The terminal still opens its drawer under the chat, from here now.
  document.querySelector<HTMLButtonElement>('[data-testid=terminal-toggle]')!.click();
  await settle();
  expect(store.terminalShown(store.openThread!.id)).toBe(true);
  expect(document.querySelector('[data-testid=terminal-toggle]')?.getAttribute('aria-pressed')).toBe('true');

  // More offers what the strip does not show, never a kind it already shows.
  document.querySelector<HTMLButtonElement>('[data-testid=panel-add]')!.click();
  await settle();
  const more = [...document.querySelectorAll<HTMLElement>('[data-testid=panel-add-menu] [role=menuitem]')].map((row) => row.dataset.value);
  expect(more).toContain('trace');
  expect(more).toContain('messages');
  for (const kind of ['changes', 'files', 'agent-browser', 'tasks', 'agents']) expect(more).not.toContain(kind);
  expect(document.querySelectorAll('[data-testid=panel-close]').length).toBe(1);
});
