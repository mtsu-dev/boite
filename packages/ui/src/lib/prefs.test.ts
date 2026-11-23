import { afterEach, expect, test } from 'vitest';
import { AGENTS_SIDEBAR_MAX, LAYOUT_STORAGE_KEY, readLayout, SIDEBAR_DEFAULT, SIDEBAR_MAX, sidebarMax, visibleSidebarWidth } from './prefs';

afterEach(() => window.localStorage.clear());

test('the list column opens wide enough for a title of about 30 characters, a width saved at an old default included', () => {
  expect(SIDEBAR_DEFAULT).toBeGreaterThanOrEqual(300);
  expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  // Folding the list once saved the width it had: 280 then was the default, not a choice.
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 280, sidebarCollapsed: false }));
  expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 300, sidebarCollapsed: false }));
  expect(readLayout().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  // A width the user dragged to stays theirs.
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 252, sidebarCollapsed: true }));
  expect(readLayout()).toEqual({ sidebarWidth: 252, sidebarCollapsed: true });
});

test('visibleSidebarWidth caps the Mochis column outside a drawer while keeping the thread list width', () => {
  expect(sidebarMax('chat')).toBe(SIDEBAR_MAX);
  expect(sidebarMax('agents')).toBe(AGENTS_SIDEBAR_MAX);
  expect(sidebarMax('agents', true)).toBe(SIDEBAR_MAX);

  expect(visibleSidebarWidth({ sidebarWidth: 380, page: 'chat' })).toBe(380);
  expect(visibleSidebarWidth({ sidebarWidth: 380, page: 'agents' })).toBe(AGENTS_SIDEBAR_MAX);
  expect(visibleSidebarWidth({ sidebarWidth: 380, page: 'agents' }, true)).toBe(380);
  expect(visibleSidebarWidth({ sidebarWidth: 240, page: 'agents' })).toBe(240);
  expect(visibleSidebarWidth({ sidebarWidth: 380, agentsSidebarWidth: 240, page: 'agents' })).toBe(240);
  expect(visibleSidebarWidth({ sidebarWidth: 380, agentsSidebarWidth: 240, page: 'chat' })).toBe(380);

  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sidebarWidth: 380, sidebarCollapsed: false, agentsSidebarWidth: 400 }));
  expect(readLayout()).toEqual({ sidebarWidth: 380, sidebarCollapsed: false, agentsSidebarWidth: AGENTS_SIDEBAR_MAX });
});

