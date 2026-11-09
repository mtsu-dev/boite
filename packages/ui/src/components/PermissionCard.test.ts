import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PermissionRequest } from '@boite/contracts';
import { decisionTail } from '../lib/decision-tail.svelte';
import PermissionCard from './PermissionCard.svelte';
import DecisionPill from './DecisionPill.svelte';

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
    props: { toolName: 'Bash', decision: null, request: { id: 'r1', toolName: 'Bash', input: { command: 'git push' } } as never, answer: () => undefined }
  });
  flushSync();
  expect(button('permission-allow').textContent?.trim()).toBe('Allow once');
  expect(button('permission-allow').title).toBe('Lets this one call run (Enter)');
  expect(button('permission-deny').textContent?.trim()).toBe('Deny');
  expect(button('permission-deny').title).toBe('Deny (Esc)');
  expect(document.querySelector('[data-testid=permission-card] kbd')).toBeNull();
  // The decision pair: Deny outlined then Allow once solid, the same pair as a question's Skip and Answer.
  const pair = [...document.querySelectorAll<HTMLButtonElement>('.decision-actions > button')];
  expect(pair.map((entry) => entry.dataset.testid)).toEqual(['permission-deny', 'permission-allow']);
  expect(button('permission-deny').classList.contains('secondary')).toBe(true);
  expect(button('permission-allow').classList.contains('primary')).toBe(true);
});

test('the waiting row is the command itself, its reason and the pair; out of view it leaves the pill, and once allowed one receipt line', async () => {
  let seen: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null;
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof seen) { seen = callback; } observe() {} disconnect() {} });
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const root = document.body.appendChild(document.createElement('div'));
  root.setAttribute('data-scroll-root', '');
  Object.defineProperty(root, 'clientHeight', { value: 400 });
  const strip = document.body.appendChild(document.createElement('div'));
  const sent: string[] = [];
  const request: PermissionRequest = { id: 'perm', threadId: 'thread', turnId: 'turn', toolName: 'Bash', input: { command: 'git push origin main' }, description: 'Publish the branch', createdAt: 1 };
  const answer = (decision: 'allow' | 'deny') => { sent.push(decision); };
  running = mount(PermissionCard, { target: root, props: { toolName: 'Bash', decision: null, request, answer } });
  const pill = mount(DecisionPill, { target: strip });
  decisionTail.count = 1;
  flushSync();
  const away = (ratio: number) => { flushSync(() => seen!([{ intersectionRatio: ratio, intersectionRect: { height: ratio * 100 } as DOMRectReadOnly }])); };
  try {
    const row = document.querySelector<HTMLElement>('[data-testid=permission-card][data-decision=pending]')!;
    expect(row.querySelector('[data-testid=permission-subject]')?.classList.contains('mono')).toBe(true);
    expect(row.querySelector('[data-testid=permission-subject]')?.textContent).toContain('git push origin main');
    expect(row.querySelector('[data-testid=permission-why]')?.textContent).toBe('Publish the branch');
    expect(row.querySelector('[data-testid=permission-status]')?.textContent).toContain('Waiting for approval');
    expect([...row.querySelectorAll('.decision-actions > button')].map((entry) => entry.textContent?.trim())).toEqual(['Deny', 'Allow once']);
    // In view, no pill; scrolled away, the pill leads back to the row and focuses it.
    away(1);
    expect(strip.querySelector('[data-testid=decision-pill]')).toBeNull();
    away(0);
    const back = strip.querySelector<HTMLButtonElement>('[data-testid=decision-pill]')!;
    expect(back.textContent?.trim()).toBe('1 decision waiting');
    expect(strip.querySelector('[data-testid=permission-allow]')).toBeNull();
    back.click();
    expect(scroll.mock.contexts.at(-1)).toBe(row);
    // The row focused, Escape denies and Enter allows, the keys its titles name.
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(sent).toEqual(['deny']);
    // Answered, one quiet line says what was allowed.
    unmount(running, { outro: false });
    running = mount(PermissionCard, { target: root, props: { toolName: 'Bash', decision: 'allow', request, answer } });
    flushSync();
    expect(document.querySelector('[data-testid=permission-card]')?.getAttribute('data-decision')).toBe('allow');
    expect(document.querySelector('[data-testid=permission-sentence]')?.textContent).toBe('Allowed: git push origin main');
    expect(document.querySelector('[data-testid=permission-allow]')).toBeNull();
    // The row gone, nothing is in view: the strip keeps the pill only while one still waits.
    decisionTail.count = 0;
    flushSync();
    expect(strip.querySelector('[data-testid=decision-pill]')).toBeNull();
  } finally {
    unmount(pill);
    decisionTail.count = 0;
    vi.unstubAllGlobals();
  }
});
