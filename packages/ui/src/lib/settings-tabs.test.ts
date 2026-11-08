import { describe, expect, test } from 'vitest';
import { SETTINGS_GROUPS, SETTINGS_TABS, desktopPage, groupOf, movedTo, navOf, pagesOf, phonePage, sectionsOf, viewOf } from './settings-tabs';

describe('the merged settings', () => {
  test('seven entries hold every page once, the same list on desktop and phone', () => {
    expect(SETTINGS_GROUPS).toHaveLength(7);
    const listed = SETTINGS_GROUPS.flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(SETTINGS_TABS.filter((tab) => tab !== 'home').sort());
    expect(groupOf('keyboard')).toBe('general');
    expect(groupOf('voice')).toBe('general');
    expect(groupOf('experiments')).toBe('advanced');
    expect(groupOf('task-manager')).toBe('advanced');
    expect(groupOf('usage')).toBe('limits');
    expect(groupOf('resources')).toBe('advanced');
  });

  test('the owner\'s desktop shows nine pages, the small ones as sections of their family; a phone keeps Voice, Usage and Experiments as pages', () => {
    const pages = SETTINGS_GROUPS.flatMap((group) => pagesOf(group[0], true));
    expect(pages).toEqual(['general', 'keyboard', 'appearance', 'accounts', 'brain', 'limits', 'machines', 'advanced', 'diagnostics']);
    // Round 16: Voice alone on a page was three cards on an empty screen; it closes General.
    expect(sectionsOf('general', true)).toEqual(['voice']);
    expect(desktopPage('voice', true)).toBe('general');
    expect(desktopPage('voice', false)).toBe('general');
    expect(phonePage('voice', null, true)).toBe('voice');
    expect(phonePage('voice', null, false)).toBe('voice');
    expect(sectionsOf('limits', true)).toEqual(['usage']);
    expect(sectionsOf('accounts', true)).toEqual(['plugins']);
    expect(sectionsOf('advanced', true)).toEqual(['experiments']);
    expect(sectionsOf('diagnostics', true)).toEqual(['resources', 'task-manager']);
    for (const [route, view] of [['usage', 'limits'], ['plugins', 'accounts'], ['experiments', 'advanced'], ['resources', 'diagnostics']] as const) expect(desktopPage(route, true)).toBe(view);
    expect(phonePage('usage', null, true)).toBe('usage');
    expect(phonePage('experiments', null, true)).toBe('experiments');
    expect(phonePage('resources', null, true)).toBe('diagnostics');
    expect(phonePage('resources', null, false)).toBe('home');
    expect(phonePage('plugins', null, true)).toBe('home');
  });

  test('an old task-manager link opens Diagnostics at its section for the owner, its own page for a device', () => {
    expect(viewOf('task-manager', true)).toBe('diagnostics');
    expect(desktopPage('task-manager', true)).toBe('diagnostics');
    expect(phonePage('task-manager', null, true)).toBe('diagnostics');
    expect(pagesOf('advanced', true)).not.toContain('task-manager');

    // A paired device may not read the logs, so Diagnostics is not its to host the task manager.
    expect(viewOf('task-manager', false)).toBe('task-manager');
    expect(desktopPage('task-manager', false)).toBe('task-manager');
    expect(phonePage('task-manager', null, false)).toBe('task-manager');
    expect(sectionsOf('diagnostics', false)).toEqual([]);
    expect(pagesOf('advanced', false)).toContain('task-manager');
    expect(pagesOf('advanced', false)).not.toContain('diagnostics');
  });

  test('a card that moved opens on its new page from a link to the old one; on a phone, quiet sits on the conversations page and browser profiles beside the keys', () => {
    expect(movedTo('appearance', 'workspace')).toBe('general');
    expect(movedTo('resources', 'quiet')).toBe('general');
    expect(movedTo('resources', 'limits')).toBeUndefined();
    expect(movedTo('resources', null)).toBeUndefined();
    expect(phonePage('general', 'quiet', true)).toBe('conversations');
    expect(phonePage('general', 'quiet', false)).toBe('home');
    expect(phonePage('general', 'browser-profiles', true)).toBe('secrets');
    expect(phonePage('advanced', 'auto-compact', true)).toBe('advanced');
  });

  test('a page that is not merged opens itself', () => {
    for (const tab of ['keyboard', 'limits', 'machines'] as const) expect(desktopPage(tab, true)).toBe(tab);
    // A desktop has no page between the nav and a page: Home, or a page this window may not open, shows General.
    expect(desktopPage('home', true)).toBe('general');
    expect(desktopPage('resources', false)).toBe('general');
  });

  test('the desktop nav still names a section merged into its entry\'s page, in the phone\'s order, and leaves out one merged deeper', () => {
    expect(navOf('general', true)).toEqual(['general', 'keyboard', 'voice']);
    expect(navOf('limits', true)).toEqual(['limits', 'usage']);
    expect(navOf('accounts', true)).toEqual(['accounts', 'plugins']);
    expect(navOf('advanced', true)).toEqual(['advanced', 'experiments', 'diagnostics']);
    // A paired device: no Diagnostics, so the task manager is its own page; Plugins is the owner's.
    expect(navOf('advanced', false)).toEqual(['advanced', 'experiments', 'task-manager']);
    expect(navOf('accounts', false)).toEqual([]);
  });
});
