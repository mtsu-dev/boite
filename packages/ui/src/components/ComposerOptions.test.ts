import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ComposerOptions from './ComposerOptions.svelte';
import { phoneWidth } from '../test/phone-width';

let mounted: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = '';
});

function items(): (string | null)[] {
  return Array.from(document.querySelectorAll('[data-testid=composer-options-sheet] [role^=menuitem]')).map((row) => row.getAttribute('data-testid'));
}

test('the one "+" holds attach, a file mention, the commands and the worktree, and each closes it but the switch', () => {
  const onattach = vi.fn(), onmention = vi.fn(), oncommand = vi.fn(), onworktree = vi.fn();
  mounted = mount(ComposerOptions, { target: document.body, props: { worktree: false, canAttach: true, onattach, onworktree, onmention, oncommand } });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.click();
  flushSync();
  expect(items()).toEqual(['composer-attach', 'composer-mention', 'composer-commands', 'composer-worktree']);
  // The switch stays open under the finger: it is a setting, not an action.
  document.querySelector<HTMLButtonElement>('[data-testid=composer-worktree]')!.click();
  flushSync();
  expect(onworktree).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-testid=composer-options-sheet]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-testid=composer-mention]')!.click();
  flushSync();
  expect(onmention).toHaveBeenCalledOnce();
  expect(document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.getAttribute('aria-expanded')).toBe('false');
});

test('a box with nothing to add and no worktree draws no "+"', () => {
  mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: false, onattach() {}, onworktree() {} } });
  flushSync();
  expect(document.querySelector('[data-testid=composer-options]')).toBeNull();
});

test('the "+" holds actions only: no context row, whatever the thread', () => {
  mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: true, onattach() {}, onworktree() {} } });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.click();
  flushSync();
  expect(items()).toEqual(['composer-attach']);
  expect(document.querySelector('[data-testid=composer-context]')).toBeNull();
});

test('a "+" closed before its rows drew leaves the focus on the "+", not on a row of the closing sheet', async () => {
  mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: true, onattach() {}, onworktree() {} } });
  flushSync();
  const plus = document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!;
  plus.click();
  plus.click();
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(plus);
});

test('a phone opens the "+" as a bottom sheet with its title', () => {
  const restore = phoneWidth();
  try {
    mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: true, onattach() {}, onworktree() {} } });
    flushSync();
    document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.click();
    flushSync();
    // A floating popover under the other sheets read as a second kind of menu.
    expect(document.querySelector<HTMLElement>('[data-testid=composer-options-sheet]')!.dataset.mobileSheet).toBe('true');
    expect(document.querySelector('[data-testid=composer-options-sheet] .sheet-head')?.textContent).toBe('Add to the message');
    // The permission and the context are items of the row: the "+" holds actions only.
    expect(items()).toEqual(['composer-attach']);
  } finally { restore(); }
});
