import { afterEach, expect, test } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { RING_SPIN_LIMIT } from '../lib/ring-budget.svelte';
import type { ThreadState } from '../lib/thread-state';
import StateRing from './StateRing.svelte';

const apps: ReturnType<typeof mount>[] = [];
const picture = createRawSnippet(() => ({ render: () => '<span></span>' }));
afterEach(async () => { for (const app of apps.splice(0)) await unmount(app); document.body.innerHTML = ''; });
const ring = (kind: ThreadState | null, extra: Record<string, unknown> = {}) => {
  const target = document.body.appendChild(document.createElement('div'));
  apps.push(mount(StateRing, { target, props: { kind, children: picture, ...extra } }));
  flushSync();
  return target.querySelector<HTMLElement>('[data-testid=state-ring]')!;
};

test('a failed ring carries the alert-circle and the waiting ring a bare dot, so the two differ without colour', () => {
  const failed = ring('error'), waiting = ring('waiting');
  // One failure glyph across rows and cards (round 5 found three): the alert-circle, no "!".
  expect(failed.querySelector('.mark svg circle')).not.toBeNull();
  expect(failed.querySelector('.mark')?.textContent).toBe('');
  expect(waiting.querySelector('.mark')).toBeNull();
  expect(waiting.querySelector('.dot')?.textContent).toBe('');
});

test('a question asked mid-turn keeps the working arc and adds the amber dot', () => {
  const asks = ring('waiting', { asking: true });
  expect(asks.dataset.ring).toBe('working');
  expect(asks.dataset.asking).toBe('true');
  expect(asks.querySelector('.arc')).not.toBeNull();
  expect(asks.querySelector('.dot')).not.toBeNull();
  // A machine away shows no live state, asked or not.
  expect(ring('waiting', { asking: true, stale: true }).dataset.ring).toBe('rest');
});

test('past twelve working rings on screen the arcs hold still, and turn again once fewer show', async () => {
  const rings = Array.from({ length: RING_SPIN_LIMIT }, () => ring('working'));
  expect(rings.every(element => element.dataset.still === undefined)).toBe(true);
  ring('working');
  flushSync();
  expect(document.querySelectorAll('[data-still]').length).toBe(RING_SPIN_LIMIT + 1);
  await unmount(apps.pop()!);
  flushSync();
  expect(document.querySelectorAll('[data-still]').length).toBe(0);
});
