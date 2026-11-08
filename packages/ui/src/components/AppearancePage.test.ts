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

/** Opens a choice's selector and answers which of its options is checked. */
function checked(trigger: string): string | undefined {
  const head = document.querySelector<HTMLButtonElement>(`[data-testid=${trigger}]`)!;
  if (head.getAttribute('aria-expanded') !== 'true') head.click();
  flushSync();
  const on = document.querySelector(`[data-testid=${trigger}-list] [aria-checked=true]`)?.getAttribute('data-testid') ?? undefined;
  head.click();
  flushSync();
  return on;
}

test('faces picked in another window move the selected buttons here', () => {
  // The page reads only `owner` from the store, to list the owner's own buttons.
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as unknown as Store } });
  flushSync();
  expect(checked('font-current')).toBe('font-inter');
  expect(checked('font-mono-current')).toBe('font-mono-geist');

  localStorage.setItem(FONT_KEY, 'plex');
  localStorage.setItem(MONO_KEY, 'jetbrains');
  window.dispatchEvent(new StorageEvent('storage', { key: FONT_KEY }));
  window.dispatchEvent(new StorageEvent('storage', { key: MONO_KEY }));
  flushSync();

  expect(document.querySelector('[data-testid=font-current]')!.textContent).toContain('IBM Plex Sans');
  expect(checked('font-current')).toBe('font-plex');
  expect(checked('font-mono-current')).toBe('font-mono-jetbrains');
});

test('a desktop shows every palette as its picture with its name, the one in use checked', () => {
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
  flushSync();
  const group = document.querySelector('[data-testid=palette-current]')!;
  expect(group.getAttribute('role')).toBe('group');
  const tiles = () => [...group.querySelectorAll('button[aria-pressed]')];
  expect(tiles().length).toBeGreaterThan(2);
  expect(tiles().every((tile) => tile.getAttribute('data-testid')!.startsWith('palette-') && tile.querySelector('.tile') !== null && tile.textContent!.trim() !== '')).toBe(true);
  expect(tiles().filter((tile) => tile.getAttribute('aria-pressed') === 'true').map((tile) => tile.getAttribute('data-testid'))).toEqual(['palette-default']);
  // No selector to open: the pictures are the choice.
  expect(document.querySelector('[data-testid=palette-current-list]')).toBeNull();
});

for (const phone of [false, true]) {
  test(`a ${phone ? 'phone' : 'desktop'} shows a few palettes in front, the one in use among them, and "All themes" opens the rest`, async () => {
    const restore = phone ? phoneWidth() : () => {};
    try {
      running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store, phone } });
      flushSync();
      if (phone) { document.querySelector<HTMLButtonElement>('[data-testid=palette-current]')!.click(); flushSync(); }
      const box = phone ? '[data-testid=palette-current-list]' : '[data-testid=palette-current]';
      const shown = () => [...document.querySelectorAll(`${box} :is([aria-pressed], [role=menuitemradio])`)].map((tile) => tile.getAttribute('data-testid'));
      const all = () => document.querySelector<HTMLButtonElement>(`[data-testid=${phone ? 'palette-current-all' : 'palette-all'}]`);
      expect(shown()).toEqual(['palette-default', 'palette-oled', 'palette-catppuccin', 'palette-tokyo-night']);
      expect(all()?.textContent?.trim()).toBe('All themes');
      all()!.click();
      flushSync();
      expect(shown()).toHaveLength(7);
      expect(all()).toBeNull();
      // Focus lands on the first palette the button revealed, not on the page.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.activeElement?.getAttribute('data-testid')).toBe('palette-nord');
    } finally { restore(); }
  });
}

for (const phone of [false, true]) {
  test(`a face reads the same on a ${phone ? 'phone' : 'desktop'}, and a phone's palette too: the one in use as a row, a palette by its preview, a face by its name drawn in it`, () => {
    const restore = phone ? phoneWidth() : () => {};
    try {
      running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store, phone } });
      flushSync();
      for (const [trigger, option] of phone ? [['palette-current', 'palette-'], ['font-current', 'font-']] as const : [['font-current', 'font-']] as const) {
        const head = document.querySelector<HTMLButtonElement>(`[data-testid=${trigger}]`)!;
        // Shut, the row is the whole choice, no tiles beside it: a palette shows its preview, a face only its name,
        // set in that face (no "Il1 O0 rn" specimen).
        const face = trigger === 'font-current';
        const shows = (row: Element) => face
          ? row.querySelector('.preview') === null && (row.querySelector<HTMLElement>('.name')?.style.fontFamily ?? '').startsWith('var(--face-')
          : row.querySelector('.preview')?.childElementCount === 1;
        expect(shows(head)).toBe(true);
        expect(document.querySelector(`[data-testid=${trigger}-list]`)).toBeNull();
        head.click();
        flushSync();
        const rows = [...document.querySelectorAll(`[data-testid=${trigger}-list] [role=menuitemradio]`)];
        expect(rows.length).toBeGreaterThan(2);
        expect(rows.every((row) => row.getAttribute('data-testid')!.startsWith(option) && shows(row))).toBe(true);
        // The one in use, checked once, by the same name the row shows.
        const on = rows.filter((row) => row.getAttribute('aria-checked') === 'true');
        expect(on).toHaveLength(1);
        expect(head.textContent).toContain(on[0]!.textContent!.trim());
        on[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        flushSync();
        expect(head.getAttribute('aria-expanded')).toBe('false');
      }
    } finally { restore(); }
  });
}

test('picking a face from its list applies it, names it in the row and gives the focus back to the row', () => {
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
  flushSync();
  const head = document.querySelector<HTMLButtonElement>('[data-testid=font-current]')!;
  head.click();
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=font-current-list] [data-testid=font-atkinson]')!.click();
  flushSync();
  expect(localStorage.getItem(FONT_KEY)).toBe('atkinson');
  expect(head.textContent).toContain('Atkinson Hyperlegible');
  expect(head.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(head);
});
