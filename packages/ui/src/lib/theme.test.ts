import { afterEach, beforeEach, expect, test } from 'vitest';
import { BUILD_STORAGE_KEY, EXPERIMENTS_STORAGE_KEY, setExperiment } from './experiments';
import { applyTheme, readTheme, setTheme, startTheme, THEME_STORAGE_KEY } from './theme';

let meta: HTMLMetaElement;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#111114';
  document.head.append(meta);
});

afterEach(() => {
  meta.remove();
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
  // A switch that no longer exists cannot take it away.
  setExperiment('theme-grain', false);
  expect(readTheme()).toBe('grain');
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
  setExperiment('whip', true);

  // The stamp is stale on purpose: nothing is listening any more.
  expect(document.documentElement.dataset.theme).toBe('grain');
  expect(readTheme()).toBe('dark');
});
