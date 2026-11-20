import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILD_STORAGE_KEY, EXPERIMENTS_STORAGE_KEY } from './experiments';
import { applyTheme, readTheme, setTheme, startTheme, THEME_STORAGE_KEY } from './theme';

let meta: HTMLMetaElement;
let palette: HTMLStyleElement;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#111114';
  document.head.append(meta);
  palette = document.createElement('style');
  palette.textContent = readFileSync('src/styles/themes.css', 'utf8');
  document.head.append(palette);
});

afterEach(() => {
  meta.remove();
  palette.remove();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function color(): string {
  return meta.getAttribute('content') ?? '';
}

test('grain resolves to itself, stamps the root and takes the meta colour', () => {
  setTheme('grain');

  expect(readTheme()).toBe('grain');
  expect(document.documentElement.dataset.theme).toBe('grain');
  expect(color()).toBe('#1a1a1e');
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('grain');
});

test('theme chrome follows the CSS palette while switching through grain, light and dark', () => {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  expect(css.getPropertyValue('--palette-grain-theme-color').trim()).toBeTruthy();
  for (const [theme, token] of [
    ['grain', '--palette-grain-theme-color'],
    ['light', '--palette-light-default-background'],
    ['dark', '--palette-dark-default-background']
  ] as const) {
    meta.content = 'stale';
    applyTheme(theme);
    expect(color()).toBe(getComputedStyle(root).getPropertyValue(token).trim());
  }
});

test('an id this build does not offer is the system theme, which here is dark', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');

  expect(readTheme()).toBe('system');

  applyTheme(readTheme());

  // jsdom answers false to the light query, so system is dark and stamps nothing.
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(color()).toBe('#111114');
});

test('grain needs no switch: a stored grain paints with nothing chosen, on a Release too', () => {
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBeNull();
  setTheme('grain');
  const stop = startTheme();
  expect(readTheme()).toBe('grain');
  expect(document.documentElement.dataset.theme).toBe('grain');
  expect(window.localStorage.getItem(EXPERIMENTS_STORAGE_KEY)).toBeNull();
  window.localStorage.setItem(BUILD_STORAGE_KEY, '2.0.0');
  expect(readTheme()).toBe('grain');
  stop();
});

test('a listener dropped by the returned function stops repainting', () => {
  setTheme('grain');
  const stop = startTheme();

  stop();
  window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));

  // The stamp is stale on purpose: nothing is listening any more.
  expect(document.documentElement.dataset.theme).toBe('grain');
  expect(readTheme()).toBe('dark');
});
