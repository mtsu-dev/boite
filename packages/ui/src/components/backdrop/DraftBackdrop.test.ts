import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DraftBackdrop from './DraftBackdrop.svelte';
import { BACKDROP_STORAGE_KEY, backdrop } from '../../lib/backdrop/choice.svelte';
import { setExperiment } from '../../lib/experiments';

let running: Record<string, unknown> | null = null;
const canvas = () => document.querySelector<HTMLCanvasElement>('[data-testid=draft-backdrop]');

beforeEach(() => {
  // jsdom has no WebGL: the renderer answers null and the canvas stays empty.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  setExperiment('draft-backdrop', false);
  window.localStorage.clear();
  backdrop.load();
  vi.restoreAllMocks();
});

test('no canvas while the experiment is off, one per picked scene once it is on', () => {
  running = mount(DraftBackdrop, { target: document.body });
  flushSync();
  expect(canvas()).toBeNull();

  setExperiment('draft-backdrop', true);
  flushSync();
  // Nothing picked: the draw settles on one of the four and keeps it.
  const first = canvas()?.dataset['scene'];
  expect(['tunnel', 'glyphs', 'relief', 'crates']).toContain(first);
  expect(canvas()?.getAttribute('aria-hidden')).toBe('true');

  backdrop.set('crates');
  flushSync();
  expect(canvas()?.dataset['scene']).toBe('crates');
  backdrop.set('random');
  flushSync();
  expect(canvas()?.dataset['scene']).toBe(first);

  backdrop.set('off');
  flushSync();
  expect(canvas()).toBeNull();
});

test('a scene picked in another window replaces this one, and a device without WebGL shows the screen without it', async () => {
  setExperiment('draft-backdrop', true);
  backdrop.set('glyphs');
  running = mount(DraftBackdrop, { target: document.body });
  flushSync();
  // The renderer loads, finds no WebGL and leaves the canvas unmarked.
  await vi.dynamicImportSettled();
  expect(canvas()?.dataset['scene']).toBe('glyphs');
  expect(canvas()?.hasAttribute('data-ready')).toBe(false);

  window.localStorage.setItem(BACKDROP_STORAGE_KEY, 'tunnel');
  window.dispatchEvent(new StorageEvent('storage', { key: BACKDROP_STORAGE_KEY }));
  flushSync();
  expect(canvas()?.dataset['scene']).toBe('tunnel');
});
