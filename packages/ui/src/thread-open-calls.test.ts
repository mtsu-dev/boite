import { afterEach, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import { store } from './lib/store.svelte';
import { sharedProjectThreads } from './lib/deferred-parts';
import { workspace } from './lib/workspace.svelte';
import { closeTour } from './lib/onboarding.svelte';

/*
 * What one click on a conversation asks the core, from the whole app over the
 * in-memory fake. Measured on a copy of a working journal (2026-11-15, CPU
 * slowed four times): each click asked for the panel's agents, workflows,
 * agent browser and devices twice, once for the row the click drew and again
 * when the full conversation replaced it, so the second round queued behind
 * the first on a phone's link.
 */

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn(async (_url: string) => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

let running: Record<string, unknown> | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  window.localStorage.clear();
  workspace.view = 'projects';
});

async function waitFor(check: () => boolean, attempts = 2000): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('gave up waiting');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test('opening a conversation asks the core once for each thing the panel and the watchers read', async () => {
  window.history.replaceState(null, '', '/?fake=1&open=recent');
  const target = document.createElement('div');
  document.body.appendChild(target);
  store.booted = false;
  store.openThread = null;
  store.draft = null;
  store.page = 'chat';
  store.composerStates = {};
  closeTour();
  running = mount(App, { target });
  await waitFor(() => store.booted && (store.openThread !== null || store.draft !== null));
  workspace.view = 'projects';
  const ids = (await store.client!.call('threads.list', {})).filter((thread) => !thread.parentThreadId && !thread.archived).map((thread) => thread.id);
  const [first, second] = ids.filter((id) => id !== store.openThread?.id);
  await workspace.select(store, first!);
  await waitFor(() => store.openThread?.id === first);
  // The shared rows of each expanded project read once when their chunk arrives: that is not the open measured below.
  await sharedProjectThreads.load();
  // The app can still be loading the sidebar and chat after the store has booted.
  await waitFor(() => target.querySelector('[data-testid="project-row"]') !== null
    && target.querySelector('[data-testid="thread-header"]') !== null);
  await settle();

  const client = store.client!;
  const asked: string[] = [];
  const call = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => {
    asked.push(method);
    return call(method as never, params as never);
  }) as typeof client.call);
  await workspace.select(store, second!);
  await waitFor(() => store.openThread?.id === second && store.openThread?.messages !== undefined);
  await settle();

  const counts = Object.fromEntries([...new Set(asked)].map((method) => [method, asked.filter((name) => name === method).length]));
  const twice = Object.entries(counts).filter(([, count]) => count > 1);
  expect({ counts, twice }).toMatchObject({ twice: [] });
});
