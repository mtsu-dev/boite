import { afterEach, expect, test } from 'vitest';
import { flushSync } from 'svelte';
import { BACKDROP_STORAGE_KEY, backdrop, readBackdrop } from './choice.svelte';
import { setExperiment } from '../experiments';

afterEach(() => {
  setExperiment('draft-backdrop', false);
  window.localStorage.clear();
  backdrop.load();
});

test('nothing shows until the experiment is on, then a device that picked nothing gets the draw', () => {
  expect(backdrop.choice).toBe('random');
  expect(backdrop.shown).toBe('off');
  setExperiment('draft-backdrop', true);
  flushSync();
  expect(backdrop.shown).toBe('random');
});

test('a picked scene is stored and read back; the default leaves no key', () => {
  setExperiment('draft-backdrop', true);
  backdrop.set('tunnel');
  expect(window.localStorage.getItem(BACKDROP_STORAGE_KEY)).toBe('tunnel');
  expect(readBackdrop()).toBe('tunnel');
  expect(backdrop.shown).toBe('tunnel');

  backdrop.set('off');
  expect(window.localStorage.getItem(BACKDROP_STORAGE_KEY)).toBe('off');
  expect(backdrop.shown).toBe('off');

  backdrop.set('random');
  expect(window.localStorage.getItem(BACKDROP_STORAGE_KEY)).toBeNull();
});

test('an unknown stored id falls back to the draw', () => {
  window.localStorage.setItem(BACKDROP_STORAGE_KEY, 'plasma');
  backdrop.load();
  expect(backdrop.choice).toBe('random');
});
