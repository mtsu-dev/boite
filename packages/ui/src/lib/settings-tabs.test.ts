import { describe, expect, test } from 'vitest';
import { SETTINGS_FAMILIES, SETTINGS_TABS, desktopPage, familyOf, movedTo, navOf, phonePage, sectionsOf, viewOf } from './settings-tabs';

describe('the settings families', () => {
  test('four families hold every page once, each page a peer inside its family', () => {
    const listed = SETTINGS_FAMILIES.flatMap((family) => [...family.pages]);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(SETTINGS_TABS.filter((tab) => tab !== 'home').sort());
    expect(SETTINGS_FAMILIES.map((family) => family.id)).toEqual(['app', 'agents', 'connections', 'advanced']);
    expect(familyOf('keyboard')).toBe('app');
    expect(familyOf('voice')).toBe('app');
    expect(familyOf('plugins')).toBe('agents');
    expect(familyOf('usage')).toBe('agents');
    expect(familyOf('browser')).toBe('connections');
    expect(familyOf('diagnostics')).toBe('advanced');
    expect(familyOf('home')).toBeNull();
  });

  test('round 20: Voice, Usage, Plugins and Experiments open as pages of their own, not as sections of an unrelated parent', () => {
    for (const tab of ['voice', 'usage', 'plugins', 'experiments', 'keyboard', 'limits', 'machines'] as const) expect(desktopPage(tab, true)).toBe(tab);
    expect(desktopPage('voice', false)).toBe('voice');
    expect(sectionsOf('general', true)).toEqual([]);
    expect(sectionsOf('limits', true)).toEqual([]);
    expect(sectionsOf('accounts', true)).toEqual([]);
    expect(sectionsOf('advanced', true)).toEqual([]);
    expect(sectionsOf('diagnostics', true)).toEqual(['resources', 'task-manager']);
    expect(desktopPage('resources', true)).toBe('diagnostics');
    expect(phonePage('voice', null, true)).toBe('voice');
    expect(phonePage('voice', null, false)).toBe('voice');
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
    expect(navOf('advanced', true)).not.toContain('task-manager');

    // A paired device may not read the logs, so Diagnostics is not its to host the task manager.
    expect(viewOf('task-manager', false)).toBe('task-manager');
    expect(desktopPage('task-manager', false)).toBe('task-manager');
    expect(phonePage('task-manager', null, false)).toBe('task-manager');
    expect(sectionsOf('diagnostics', false)).toEqual([]);
    expect(navOf('advanced', false)).toContain('task-manager');
    expect(navOf('advanced', false)).not.toContain('diagnostics');
  });

  test('a card that moved opens on its new page from a link to the old one; on a phone, quiet sits on the conversations page and the keys and windows on the page of their task', () => {
    expect(movedTo('appearance', 'workspace')).toBe('general');
    expect(movedTo('resources', 'quiet')).toBe('general');
    expect(movedTo('resources', 'limits')).toBeUndefined();
    expect(movedTo('resources', null)).toBeUndefined();
    expect(phonePage('general', 'quiet', true)).toBe('conversations');
    expect(phonePage('general', 'quiet', false)).toBe('home');
    // General's odd cards live with their task, a project menu's old link included.
    expect(movedTo('general', 'secrets')).toBe('accounts');
    expect(movedTo('general', 'windows')).toBe('machines');
    expect(movedTo('general', 'window-exclusions')).toBe('machines');
    expect(phonePage('general', 'secrets', true)).toBe('accounts');
    expect(phonePage('general', 'windows', true)).toBe('machines');
    // Providers is the owner's: a paired phone's old link lands on Home.
    expect(phonePage('general', 'secrets', false)).toBe('home');
    expect(phonePage('advanced', 'auto-compact', true)).toBe('advanced');
  });

  test('the browser has its own entry: a link to its card under General or Providers opens it, a paired device lands on Home', () => {
    expect(movedTo('general', 'browser-profiles')).toBe('browser');
    expect(movedTo('accounts', 'browser-profiles')).toBe('browser');
    expect(desktopPage('browser', true)).toBe('browser');
    expect(desktopPage('browser', false)).toBe('general');
    expect(phonePage('general', 'browser-profiles', true)).toBe('browser');
    expect(phonePage('accounts', 'browser-profiles', true)).toBe('browser');
    expect(phonePage('browser', null, false)).toBe('home');
  });

  test('a page that is not merged opens itself', () => {
    for (const tab of ['keyboard', 'limits', 'machines'] as const) expect(desktopPage(tab, true)).toBe(tab);
    // A desktop has no page between the nav and a page: Home, or a page this window may not open, shows General.
    expect(desktopPage('home', true)).toBe('general');
    expect(desktopPage('resources', false)).toBe('general');
  });

  test('the nav lists each family\'s pages as peers, in the phone\'s order, and leaves out one merged into another', () => {
    expect(navOf('app', true)).toEqual(['general', 'keyboard', 'voice', 'appearance']);
    expect(navOf('agents', true)).toEqual(['accounts', 'plugins', 'brain', 'limits', 'usage']);
    expect(navOf('connections', true)).toEqual(['browser', 'machines']);
    expect(navOf('advanced', true)).toEqual(['advanced', 'experiments', 'diagnostics']);
    // A paired device: no Diagnostics, so the task manager is its own page; Providers, Plugins and Instructions are the owner's.
    expect(navOf('advanced', false)).toEqual(['advanced', 'experiments', 'task-manager']);
    expect(navOf('agents', false)).toEqual(['limits', 'usage']);
  });
});
