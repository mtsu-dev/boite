import { afterEach, expect, test } from 'vitest';
import { LAYOUT_STORAGE_KEY, readLayout, SIDEBAR_DEFAULT } from './prefs';

afterEach(() => window.localStorage.clear());

test('the list column opens wide enough for a title of about 30 characters, a width saved at the old default included', () => {
  expect(SIDEBAR_DEFAULT).toBeGreaterThanOrEqual(300);
  expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  // Folding the list once saved the width it had: 280 then was the default, not a choice.
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 280, sidebarCollapsed: false }));
  expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  // A width the user dragged to stays theirs.
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 252, sidebarCollapsed: true }));
  expect(readLayout()).toEqual({ sidebarWidth: 252, sidebarCollapsed: true });
});
