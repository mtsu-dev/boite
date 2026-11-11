import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ToolPart } from '../lib/tool-groups';
import type { Store } from '../lib/store.svelte';
import ToolGroup from './ToolGroup.svelte';
import toolGroupSource from './ToolGroup.svelte?raw';
import toolCardSource from './ToolCard.svelte?raw';

let component: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (component) unmount(component, { outro: false });
  component = null;
  document.body.innerHTML = '';
});

test('a folded run counts every failed or denied call even after a success', () => {
  const parts: ToolPart[] = ['error', 'denied', 'done'].map((status, index) => ({
    type: 'tool', toolId: String(index), name: 'Bash', input: { command: 'git status' },
    output: 'command output', status: status as ToolPart['status'], exitCode: index === 0 ? 2 : null
  }));
  component = mount(ToolGroup, { target: document.body, props: { parts, isBackground: () => false } });
  flushSync();
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid=tool-group-toggle]')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.getAttribute('aria-label')).toContain('2 unsuccessful calls');
  expect(document.querySelector('[data-testid=tool-group-issues]')?.textContent).toBe('2');
  expect(document.querySelector('[data-testid=tool-output]')).toBeNull();
  toggle.click();
  flushSync();
  expect(document.querySelectorAll('[data-testid=tool-card]')).toHaveLength(3);
  expect(document.querySelector('[data-testid=tool-exit-code]')?.textContent).toBe('Exit code 2');
  document.querySelector<HTMLButtonElement>('[data-testid=tool-toggle]')!.click();
  flushSync();
  expect(document.querySelector('[data-testid=tool-output]')?.textContent).toBe('command output');
});

test('a run reads "Ran 1 command" on a line that sets its own tracking, since the body\'s rounds a pixel out of its space', () => {
  const parts: ToolPart[] = [
    { type: 'tool', toolId: 'one', name: 'Bash', input: { command: 'git status' }, output: '', status: 'done', exitCode: 0 },
    { type: 'tool', toolId: 'two', name: 'Read', input: { file_path: 'a.ts' }, output: '', status: 'done', exitCode: null }
  ];
  component = mount(ToolGroup, { target: document.body, props: { parts, isBackground: () => false } });
  flushSync();
  const toggle = document.querySelector<HTMLElement>('[data-testid=tool-group-toggle]')!;
  expect(toggle.querySelector('[data-testid=tool-group-label]')?.textContent).toBe('Ran 1 command and read 1 file');
  // app.css makes a button inherit the body's -0.006em, and jsdom draws no component CSS: read the line's own rule.
  expect(toolGroupSource.match(/\n  \.head \{[^}]*\}/)?.[0]).toContain('letter-spacing: normal;');
  // A lone call is its own card, on a line of the same words.
  unmount(component, { outro: false });
  component = mount(ToolGroup, { target: document.body, props: { parts: parts.slice(0, 1), isBackground: () => false } });
  flushSync();
  expect(document.querySelector('[data-testid=tool-toggle] .line')?.textContent).toBe('Ran 1 command');
  expect(toolCardSource.match(/\n  \.head \{[^}]*\}/)?.[0]).toContain('letter-spacing: normal;');
});

test('a folded group with a denied call says who denied it, not only the count of failures', () => {
  const parts = [
    { type: 'tool' as const, toolId: 'a', name: 'Read', input: { file_path: 'a.ts' }, output: '', status: 'done' as const },
    { type: 'tool' as const, toolId: 'b', name: 'Bash', input: { command: 'rm -rf build' }, output: null, status: 'denied' as const },
    { type: 'permission' as const, requestId: 'p', toolName: 'Bash', decision: 'deny' as const }
  ];
  component = mount(ToolGroup, { target: document.body, props: { parts, isBackground: () => false } });
  flushSync();
  const label = document.querySelector('[data-testid=tool-group-toggle]')!.getAttribute('aria-label');
  expect(label).toContain('Denied by you');
  expect(label).toContain('1 unsuccessful call');
});

test('an open card on a running call watches its live output only while its group is unfolded', () => {
  const release = vi.fn();
  const watchLiveOutput = vi.fn(() => release);
  const parts: ToolPart[] = [
    { type: 'tool', toolId: 'a', name: 'Read', input: { file_path: 'a.ts' }, output: 'text', status: 'done' },
    { type: 'tool', toolId: 'b', name: 'Bash', input: { command: 'bun run build' }, output: '', outputDeferred: true, status: 'running' },
  ];
  component = mount(ToolGroup, { target: document.body, props: { parts, isBackground: () => false, store: { watchLiveOutput } as unknown as Store, threadId: 't-1' } });
  flushSync();
  const group = document.querySelector<HTMLButtonElement>('[data-testid=tool-group-toggle]')!;
  group.click();
  flushSync();
  document.querySelectorAll<HTMLButtonElement>('[data-testid=tool-toggle]')[1]!.click();
  flushSync();
  expect(watchLiveOutput).toHaveBeenCalledWith('t-1');
  expect(release).not.toHaveBeenCalled();
  // Folding the group hides the card: the core keeps its output again.
  group.click();
  flushSync();
  expect(release).toHaveBeenCalledTimes(1);
  group.click();
  flushSync();
  expect(watchLiveOutput).toHaveBeenCalledTimes(2);
});
