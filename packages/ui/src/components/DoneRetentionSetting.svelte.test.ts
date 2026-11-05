import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Store } from '../lib/store.svelte';
import DoneRetentionSetting from './DoneRetentionSetting.svelte';
import { SAVED_SHOWN_MS } from './SavedMark.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };

// Round 3 (Sol B A13): after Save the button only greyed out, so nothing said the value stored.
test('a save the core took says "Saved" beside the button and fades; a refused one shows no such mark', async () => {
  vi.useFakeTimers();
  let accept = true;
  const store = $state({
    owner: true,
    connection: 'ready',
    settings: { threadDoneRetentionDays: 7 },
    kept: () => false,
    saveSettings: vi.fn(async (patch: { threadDoneRetentionDays?: number }) => {
      if (!accept) return false;
      store.settings = { ...store.settings, ...patch };
      return true;
    })
  });
  mounted = mount(DoneRetentionSetting, { target: document.body, props: { store: store as unknown as Store } });
  await settle();
  const field = document.querySelector<HTMLInputElement>('[data-testid=done-retention-days]')!;
  const save = document.querySelector<HTMLButtonElement>('[data-testid=done-retention-save]')!;
  const mark = () => document.querySelector('[data-testid=done-retention-saved]');
  const type = async (value: string) => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  expect(mark()).toBeNull();

  await type('30');
  save.click();
  await settle();
  expect(store.saveSettings).toHaveBeenLastCalledWith({ threadDoneRetentionDays: 30 });
  expect(mark()?.textContent?.trim()).toBe('Saved');
  expect(mark()?.getAttribute('role')).toBe('status');
  expect(save.disabled).toBe(true);

  // It stays long enough to read, then fades and leaves.
  vi.advanceTimersByTime(SAVED_SHOWN_MS - 100);
  flushSync();
  expect(mark()?.classList.contains('leaving')).toBe(false);
  vi.advanceTimersByTime(200);
  flushSync();
  expect(mark()?.classList.contains('leaving')).toBe(true);
  vi.advanceTimersByTime(1_000);
  flushSync();
  expect(mark()).toBeNull();

  // A refused save keeps the field as typed and draws no mark.
  accept = false;
  await type('40');
  save.click();
  await settle();
  expect(store.saveSettings).toHaveBeenLastCalledWith({ threadDoneRetentionDays: 40 });
  expect(mark()).toBeNull();
  expect(field.value).toBe('40');
  expect(save.disabled).toBe(false);

  // The next save that lands shows it again.
  accept = true;
  save.click();
  await settle();
  expect(mark()?.textContent?.trim()).toBe('Saved');
});
