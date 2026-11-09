import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Message } from '@boite/contracts';
import ErrorCard from './ErrorCard.svelte';
import { failedCall } from '../lib/one-status';

let running: Record<string, unknown> | null = null;
afterEach(() => { if (running) unmount(running, { outro: false }); running = null; document.body.innerHTML = ''; });

const STOP = 'Stopped: the device emulator did not answer for 120 s.';

test('a stopped run reads as one notice: its cause, one Retry, then the exit code and log behind the fold beside it', () => {
  let retried = 0;
  running = mount(ErrorCard, { target: document.body, props: { message: STOP, retry: () => { retried += 1; }, call: { exitCode: 1, output: 'Error: the emulator did not answer' } } });
  flushSync();
  expect(document.querySelector('[data-testid=error-description]')?.textContent).toBe(STOP);
  const part = document.querySelector('[data-testid=error-part]')!;
  const actions = part.querySelector('.actions')!;
  // One action beside the words and the fold under them: no second Retry, no exit code outside the fold.
  expect(actions.querySelectorAll('button')).toHaveLength(1);
  expect(part.querySelector('details summary')).not.toBeNull();
  expect(part.textContent!.replace(part.querySelector('pre')!.textContent!, '')).not.toContain('Exit code');
  expect(part.querySelector('[data-testid=error-diagnostic]')?.textContent).toBe(`${STOP}\n\nExit code 1\nError: the emulator did not answer`);
  actions.querySelector<HTMLButtonElement>('[data-testid=error-retry]')!.click();
  expect(retried).toBe(1);
});

test('the command a failed answer stopped on is its last call, only when the answer ends in an error', () => {
  const tool = (status: 'error' | 'complete', exitCode: number | null) => ({ type: 'tool' as const, toolId: status, name: 'Bash', input: {}, output: 'log', status, exitCode });
  const message = (parts: unknown[]) => ({ id: 'm', threadId: 't', turnId: 'u', role: 'assistant', parts, createdAt: 0 }) as unknown as Message;
  expect(failedCall(message([tool('error', 1), { type: 'error', message: STOP }]))).toEqual({ exitCode: 1, output: 'log' });
  // A failed command the agent went past is not the stop.
  expect(failedCall(message([tool('error', 1), tool('complete', 0), { type: 'error', message: STOP }]))).toBeNull();
  expect(failedCall(message([tool('error', 1)]))).toBeNull();
});
