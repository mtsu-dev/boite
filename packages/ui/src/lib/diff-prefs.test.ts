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

test('a phone scrolls a diff sideways by default, its tokens whole; a saved Wrap lines stays', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 720px)' }));
  try {
    expect((await prefs()).wrap).toBe(false);
    vi.resetModules();
    window.localStorage.setItem('boite.diffView', JSON.stringify({ split: false, wrap: true, ignoreWhitespace: false }));
    expect((await prefs()).wrap).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
