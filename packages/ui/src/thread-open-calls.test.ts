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

/** Resolves once no call has started or been pending for 300 ms: a fixed wait let a slow machine's late reads of the first open land in the measured one. */
async function quiet(calls: { last: number; pending: number }): Promise<void> {
  await waitFor(() => calls.pending === 0 && Date.now() - calls.last >= 300, 10_000);
}

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
  const client = store.client!;
  const asked: string[] = [];
  const calls = { last: Date.now(), pending: 0 };
  const call = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => {
    asked.push(method);
    calls.last = Date.now();
    calls.pending++;
    const settled = () => { calls.pending--; calls.last = Date.now(); };
    const result = call(method as never, params as never);
    result.then(settled, settled);
    return result;
  }) as typeof client.call);
  await workspace.select(store, first!);
  await waitFor(() => store.openThread?.id === first);
  // The shared rows of each expanded project read once when their chunk arrives: that is not the open measured below.
  await sharedProjectThreads.load();
  await quiet(calls);

  asked.length = 0;
  await workspace.select(store, second!);
  await waitFor(() => store.openThread?.id === second && store.openThread?.messages !== undefined);
  await quiet(calls);

  const counts = Object.fromEntries([...new Set(asked)].map((method) => [method, asked.filter((name) => name === method).length]));
  const twice = Object.entries(counts).filter(([, count]) => count > 1);
  expect({ counts, twice }).toMatchObject({ twice: [] });
});
