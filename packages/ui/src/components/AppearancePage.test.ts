import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AppearancePage from './AppearancePage.svelte';
import { FONT_KEY, MONO_KEY } from '../lib/fonts';
import type { Store } from '../lib/store.svelte';
import { chatPrefs, readChatPrefs } from '../lib/chat-prefs.svelte';
import { phoneWidth } from '../test/phone-width';

let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  localStorage.clear();
  Object.assign(chatPrefs, readChatPrefs());
});

function pressed(testid: string): string | null {
  return document.querySelector(`[data-testid=${testid}]`)?.getAttribute('aria-pressed') ?? null;
}

test('Appearance keeps visual choices only: the behaviour switches live under General', () => {
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
  flushSync();
  for (const id of ['chat-group-changes', 'chat-expand-diffs', 'terminal-gpu', 'start-in-drafts', 'panel-start-files']) {
    expect(document.querySelector(`[data-testid=${id}]`), id).toBeNull();
  }
  expect(document.querySelector('[data-testid=chat-width-comfortable]')).not.toBeNull();
});

test('faces picked in another window move the selected buttons here', () => {
  // The page reads only `owner` from the store, to list the owner's own buttons.
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as unknown as Store } });
  flushSync();
  expect(pressed('font-inter')).toBe('true');
  expect(pressed('font-mono-geist')).toBe('true');

  localStorage.setItem(FONT_KEY, 'plex');
  localStorage.setItem(MONO_KEY, 'jetbrains');
  window.dispatchEvent(new StorageEvent('storage', { key: FONT_KEY }));
  window.dispatchEvent(new StorageEvent('storage', { key: MONO_KEY }));
  flushSync();

  expect(pressed('font-plex')).toBe('true');
  expect(pressed('font-inter')).toBe('false');
  expect(pressed('font-mono-jetbrains')).toBe('true');
  expect(pressed('font-mono-geist')).toBe('false');
});

test('the palette tiles stand in one row sized to their count, so no row ends with a hole', () => {
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
  flushSync();
  const group = document.querySelector<HTMLElement>('.presets')!;
  const tiles = group.querySelectorAll('[data-testid^=palette-]').length;
  // Four columns once left seven tiles as four and three.
  expect(tiles).toBeGreaterThan(4);
  expect(group.style.getPropertyValue('--count')).toBe(String(tiles));
});

test('a phone opens its palette list on the current palette once: the head turns into the list title', () => {
  const restore = phoneWidth();
  try {
    running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
    flushSync();
    const head = document.querySelector<HTMLButtonElement>('[data-testid=palette-current]')!;
    const current = head.textContent!.trim();
    expect(document.querySelector('.presets')).toBeNull();
    head.click();
    flushSync();
    const colors = document.querySelector('[data-testid=theme-colors]')!.textContent!;
    // The palette in use, by name, once: in the list, checked, not again in the head row.
    expect(colors.split(current).length - 1).toBe(1);
    expect(document.querySelector('[data-testid=palette-current] .preview')).toBeNull();
    expect(document.querySelector('.presets [aria-pressed=true]')?.textContent).toContain(current);
  } finally { restore(); }
});
