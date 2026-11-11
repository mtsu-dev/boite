import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { DelegatedAgent, Turn } from '@boite/contracts';
import DelegationActivity from './DelegationActivity.svelte';
import type { Store } from '../lib/store.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

const AT = new Date(2026, 10, 6, 10, 0, 0).getTime();

function agent(id: string, title: string, turn: Partial<Turn> | null, backgroundWait: DelegatedAgent['thread']['backgroundWait'] = null): DelegatedAgent {
  return {
    thread: { id, title, providerId: 'claude', status: 'idle', createdAt: AT, parentThreadId: 't-parent', backgroundWait },
    profileId: 'p', task: title, result: null,
    lastTurn: turn && { id: `${id}-turn`, threadId: id, status: 'done', queuedAt: AT, startedAt: AT, finishedAt: AT + 60_000, usage: null, error: null, ...turn }
  } as unknown as DelegatedAgent;
}

test('a failed or stopped subagent says why under its name, from its error, its interrupted work, or in words, and still opens its conversation', () => {
  const open = vi.fn(async () => undefined);
  const store = { pendingQuestions: [], pendingPermissions: [], subagentQuestions: () => [], open } as unknown as Store;
  running = mount(DelegationActivity, { target: document.body, props: { store, agents: [
    agent('t-error', 'Fix the parser', { status: 'error', error: 'Rate limit reached\n  at request (sdk.js:12)' }),
    agent('t-cut', 'Build the preview release', { status: 'done' }, { state: 'interrupted', for: 'The build', reason: 'session-ended', at: AT + 30_000 }),
    agent('t-bare', 'Check the docs', { status: 'error', error: null }),
    agent('t-done', 'Read the tests', { status: 'done' })
  ] } });
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=delegation-activity]')!.click();
  flushSync();
  const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-testid=delegation-agent]')];
  const cause = (row: HTMLElement) => row.querySelector('[data-testid=delegation-agent-cause]')?.textContent ?? null;
  // Work that ended without reporting back is a stop, the word Activity uses for it; an error is a failure.
  expect(rows.map((row) => row.dataset.state)).toEqual(['failed', 'stopped', 'failed', 'done']);
  expect(document.querySelector('[data-testid=delegation-progress]')?.textContent).toBe('1 done, 2 failed, 1 stopped');
  // One line: the error's first line, never the trace under it.
  expect(cause(rows[0]!)).toBe('Rate limit reached');
  // The words Activity uses for the same interrupted thread.
  expect(cause(rows[1]!)).toBe('The build ended without reporting back: the agent was stopped');
  expect(cause(rows[2]!)).toBe('Failed');
  expect(cause(rows[3]!)).toBeNull();
  // Its danger mark is the family's icon size, not smaller than the spinner.
  expect(rows[0]!.querySelector<HTMLElement>('.fail')!.style.getPropertyValue('--fail')).toBe('14px');
  rows[0]!.click();
  expect(open).toHaveBeenCalledWith('t-error');
});

test('a cause wraps to two lines, then ends on a word: the row is a button, whose one-line words it must not inherit', async () => {
  // jsdom applies no component CSS: read the rules as Svelte compiles them, for the row and the run's card.
  const { compile } = await import('svelte/compiler');
  const { readFileSync } = await import('node:fs');
  for (const file of ['DelegationActivity.svelte', 'ActivityCard.svelte']) {
    const source = readFileSync(`${import.meta.dirname}/${file}`, 'utf8').replace(/<script lang="ts">[\s\S]*?<\/script>/, '<script></script>');
    const css = compile(source, { filename: file, cssHash: () => 'c' }).css?.code ?? '';
    const rule = css.match(/\.cause\.c \{([^}]*)\}/)?.[1] ?? '';
    expect(rule, file).toContain('white-space: normal');
    expect(rule, file).toContain('line-clamp: 2');
    expect(rule, file).not.toContain('nowrap');
  }
});
