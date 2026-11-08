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

test('a phone reads the permission first with its value and opens its modes in place, each with its plain line', async () => {
  const onpick = vi.fn();
  const icon = (() => null) as never;
  const items = [{ id: 'default', label: 'Ask', hint: 'Ask before edits and commands', title: '', icon }, { id: 'yolo', label: 'YOLO', hint: 'No limits', title: '', icon }];
  mounted = mount(ComposerOptions, { target: document.body, props: { worktree: null, canAttach: true, onattach() {}, onworktree() {}, mode: { active: 'default', items, onpick } } });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.click();
  flushSync();
  expect(document.querySelector('[data-testid=composer-options-sheet] [role=menuitem]')?.getAttribute('data-testid')).toBe('composer-mode');
  expect(document.querySelector('[data-testid=composer-mode-value]')?.textContent).toBe('Ask');
  document.querySelector<HTMLButtonElement>('[data-testid=composer-mode]')!.click();
  flushSync();
  const rows = [...document.querySelectorAll('[data-testid=composer-mode-menu] [data-value]')].map((row) => row.textContent?.trim());
  expect(rows).toEqual(['AskAsk before edits and commands', 'YOLONo limits']);
  document.querySelector<HTMLButtonElement>('[data-testid=composer-mode-menu] [data-value=yolo]')!.click();
  flushSync();
  expect(onpick).toHaveBeenCalledWith('yolo');
  expect(document.querySelector<HTMLButtonElement>('[data-testid=composer-options]')!.getAttribute('aria-expanded')).toBe('false');
});
