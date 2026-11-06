import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Store } from '../lib/store.svelte';
import DeletedThreads from './DeletedThreads.svelte';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };

// A value typed while the save was in flight drew "Saved" beside a field the core never stored.
test('a deletion delay typed during a save gets no "Saved" mark and keeps Save on', async () => {
  let land!: (ok: boolean) => void;
  const store = $state({
    owner: true,
    connection: 'ready',
    settings: { threadDeletionRetentionDays: 30 },
    kept: () => false,
    saveSettings: vi.fn(() => new Promise<boolean>(resolve => { land = resolve; }))
  });
  mounted = mount(DeletedThreads, { target: document.body, props: { store: store as unknown as Store } });
  await settle();
  const field = document.querySelector<HTMLInputElement>('[data-testid=deleted-retention-days]')!;
  const save = document.querySelector<HTMLButtonElement>('[data-testid=deleted-retention-save]')!;
  const type = async (value: string) => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  await type('10');
  save.click();
  await settle();
  expect(store.saveSettings).toHaveBeenLastCalledWith({ threadDeletionRetentionDays: 10 });
  await type('20');
  land(true);
  await settle();
  expect(document.querySelector('[data-testid=deleted-retention-saved]')).toBeNull();
  expect(field.value).toBe('20');
  expect(save.disabled).toBe(false);
});
