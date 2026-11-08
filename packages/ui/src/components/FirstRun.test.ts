import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { fill, strings } from '../lib/strings';
import FirstRun from './FirstRun.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let store: Store | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.client?.close(); store?.detach(); store = undefined;
  document.body.innerHTML = '';
});

const query = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="first-run-agent"]')];

test('a first run lists the agents as one choice, acts on the picked one, and offers another machine quietly', async () => {
  store = new Store();
  store.attach(new FakeClient({ delayMs: 0, uninstalled: true }));
  await store.connect();
  mounted = mount(FirstRun, { target: document.body, props: { store } });
  flushSync();

  // The two services most people pay for first; nothing installed, so nothing is picked and the action opens the whole list.
  expect(rows().map((row) => row.dataset.provider)).toEqual(['claude', 'codex']);
  expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  const action = query<HTMLButtonElement>('[data-testid="first-run-connect"]');
  expect(action.textContent!.trim()).toBe(strings.connect.button);
  action.click();
  expect(store.connectDialog).toEqual({ providerId: null, accountId: null });
  store.closeConnect();

  // Picking a row names it on the one action, which opens the connection on it.
  rows()[1]!.click();
  flushSync();
  expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  expect(action.textContent!.trim()).toBe(fill(strings.firstRun.go, { provider: 'Codex' }));
  action.click();
  expect(store.connectDialog).toEqual({ providerId: 'codex', accountId: null });

  // Arrow keys move the choice, as in any radio group.
  rows()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  flushSync();
  expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false']);

  query<HTMLButtonElement>('[data-testid="first-run-other-machine"]').click();
  expect([store.page, store.settingsTab]).toEqual(['settings', 'machines']);
});
