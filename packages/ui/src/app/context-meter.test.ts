import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { count } from '../lib/format';
import { query, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('the composer wears the context meter, a compaction is a divider, and a turn moves the meter', async ({ app: _app }) => {
  await waitFor(() => store.openThread?.id === 't-descriptors');

  // 31k of 200k, just compacted: under the threshold, the number leaves the bar for
  // a row of the composer's "+", where it reads 16 percent; the divider says what went.
  await waitFor(() => document.querySelector('[data-testid=composer-options]') !== null);
  expect(document.querySelector('[data-testid=composer] .bar [data-testid=context-meter]')).toBeNull();
  const meter = query('[data-testid=context-details]');
  expect(meter.closest('[data-testid=composer]')).not.toBeNull();
  expect(meter.dataset.percent).toBe('16');
  expect(meter.dataset.level).toBe('low');
  query<HTMLButtonElement>('[data-testid=composer-options]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-context]') !== null);
  // The number with its measure, in words: no arc that reads as a spinner.
  expect(query('[data-testid=composer-context]').textContent?.trim()).toBe('Context 16% used');
  query<HTMLButtonElement>('[data-testid=composer-context]').click();
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
  expect(query('[data-testid=context-details]').dataset.percent).toBe('16');

  // From 70 percent the number stands in the bar beside the chip; at 69 the row shows nothing there.
  const bar = () => document.querySelector<HTMLElement>('[data-testid=composer] .bar [data-testid=context-meter]');
  store.openThread!.context = { ...store.openThread!.context!, tokens: 140_000, window: 200_000 };
  await waitFor(() => bar() !== null);
  expect(bar()!.textContent?.trim()).toBe('70% context');
  expect(bar()!.querySelector('[data-testid=context-trigger] circle')).toBeNull();
  expect(bar()!.querySelector('[data-testid=context-trigger]')!.getAttribute('aria-label')).toContain('Context 70% used');
  store.openThread!.context = { ...store.openThread!.context!, tokens: 138_000, window: 200_000 };
  await waitFor(() => bar() === null);
  expect(document.querySelector('[data-testid=composer] .bar [data-testid=context-trigger]')).toBeNull();

  // A thread whose agent never reported names the details in the "+", never a dash.
  query<HTMLButtonElement>('[data-thread-id="t-bench"]').click();
  await waitFor(() => store.openThread?.id === 't-bench');
  // Its pending permission leaves the chip named: the row is the same in every state.
  await waitFor(() => document.querySelector('[data-testid=composer] [data-testid=permission-card]') !== null);
  expect(query('[data-testid=composer-picker]').querySelector('.label')).not.toBeNull();
  query<HTMLButtonElement>('[data-testid=composer-options]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-context]') !== null);
  expect(query('[data-testid=composer-context]').textContent?.trim()).toBe('Context');
  query<HTMLButtonElement>('[data-testid=composer-context]').click();
  await waitFor(() => document.querySelector('[data-testid=context-popup]') !== null);
  expect(query('[data-testid=context-popup]').textContent).toContain('No measurement received');
});
