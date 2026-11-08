import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DiffView from './DiffView.svelte';
import highlighter from 'highlight.js/lib/core';
import { diffPrefs, setDiffPref } from '../lib/diff-prefs.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  setDiffPref('ignoreWhitespace', false);
  setDiffPref('split', false);
  setDiffPref('wrap', false);
});

test('a long diff draws its first rows and the rest on demand, with exact counts', () => {
  const newText = Array.from({ length: 1000 }, (_, index) => `const line${index} = ${index};`).join('\n');
  running = mount(DiffView, { target: document.body, props: { path: 'src/big.ts', oldText: '', newText } });
  flushSync();
  expect(document.querySelectorAll('[data-testid=diff-row]')).toHaveLength(300);
  expect(document.querySelector('[data-testid=diff-view] .head')!.textContent).toContain('+1000');
  const more = document.querySelector<HTMLButtonElement>('[data-testid=diff-show-all]')!;
  expect(more.textContent).toContain('1000');
  more.click();
  flushSync();
  expect(document.querySelectorAll('[data-testid=diff-row]')).toHaveLength(1000);
  expect(document.querySelector('[data-testid=diff-show-all]')).toBeNull();
});

test('the head counts its lines like every change count: "+2 −1" in one span, a real minus', () => {
  running = mount(DiffView, { target: document.body, props: { path: 'a.ts', oldText: 'a\nb\n', newText: 'a\nc\nd\n' } });
  flushSync();
  expect(document.querySelector('[data-testid=diff-view] .head .change-count')?.textContent).toBe('+2 −1');
});

test('a short diff has no show-all button', () => {
  running = mount(DiffView, { target: document.body, props: { path: 'a.ts', oldText: 'a\n', newText: 'b\n' } });
  flushSync();
  expect(document.querySelectorAll('[data-testid=diff-row]')).toHaveLength(2);
  expect(document.querySelector('[data-testid=diff-show-all]')).toBeNull();
});

test('code diffs recognize their language and retain exact text after highlighting', async () => {
  const oldText = 'const name = "old";\n';
  const newText = 'const name = "<img onerror=alert(1)>";\n';
  running = mount(DiffView, { target: document.body, props: { path: 'src/name.ts', oldText, newText } });
  flushSync();
  await vi.waitFor(() => expect(document.querySelector('.row.add .hljs-keyword')).not.toBeNull());
  expect(document.querySelector('[data-testid=diff-view]')?.getAttribute('data-language')).toBe('typescript');
  expect(document.querySelector('.row.add .text')?.textContent).toBe(newText.trimEnd());
  expect(document.querySelector('.row.remove .text')?.textContent).toBe(oldText.trimEnd());
  expect(document.querySelector('img')).toBeNull();
});

test('the whitespace switch hides reindented lines for every diff and remembers it', () => {
  running = mount(DiffView, { target: document.body, props: { path: 'a.ts', oldText: 'if (a) {\n  run();\n}\n', newText: 'if (a) {\n    run();\n}\n' } });
  flushSync();
  expect(document.querySelectorAll('[data-testid=diff-row]')).toHaveLength(2 + 2);
  // The switch lives in the head's layout menu, not behind a bare glyph.
  document.querySelector<HTMLButtonElement>('[data-testid=diff-options]')!.click();
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=diff-whitespace]')!.click();
  flushSync();
  expect(document.querySelector('[data-testid=diff-whitespace]')!.getAttribute('aria-checked')).toBe('true');
  expect(diffPrefs.ignoreWhitespace).toBe(true);
  expect(JSON.parse(localStorage.getItem('boite.diffView')!)).toEqual({ split: false, wrap: false, ignoreWhitespace: true });
  expect(document.querySelectorAll('[data-testid=diff-row]')).toHaveLength(0);
  expect(document.querySelector('[data-testid=diff-whitespace-only]')).not.toBeNull();
});

test('a narrow box offers no side-by-side view and draws one column', () => {
  setDiffPref('split', true);
  running = mount(DiffView, { target: document.body, props: { path: 'a.ts', oldText: 'a\n', newText: 'b\n' } });
  flushSync();
  expect(document.querySelector('[data-testid=diff-split]')).toBeNull();
  expect(document.querySelector('[data-testid=diff-view]')!.getAttribute('data-layout')).toBe('unified');
});

test('the layout menu names the layout in use, and Wrap lines folds long lines for every diff', () => {
  running = mount(DiffView, { target: document.body, props: { path: 'a.ts', oldText: 'a\n', newText: 'b\n' } });
  flushSync();
  const view = () => document.querySelector('[data-testid=diff-view]')!;
  // At rest the trigger says what is drawn: one column, long lines whole.
  expect(document.querySelector('[data-testid=diff-layout]')!.textContent).toBe('No wrap');
  expect(view().getAttribute('data-layout')).toBe('unified');
  document.querySelector<HTMLButtonElement>('[data-testid=diff-options]')!.click();
  flushSync();
  expect(document.querySelector('[data-testid=diff-nowrap]')!.getAttribute('aria-checked')).toBe('true');
  document.querySelector<HTMLButtonElement>('[data-testid=diff-wrap]')!.click();
  flushSync();
  expect(view().getAttribute('data-layout')).toBe('wrapped');
  expect(document.querySelector('[data-testid=diff-layout]')!.textContent).toBe('Wrap lines');
  expect(JSON.parse(localStorage.getItem('boite.diffView')!)).toEqual({ split: false, wrap: true, ignoreWhitespace: false });
});

test('a pure addition highlights only its new side, and the same diff mounted again highlights nothing', async () => {
  const highlight = vi.spyOn(highlighter, 'highlight');
  const props = { path: 'src/fresh.ts', oldText: '', newText: 'export const fresh = 1;\n' };
  running = mount(DiffView, { target: document.body, props });
  flushSync();
  await vi.waitFor(() => expect(document.querySelector('.row.add .hljs-keyword')).not.toBeNull());
  expect(highlight).toHaveBeenCalledTimes(1);
  unmount(running, { outro: false });
  running = mount(DiffView, { target: document.body, props });
  flushSync();
  await vi.waitFor(() => expect(document.querySelector('.row.add .hljs-keyword')).not.toBeNull());
  expect(highlight).toHaveBeenCalledTimes(1);
  highlight.mockRestore();
});

test('a changed line marks its changed words, before and after the grammar runs, and keeps its text', async () => {
  const oldText = 'const limit = 3;\nconst other = "a < b";\n';
  const newText = 'const limit = 30;\nconst other = "a < c";\n';
  running = mount(DiffView, { target: document.body, props: { path: 'src/limits.ts', oldText, newText } });
  flushSync();
  const marks = () => Array.from(document.querySelectorAll('[data-testid=diff-row] mark.word')).map(mark => mark.textContent);
  expect(marks()).toEqual(['3', 'b', '30', 'c']);
  await vi.waitFor(() => expect(document.querySelector('[data-testid=diff-row] .text span')).not.toBeNull());
  expect(marks().join('')).toContain('30');
  expect(Array.from(document.querySelectorAll('[data-testid=diff-row] .text')).map(text => text.textContent)).toEqual(['const limit = 3;', 'const other = "a < b";', 'const limit = 30;', 'const other = "a < c";']);
});
