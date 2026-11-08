import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

async function prefs() {
  return (await import('./diff-prefs.svelte')).diffPrefs;
}

// Round 17: code cut at the panel's edge read as broken, so a diff wraps unless the user chose No wrap.
test('a diff wraps its long lines until the user picks No wrap', async () => {
  expect((await prefs()).wrap).toBe(true);
});

test('prefs saved before the wrap choice existed still wrap; a saved No wrap stays', async () => {
  window.localStorage.setItem('boite.diffView', JSON.stringify({ split: false, ignoreWhitespace: true }));
  expect(await prefs()).toEqual({ split: false, wrap: true, ignoreWhitespace: true });
  vi.resetModules();
  window.localStorage.setItem('boite.diffView', JSON.stringify({ split: false, wrap: false, ignoreWhitespace: false }));
  expect((await prefs()).wrap).toBe(false);
});
