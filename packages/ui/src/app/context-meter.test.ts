import { expect, vi } from 'vitest';
import { store } from '../lib/store.svelte';
import { count } from '../lib/format';
import { query, test, waitFor } from '../test/app';

vi.mock('@tauri-apps/plugin-opener', () => import('../test/opener'));

test('the composer wears the context meter from its threshold, a compaction is a divider, and a turn moves the meter', async ({ app: _app }) => {
  await waitFor(() => store.openThread?.id === 't-descriptors');

  // 31k of 200k, just compacted: under the threshold the row draws no reading, and the "+" holds actions only.
  const bar = () => document.querySelector<HTMLElement>('[data-testid=composer] .bar [data-testid=context-meter]');
  await waitFor(() => document.querySelector('[data-testid=composer-options]') !== null);
  expect(bar()).toBeNull();
  query<HTMLButtonElement>('[data-testid=composer-options]').click();
  await waitFor(() => document.querySelector('[data-testid=composer-options-sheet]') !== null);
  expect(document.querySelector('[data-testid=composer-context]')).toBeNull();
  query<HTMLButtonElement>('[data-testid=composer-options]').click();

  const input = query<HTMLTextAreaElement>('[data-testid=composer-input]');
  input.value = 'one more turn';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => !query<HTMLButtonElement>('[data-testid=composer-send]').disabled);
  query<HTMLButtonElement>('[data-testid=composer-send]').click();
  await waitFor(() => store.openThread?.status === 'idle' && (store.openThread?.context?.tokens ?? 0) > 31_000);
  // 31_000 + 600 + 13 * 4 = 31_652 of 200_000: still 16 percent, still nothing in the row.
  expect(bar()).toBeNull();

  // From 70 percent the reading stands in the row as its own item: a still ring and what is left, in words.
  store.openThread!.context = { ...store.openThread!.context!, tokens: 140_000, window: 200_000 };
  await waitFor(() => bar() !== null);
  expect(bar()!.dataset.percent).toBe('70');
  expect(bar()!.textContent?.trim()).toBe('30% left');
  expect(bar()!.querySelector('[data-testid=context-trigger] svg.ring')).not.toBeNull();
  expect(bar()!.querySelector('[data-testid=context-trigger]')!.getAttribute('aria-label')).toContain('Context: 30% left');
  // Its own item, not a part of the model's chip.
  expect(bar()!.closest('.picker')).toBeNull();
  query<HTMLButtonElement>('[data-testid=context-trigger]').click();
  await waitFor(() => document.querySelector('[data-testid=context-popup]') !== null);
  expect(query('[data-testid=context-popup]').textContent).toContain(count(140_000));
  expect(query('[data-testid=compaction-part]').textContent?.replace(/\s+/g, ' ').trim()).toBe(
    'Older messages summarized to make room, 184K to 31K tokens'
  );

  // At 69 the row shows nothing there.
  store.openThread!.context = { ...store.openThread!.context!, tokens: 138_000, window: 200_000 };
  await waitFor(() => bar() === null);

  // A thread with a pending permission keeps the chip named: the row is the same in every state.
  query<HTMLButtonElement>('[data-thread-id="t-bench"]').click();
  await waitFor(() => store.openThread?.id === 't-bench');
  await waitFor(() => document.querySelector('[data-testid=composer] [data-testid=permission-card]') !== null);
  expect(query('[data-testid=composer-picker]').querySelector('.label')).not.toBeNull();
});
