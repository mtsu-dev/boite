import { afterEach, describe, expect, test } from 'vitest';
import { LAYOUT_STORAGE_KEY, readLayout, SIDEBAR_DEFAULT, writeLayout } from './prefs';

afterEach(() => window.localStorage.clear());

describe('sidebar width', () => {
  test('a sidebar never dragged follows the default, a folded one included', () => {
    expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
    writeLayout({ sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: true });
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY)!)).toEqual({ sidebarCollapsed: true });
    expect(readLayout()).toEqual({ sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: true });
  });

  test('the former 280 px default, stored by a fold or a reset, reads as the default', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 280, sidebarCollapsed: false }));
    expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
    expect(SIDEBAR_DEFAULT).toBe(304);
  });

  test('a width the user dragged stays theirs', () => {
    writeLayout({ sidebarWidth: 352, sidebarCollapsed: false });
    expect(readLayout().sidebarWidth).toBe(352);
  });
});
