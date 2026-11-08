import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { count } from '../lib/format';
import { query, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('the composer wears the context meter, a compaction is a divider, and a turn moves the meter', async ({ app: _app }) => {
  await waitFor(() => store.openThread?.id === 't-descriptors');

  // 31k of 200k, just compacted: under half full, the ring leaves the bar for
  // the model chip's menu, behind its More row, where it reads 16 percent; the divider says what went.
  await waitFor(() => document.querySelector('[data-testid=composer-picker]') !== null);
  expect(document.querySelector('[data-testid=composer] .bar [data-testid=context-meter]')).toBeNull();
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-more]') !== null);
  query<HTMLButtonElement>('[data-testid=composer-picker-more]').click();
  await waitFor(() => document.querySelector('[data-testid=context-meter]') !== null);
  const meter = query('[data-testid=context-meter]');
  expect(meter.closest('[data-testid=composer]')).not.toBeNull();
  // A ring and its percent, never a bare disc.
  expect(query('[data-testid=context-trigger]').textContent?.trim()).toBe('16%');
  expect(meter.dataset.percent).toBe('16');
  expect(meter.dataset.level).toBe('low');
  query<HTMLButtonElement>('[data-testid=context-trigger]').click();
  await waitFor(() => document.querySelector('[data-testid=context-popup]') !== null);
  expect(query('[data-testid=context-popup]').textContent).toContain(count(31000));
  expect(query('[data-testid=compaction-part]').textContent?.replace(/\s+/g, ' ').trim()).toBe(
    'Older messages summarized to make room, 184K to 31K tokens'
  );

  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'one more turn';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();
  await waitFor(() => store.openThread?.status === 'idle' && (store.openThread?.context?.tokens ?? 0) > 31_000);
  // 31_000 + 600 + 13 * 4 = 31_652 of 200_000: still 16 percent, the tooltip moved.
  expect(query('[data-testid=context-meter]').dataset.percent).toBe('16');

  // A thread whose agent never reported shows an empty ring in the menu, never a dash.
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-menu]') === null);
  query<HTMLButtonElement>('[data-thread-id="t-bench"]').click();
  await waitFor(() => store.openThread?.id === 't-bench');
  // Its pending permission folds the chip to its mark until something is written.
  await waitFor(() => document.querySelector('[data-testid=composer] .entry.folded') !== null);
  expect(query('[data-testid=composer-picker]').querySelector('.label')).toBeNull();
  const field = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  field.value = 'x';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => query('[data-testid=composer-picker]').querySelector('.label') !== null);
  query<HTMLButtonElement>('[data-testid=composer-picker]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-picker-more]') !== null);
  query<HTMLButtonElement>('[data-testid=composer-picker-more]').click();
  await waitFor(() => document.querySelector('[data-testid=context-trigger]') !== null);
  expect(query('[data-testid=context-trigger]').textContent?.trim()).toBe('');
  query<HTMLButtonElement>('[data-testid=context-trigger]').click();
  await waitFor(() => document.querySelector('[data-testid=context-popup]') !== null);
  expect(query('[data-testid=context-popup]').textContent).toContain('No measurement received');
});
