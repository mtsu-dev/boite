// The composer's + on a desktop holds attach, the draft's separate copy and,
// once the box has text, dictation. These open it, read or pick a row, and
// close it again, so a test leaves no menu open behind it.
import { flushSync } from 'svelte';

const PLUS = '[data-testid=composer-plus]';
const ROWS = '[data-testid=composer-plus-menu]:not(.closing) [data-value]';

function toggle(): HTMLButtonElement | null {
  const plus = document.querySelector<HTMLButtonElement>(PLUS);
  plus?.click();
  flushSync();
  return plus;
}

/** Each row + offers, by id: whether its switch is on, or null for a plain action. Empty when there is no +. */
export function plusRows(): Record<string, boolean | null> {
  const plus = toggle();
  if (!plus) return {};
  const rows = Object.fromEntries(
    Array.from(document.querySelectorAll<HTMLElement>(ROWS)).map((row) => [
      row.dataset['value'] ?? '',
      row.hasAttribute('aria-checked') ? row.getAttribute('aria-checked') === 'true' : null
    ])
  );
  toggle();
  return rows;
}

/** Presses one row of +; a switch keeps the menu open, so it is closed after. */
export function pickPlus(id: string): void {
  const plus = toggle();
  if (!plus) throw new Error('the composer shows no +');
  const row = document.querySelector<HTMLButtonElement>(`[data-testid=composer-plus-menu]:not(.closing) [data-value=${id}]`);
  if (!row) throw new Error(`+ offers no ${id}`);
  row.click();
  flushSync();
  if (plus.getAttribute('aria-expanded') === 'true') toggle();
}
