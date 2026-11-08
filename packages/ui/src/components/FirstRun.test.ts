import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { strings } from '../lib/strings';
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

test('a first run lists the agents as rows that each connect in one click, then the whole list, and offers another machine quietly', async () => {
  store = new Store();
  store.attach(new FakeClient({ delayMs: 0, uninstalled: true }));
  await store.connect();
  mounted = mount(FirstRun, { target: document.body, props: { store } });
  flushSync();

  // A visible path: three numbered steps, the first the one to take now, with the agents as its buttons.
  const steps = [...document.querySelectorAll<HTMLElement>('[data-testid="first-run-steps"] > .step')];
  expect(steps.map((step) => step.textContent!.replace(/^\d/, '').trim())).toEqual([strings.firstRun.stepConnect, strings.firstRun.stepProject, strings.firstRun.stepTask]);
  expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual(['step', null, null]);
  expect(steps[0]!.nextElementSibling!.querySelectorAll('[data-testid="first-run-agent"]').length).toBe(rows().length);

  // The two services most people pay for first, each row its own button: no choice to make, then a second action.
  expect(rows().map((row) => row.dataset.provider)).toEqual(['claude', 'codex']);
  expect(rows().some((row) => row.hasAttribute('aria-checked'))).toBe(false);
  rows()[1]!.click();
  expect(store.connectDialog).toEqual({ providerId: 'codex', accountId: null });
  store.closeConnect();

  // The last row opens the whole list; it is the screen's only other connect action.
  const others = query<HTMLButtonElement>('[data-testid="first-run-connect"]');
  expect(others.textContent!.trim()).toBe(strings.firstRun.others);
  expect(others.closest('.agents')).not.toBeNull();
  others.click();
  expect(store.connectDialog).toEqual({ providerId: null, accountId: null });
  store.closeConnect();
  expect(document.querySelectorAll('button.primary')).toHaveLength(0);

  query<HTMLButtonElement>('[data-testid="first-run-other-machine"]').click();
  expect([store.page, store.settingsTab]).toEqual(['settings', 'machines']);
});
