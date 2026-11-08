import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import MachineStatus from './MachineStatus.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  document.body.innerHTML = '';
});

test('the rail folds the limits into the machine menu: one button even with one machine, the glance one row of it', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  // With no limits to show, one connected machine says nothing.
  mounted = mount(MachineStatus, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector('[data-testid=status-connection]')?.getAttribute('data-state')).toBe('ready');
  expect(document.querySelector('[data-testid=machine-status]')).toBeNull();
  await unmount(mounted);

  const limits = vi.fn();
  mounted = mount(MachineStatus, { target: document.body, props: { store, limits } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=machine-status]')!.click();
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=machine-status-menu] [data-row]')].map(row => row.dataset.value);
  expect(rows).toEqual(['limits', 'manage']);
  // The row keeps the test id of the gauge button it replaced.
  document.querySelector<HTMLElement>('[data-testid=machine-status-menu] [data-testid=nav-limits]')!.click();
  expect(limits).toHaveBeenCalledOnce();
});

test('with limits read, the rail button wears the lowest window as a figure and names it in its tooltip', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  mounted = mount(MachineStatus, { target: document.body, props: { store, limits: () => {}, meter: { left: 12, tone: 'low', account: 'Home', window: 'Weekly' } } });
  await settle();
  const gauge = document.querySelector<HTMLElement>('[data-testid=limits-gauge]')!;
  expect(gauge.dataset.left).toBe('12');
  expect(gauge.classList.contains('low')).toBe(true);
  expect(gauge.textContent?.trim()).toBe('12');
  const button = document.querySelector<HTMLElement>('[data-testid=machine-status]')!;
  expect(button.getAttribute('aria-label') ?? button.title).toContain('12% left: Weekly, Home');
});
