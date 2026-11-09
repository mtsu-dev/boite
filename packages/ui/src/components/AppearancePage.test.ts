import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AppearancePage from './AppearancePage.svelte';
import { FONT_KEY, MONO_KEY } from '../lib/fonts';
import type { Store } from '../lib/store.svelte';
import { chatPrefs, readChatPrefs } from '../lib/chat-prefs.svelte';
import { phoneWidth } from '../test/phone-width';
import { setLocaleSetting } from '../lib/i18n.svelte';

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
});

for (const phone of [false, true]) {
  test(`a ${phone ? 'phone' : 'desktop'} shows a few palettes in front, the one in use among them, and "All themes" opens the rest`, async () => {
    const restore = phone ? phoneWidth() : () => {};
    try {
      running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store, phone } });
      flushSync();
      // The same pictures on a phone, in sight, no sheet to open first.
      const shown = () => [...document.querySelectorAll('[data-testid=palette-current] [aria-pressed]')].map((tile) => tile.getAttribute('data-testid'));
      const all = () => document.querySelector<HTMLButtonElement>('[data-testid=palette-all]');
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
  test(`a face reads the same on a ${phone ? 'phone' : 'desktop'}: the one in use as a row, its name drawn in it, the list each by its own face`, () => {
    const restore = phone ? phoneWidth() : () => {};
    try {
      running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store, phone } });
      flushSync();
      for (const [trigger, option] of [['font-current', 'font-'], ['font-mono-current', 'font-mono-']] as const) {
        const head = document.querySelector<HTMLButtonElement>(`[data-testid=${trigger}]`)!;
        // Shut, the row is the whole choice, no tiles beside it: a palette shows its preview, a face only its name,
        // set in that face (no "Il1 O0 rn" specimen).
        const shows = (row: Element) => row.querySelector('.preview') === null && (row.querySelector<HTMLElement>('.name')?.style.fontFamily ?? '').startsWith('var(--face-');
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

test('a phone shows each short choice in place as a desktop does: every option of language and theme in sight, the palettes as pictures, the one in use checked; only a face opens a list', () => {
  const restore = phoneWidth();
  try {
    running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store, phone: true } });
    flushSync();
    // Round 16: a value row hid three or four options behind a sheet; the segments show them all, the one in use lit.
    for (const [group, options] of [['locale-current', ['locale-system', 'locale-en', 'locale-fr']], ['theme-current', ['theme-system', 'theme-light', 'theme-dark']]] as const) {
      const box = document.querySelector(`[data-testid=${group}]`)!;
      expect(box.classList.contains('segmented'), group).toBe(true);
      expect(box.closest('.value'), group).toBeNull();
      for (const option of options) expect(box.querySelector(`[data-testid=${option}]`), option).not.toBeNull();
      expect(box.querySelectorAll('[aria-pressed=true]'), group).toHaveLength(1);
    }
    document.querySelector<HTMLButtonElement>('[data-testid=theme-light]')!.click();
    flushSync();
    expect(localStorage.getItem('boite.theme')).toBe('light');
    expect(pressed('theme-light')).toBe('true');
    expect(pressed('theme-system')).toBe('false');
    // The palettes: pictures in their own colours, the one in use ringed and checked.
    const grid = document.querySelector('[data-testid=palette-current]')!;
    expect(grid.getAttribute('role')).toBe('group');
    const on = [...grid.querySelectorAll('[aria-pressed=true]')];
    expect(on.map((tile) => tile.getAttribute('data-testid'))).toEqual(['palette-default']);
    expect(on[0]!.querySelector('.picked')).not.toBeNull();
    expect(grid.querySelectorAll('.picked')).toHaveLength(1);
    // A face, a longer list, stays one row in its own face that opens the others.
    for (const trigger of ['font-current', 'font-mono-current']) {
      const head = document.querySelector<HTMLButtonElement>(`[data-testid=${trigger}]`)!;
      expect(head.closest('.choice-select')!.classList.contains('row'), trigger).toBe(true);
      expect(head.closest('.value'), trigger).not.toBeNull();
    }
  } finally { restore(); }
});

test('the language segment lights the language set elsewhere (another window, a script), not the one it opened on', async () => {
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
  flushSync();
  expect(pressed('locale-system')).toBe('true');
  try {
    await setLocaleSetting('en');
    flushSync();
    expect(pressed('locale-en')).toBe('true');
    expect(pressed('locale-system')).toBe('false');
  } finally { await setLocaleSetting('system'); }
  flushSync();
  expect(pressed('locale-system')).toBe('true');
});

test('round 20: each face shows a sample line in itself, and the chat width a paragraph at the width pointed at before it is picked', () => {
  running = mount(AppearancePage, { target: document.body, props: { store: { owner: true } as Store } });
  flushSync();
  const sample = () => document.querySelector<HTMLElement>('[data-testid=font-sample]')!;
  expect(sample().style.fontFamily).toBe('var(--face-inter)');
  expect(document.querySelector<HTMLElement>('[data-testid=font-mono-sample]')!.style.fontFamily).toBe('var(--face-mono-geist)');
  document.querySelector<HTMLButtonElement>('[data-testid=font-current]')!.click();
  flushSync();
  document.querySelector<HTMLButtonElement>('[data-testid=font-current-list] [data-testid=font-atkinson]')!.click();
  flushSync();
  expect(sample().style.fontFamily).toBe('var(--face-atkinson)');

  const width = () => document.querySelector('[data-testid=chat-width-sample]')!.getAttribute('data-width');
  expect(width()).toBe('comfortable');
  const wide = document.querySelector<HTMLButtonElement>('[data-testid=chat-width-wide]')!;
  wide.dispatchEvent(new PointerEvent('pointerenter'));
  flushSync();
  expect(width(), 'pointed at, not picked').toBe('wide');
  expect(wide.getAttribute('aria-pressed')).toBe('false');
  wide.dispatchEvent(new PointerEvent('pointerleave'));
  flushSync();
  expect(width()).toBe('comfortable');
  document.querySelector<HTMLButtonElement>('[data-testid=chat-width-full]')!.click();
  flushSync();
  expect(width()).toBe('full');
});
