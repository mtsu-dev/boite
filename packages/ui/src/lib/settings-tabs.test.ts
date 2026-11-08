import { describe, expect, test } from 'vitest';
import { SETTINGS_GROUPS, SETTINGS_TABS, desktopPage, groupOf, pagesOf, phonePage, sectionsOf, viewOf } from './settings-tabs';

describe('the merged settings', () => {
  test('eight entries hold every page once, the same list on desktop and phone', () => {
    expect(SETTINGS_GROUPS).toHaveLength(8);
    const listed = SETTINGS_GROUPS.flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(SETTINGS_TABS.filter((tab) => tab !== 'home').sort());
    expect(groupOf('keyboard')).toBe('general');
    expect(groupOf('voice')).toBe('general');
    expect(groupOf('experiments')).toBe('advanced');
    expect(groupOf('task-manager')).toBe('advanced');
    expect(groupOf('usage')).toBe('limits');
  });

  test('an old task-manager link opens Diagnostics at its section for the owner, its own page for a device', () => {
    expect(viewOf('task-manager', true)).toBe('diagnostics');
    expect(desktopPage('task-manager', true)).toBe('diagnostics');
    expect(phonePage('task-manager', null, true)).toBe('diagnostics');
    expect(sectionsOf('diagnostics', true)).toEqual(['task-manager']);
    expect(pagesOf('advanced', true)).not.toContain('task-manager');

    // A paired device may not read the logs, so Diagnostics is not its to host the task manager.
    expect(viewOf('task-manager', false)).toBe('task-manager');
    expect(desktopPage('task-manager', false)).toBe('task-manager');
    expect(phonePage('task-manager', null, false)).toBe('task-manager');
    expect(sectionsOf('diagnostics', false)).toEqual([]);
    expect(pagesOf('advanced', false)).toContain('task-manager');
    expect(pagesOf('advanced', false)).not.toContain('diagnostics');
  });

  test('a page that is not merged opens itself', () => {
    for (const tab of ['keyboard', 'voice', 'usage', 'limits', 'experiments'] as const) expect(desktopPage(tab, true)).toBe(tab);
  });
});
