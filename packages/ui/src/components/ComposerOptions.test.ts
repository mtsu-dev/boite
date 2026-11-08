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

test('a bot\'s thread reaches its context details from the "+" while the row draws no number', () => {
  const oncontext = vi.fn();
  mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: false, onattach() {}, onworktree() {}, context: 'Context 42% used', oncontext } });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.click();
  flushSync();
  expect(items()).toEqual(['composer-context']);
  expect(document.querySelector('[data-testid=composer-context]')!.textContent).toContain('Context 42% used');
  document.querySelector<HTMLButtonElement>('[data-testid=composer-context]')!.click();
  flushSync();
  expect(oncontext).toHaveBeenCalledOnce();
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

test('a phone opens the "+" as a bottom sheet with its title, even while a docked ask anchors it to the whole composer', () => {
  const restore = phoneWidth();
  try {
    const composer = document.createElement('div');
    document.body.append(composer);
    mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: true, anchor: () => composer, onattach() {}, onworktree() {} } });
    flushSync();
    document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.click();
    flushSync();
    // A floating popover under the other sheets read as a second kind of menu.
    expect(document.querySelector<HTMLElement>('[data-testid=composer-options-sheet]')!.dataset.mobileSheet).toBe('true');
    expect(document.querySelector('[data-testid=composer-options-sheet] .sheet-head')?.textContent).toBe('Add to the message');
    // The permission is a chip of its own: the "+" holds no mode.
    expect(items()).toEqual(['composer-attach']);
  } finally { restore(); }
});
