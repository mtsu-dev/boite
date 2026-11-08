import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PermissionCard from './PermissionCard.svelte';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
});

function button(id: 'permission-allow' | 'permission-deny'): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>(`[data-testid=${id}]`);
  if (!node) throw new Error(`no ${id}`);
  return node;
}

test('both buttons hold while an answer is out, and come back when it fails', async () => {
  const sent: string[] = [];
  let settle: (taken: boolean) => void = () => undefined;
  running = mount(PermissionCard, {
    target: document.body,
    props: {
      toolName: 'Bash',
      decision: null,
      request: null,
      answer: (decision: 'allow' | 'deny') => {
        sent.push(decision);
        return new Promise<boolean>((resolve) => { settle = resolve; });
      }
    }
  });
  flushSync();
  // Three taps before the card redraws: only the first one is sent.
  button('permission-allow').click();
  button('permission-allow').click();
  button('permission-deny').click();
  flushSync();
  expect(button('permission-allow').disabled).toBe(true);
  expect(button('permission-deny').disabled).toBe(true);
  expect(sent).toEqual(['allow']);
  settle(false);
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
  expect(button('permission-allow').disabled).toBe(false);
  button('permission-deny').click();
  expect(sent).toEqual(['allow', 'deny']);
});

test('Allow says its scope, one call, and the keys live in the titles, not as keycaps', () => {
  running = mount(PermissionCard, {
    target: document.body,
    props: { toolName: 'Bash', decision: null, request: { id: 'r1', toolName: 'Bash', input: { command: 'git push' } } as never, answer: () => undefined, docked: true }
  });
  flushSync();
  expect(button('permission-allow').textContent?.trim()).toBe('Allow once');
  expect(button('permission-allow').title).toBe('Lets this one call run (Enter)');
  expect(button('permission-deny').textContent?.trim()).toBe('Deny');
  expect(button('permission-deny').title).toBe('Deny (Esc)');
  expect(document.querySelector('[data-testid=permission-card] kbd')).toBeNull();
});
