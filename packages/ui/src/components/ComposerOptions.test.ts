import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ComposerOptions from './ComposerOptions.svelte';

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
