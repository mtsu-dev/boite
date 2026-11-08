import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import SettingDays from './SettingDays.svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';

let running: Record<string, unknown> | null = null;
const cleanups: (() => void)[] = [];

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
});

async function settle() { for (let i = 0; i < 6; i++) { flushSync(); await tick(); await new Promise(done => setTimeout(done, 0)); } }

test('a retention row saves on Enter or when left, with no Save button, and refuses a value out of range', async () => {
  const store = new Store(), client = new FakeClient({ delayMs: 0 });
  store.attach(client); await store.connect();
  cleanups.push(() => { store.detach(); client.close(); });
  running = mount(SettingDays, { target: document.body, props: { store, key: 'threadDoneRetentionDays', label: 'Delete done threads after', hint: 'Counted from Mark done.', fallback: 3, testid: 'done-retention-days' } });
  await settle();
  const field = document.querySelector<HTMLInputElement>('[data-testid=done-retention-days]')!;
  expect(field.value).toBe('3');
  expect(document.querySelector('button[type=submit]')).toBeNull();

  field.value = '5000';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(document.querySelector('[role=alert]')).not.toBeNull();
  expect(store.settings?.threadDoneRetentionDays ?? 3).toBe(3);

  field.value = '7';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  expect(store.settings?.threadDoneRetentionDays).toBe(7);
  expect(document.querySelector('[data-testid=save-status]')?.getAttribute('data-state')).toBe('saved');

  field.value = '12';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(store.settings?.threadDoneRetentionDays).toBe(12);
});
