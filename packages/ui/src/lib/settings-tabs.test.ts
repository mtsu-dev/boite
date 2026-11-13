import { beforeEach, describe, expect, test, vi } from 'vitest';
import { REQUESTABLE_SETTINGS, SETTINGS_PAGES, SETTINGS_PAGE_ALIASES } from '@boite/contracts';

const experiments = vi.hoisted(() => ({ shown: true }));
vi.mock('./experiments.svelte', () => ({ experimentsShown: () => experiments.shown }));

import { PAGES, aliasesOf, SETTINGS_CARDS, SETTINGS_TABS, blocksOf, cardOf, cardsOf, desktopHas, desktopPage, desktopPlace, legacyRoute, machinePage, navOf, navSectionsOf, ownerOnly, pageScopeOf, phonePage, placeOf, type SettingsTab } from './settings-tabs';

beforeEach(() => { experiments.shown = true; });

/**
 * Every page and card Settings had before the map, as the old nav and its
 * search named them (the old `SettingsShell.svelte`), with the page each must
 * open now.
 */
const BEFORE: readonly (readonly [SettingsTab, string | null, string, string | null])[] = [
  ['home', null, 'appearance', null],
  ['general', null, 'conversations', null],
  ['general', 'thread-list', 'conversations', 'thread-list'],
  ['general', 'conversations', 'conversations', 'conversations'],
  ['general', 'notifications', 'conversations', 'notifications'],
  ['general', 'agent-replies', 'conversations', 'agent-replies'],
  ['general', 'quiet', 'safeguards', 'quiet'],
  ['general', 'workspace', 'appearance', 'workspace'],
  ['general', 'archived', 'conversations', 'archived'],
  ['general', 'worktrees', 'conversations', 'worktrees'],
  ['general', 'app', 'devices', 'app'],
  ['general', 'privacy', 'safeguards', 'privacy'],
  ['general', 'policy', 'safeguards', 'policy'],
  ['appearance', null, 'appearance', null],
  ['appearance', 'theme', 'appearance', 'theme'],
  ['appearance', 'reading', 'appearance', 'reading'],
  ['appearance', 'buttons', 'appearance', 'buttons'],
  ['keyboard', null, 'input', 'keyboard'],
  ['keyboard', 'keys-chat', 'input', 'keys-chat'],
  ['keyboard', 'keybinding-file', 'input', 'keybinding-file'],
  ['voice', null, 'input', 'voice'],
  ['accounts', null, 'ai', null],
  ['accounts', 'provider-claude', 'ai', 'provider-claude'],
  ['accounts', 'agent-updates', 'version', 'agent-updates'],
  ['accounts', 'secrets', 'ai', 'secrets'],
  ['plugins', null, 'agents', 'plugins'],
  ['plugins', 'plugins-add', 'agents', 'plugins-add'],
  ['browser', null, 'safeguards', 'browser-profiles'],
  ['browser', 'browser-profiles', 'safeguards', 'browser-profiles'],
  ['brain', null, 'agents', null],
  ['brain', 'brain-folder', 'agents', 'brain-folder'],
  ['brain', 'hooks', 'agents', 'hooks'],
  ['usage', null, 'ai', 'usage'],
  ['usage', 'usage-overview', 'ai', 'usage-overview'],
  ['usage', 'usage-chart', 'ai', 'usage-chart'],
  ['usage', 'usage-breakdown', 'ai', 'usage-breakdown'],
  ['usage', 'usage-threads', 'ai', 'usage-threads'],
  ['limits', null, 'ai', 'quotas'],
  ['limits', 'limit-resume', 'ai', 'limit-resume'],
  ['task-manager', null, 'help', 'task-manager'],
  ['resources', null, 'safeguards', 'limits'],
  ['resources', 'limits', 'safeguards', 'limits'],
  ['resources', 'tasks', 'help', 'tasks'],
  ['machines', null, 'devices', null],
  ['machines', 'updates', 'version', 'updates'],
  ['machines', 'machines', 'devices', 'machines'],
  ['machines', 'group', 'devices', 'group'],
  ['machines', 'windows', 'safeguards', 'windows'],
  ['machines', 'window-exclusions', 'safeguards', 'window-exclusions'],
  ['advanced', null, 'agents', 'auto-compact'],
  ['advanced', 'execution', 'agents', 'execution'],
  ['advanced', 'auto-compact', 'agents', 'auto-compact'],
  ['advanced', 'phone', 'devices', 'phone'],
  ['advanced', 'origins', 'devices', 'origins'],
  ['advanced', 'details', 'appearance', 'details'],
  ['advanced', 'core', 'help', 'core'],
  ['experiments', null, 'version', 'experiments'],
  ['experiments', 'whip', 'version', 'whip'],
  ['experiments', 'background-compaction', 'version', 'background-compaction'],
  ['experiments', 'device-stream', 'version', 'device-stream'],
  ['diagnostics', null, 'help', null],
  ['diagnostics', 'diagnostics-status', 'help', 'diagnostics-status'],
  ['diagnostics', 'diagnostics-problems', 'help', 'diagnostics-problems'],
  ['diagnostics', 'diagnostics-log', 'help', 'diagnostics-log'],
  ['diagnostics', 'diagnostics-agents', 'help', 'diagnostics-agents'],
  // Links that named a card on a page it had already left still follow the card.
  ['general', 'secrets', 'ai', 'secrets'],
  ['general', 'browser-profiles', 'safeguards', 'browser-profiles'],
  ['resources', 'quiet', 'safeguards', 'quiet'],
  ['appearance', 'workspace', 'appearance', 'workspace']
];

describe('the map of Settings', () => {
  test('nine pages in the nav order, and every route from before is still a route', () => {
    expect([...SETTINGS_PAGES]).toEqual(['appearance', 'input', 'conversations', 'ai', 'agents', 'safeguards', 'devices', 'version', 'help']);
    expect(navOf(true)).toEqual([...SETTINGS_PAGES]);
    for (const old of ['home', 'advanced', 'brain', 'voice', 'general', 'machines', 'keyboard', 'accounts', 'plugins', 'browser', 'usage', 'limits', 'resources', 'task-manager', 'experiments', 'diagnostics']) {
      expect(SETTINGS_TABS, old).toContain(old);
    }
    expect(SETTINGS_PAGE_ALIASES.every((alias) => (SETTINGS_TABS as readonly string[]).includes(alias))).toBe(true);
  });

  test('every card sits on exactly one page, under an id no other card has', () => {
    const ids = SETTINGS_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const card of SETTINGS_CARDS) expect(SETTINGS_PAGES, card.id).toContain(card.page);
    for (const page of SETTINGS_PAGES) {
      expect(cardsOf(page, true).length, page).toBeGreaterThan(0);
      // A block is one run of cards: the same component is never drawn twice on a page.
      const blocks = blocksOf(page, true).map((entry) => entry.block);
      expect(new Set(blocks).size, page).toBe(blocks.length);
      expect(blocksOf(page, true).flatMap((entry) => entry.cards.map((card) => card.id))).toEqual(cardsOf(page, true).map((card) => card.id));
    }
  });

  test('each page holds the cards the map gives it, in its order', () => {
    const ids = (page: typeof SETTINGS_PAGES[number]) => cardsOf(page, true).map((card) => card.id);
    expect(ids('appearance')).toEqual(['theme', 'reading', 'buttons', 'workspace', 'details']);
    expect(ids('input')).toEqual(['keyboard', 'keybinding-file', 'voice']);
    expect(ids('conversations')).toEqual(['thread-list', 'conversations', 'notifications', 'agent-replies', 'archived', 'worktrees']);
    expect(ids('ai')).toEqual(['providers', 'local-acp', 'secrets', 'quotas', 'limit-resume', 'subscription-proxy', 'usage']);
    expect(ids('agents')).toEqual(['brain', 'hooks', 'plugins', 'auto-compact', 'execution']);
    expect(ids('safeguards')).toEqual(['quiet', 'windows', 'window-exclusions', 'limits', 'browser-profiles', 'privacy', 'policy']);
    expect(ids('devices')).toEqual(['app', 'main-machine', 'group', 'machines', 'phone', 'origins']);
    expect(ids('version')).toEqual(['updates', 'agent-updates', 'experiments', 'cache-keepalive', 'background-compaction', 'device-stream']);
    expect(ids('help')).toEqual(['diagnostics-status', 'diagnostics-problems', 'diagnostics-log', 'diagnostics-agents', 'tasks', 'task-manager', 'core', 'tour']);
    // Conversations: this device's cards first, then the machine's.
    const scopes = cardsOf('conversations', true).map((card) => card.scope);
    expect(scopes).toEqual(['device', 'device', 'device', 'machine', 'machine', 'machine']);
    // The subscription proxy is one card, on one page.
    expect(SETTINGS_CARDS.filter((card) => card.id.includes('proxy')).map((card) => card.page)).toEqual(['ai']);
  });

  test('every page and card from before the map opens on its new page', () => {
    for (const [tab, section, page, landing] of BEFORE) {
      expect(placeOf(tab, section), `${tab} ${section}`).toEqual({ page, section: landing });
      expect(desktopPage(tab, true, section), `${tab} ${section}`).toBe(page);
    }
    // A card's first home is on record, and resolves back to the card.
    for (const card of SETTINGS_CARDS) {
      expect(placeOf(card.from[0], card.id)).toEqual({ page: card.page, section: card.id });
      expect(cardOf(card.id)?.page).toBe(card.page);
    }
  });

  test('a setting an agent may ask about names a card of the map', () => {
    for (const [key, place] of Object.entries(REQUESTABLE_SETTINGS)) {
      expect(cardOf(place.section)?.page, key).toBe(place.page);
    }
    for (const key of ['asyncQuestions', 'shortAnswers', 'toolSummaries', 'titleModel'] as const) {
      expect(REQUESTABLE_SETTINGS[key]).toMatchObject({ page: 'conversations', section: 'agent-replies' });
    }
  });

  test('the line under a title: this device, this machine or all your machines', () => {
    expect(SETTINGS_PAGES.map((page) => pageScopeOf(page))).toEqual(['device', 'machine', 'device', 'machine', 'machine', 'machine', 'group', 'machine', 'machine']);
    expect(machinePage('appearance')).toBe(false);
    expect(machinePage('conversations')).toBe(true);
    expect(machinePage('devices')).toBe(true);
  });

  test('only the long page lists its sections in the nav', () => {
    expect(navSectionsOf('ai', true).map((card) => card.id)).toEqual(['providers', 'local-acp', 'secrets', 'quotas', 'subscription-proxy', 'usage']);
    for (const page of SETTINGS_PAGES) if (page !== 'ai') expect(navSectionsOf(page, true), page).toEqual([]);
    expect(PAGES.ai.long).toBe(true);
  });

  test('owner-only pages and cards stay out of a paired device', () => {
    expect(SETTINGS_PAGES.filter(ownerOnly)).toEqual(['agents']);
    expect(navOf(false)).toEqual(['appearance', 'input', 'conversations', 'ai', 'safeguards', 'devices', 'version', 'help']);
    // A paired device reads what it read on General before the map: the privacy card and the admin policy, nothing it could change.
    expect(cardsOf('safeguards', false).map((card) => card.id)).toEqual(['policy']);
    expect(desktopPlace('general', 'policy', false)).toEqual({ page: 'safeguards', section: 'policy' });
    expect(cardsOf('ai', false).map((card) => card.id)).toEqual(['quotas', 'usage']);
    expect(cardsOf('conversations', false).map((card) => card.id)).toEqual(['thread-list', 'conversations', 'notifications', 'archived']);
    expect(cardsOf('help', false).map((card) => card.id)).toEqual(['task-manager', 'core', 'tour']);
    expect(cardsOf('devices', false).map((card) => card.id)).toEqual(['app', 'main-machine', 'group', 'machines', 'phone']);
    // A route to what it lacks opens the first page, or the card's page from the top.
    expect(desktopPlace('brain', null, false)).toEqual({ page: 'appearance', section: null });
    expect(desktopPlace('resources', 'limits', false)).toEqual({ page: 'safeguards', section: null });
    expect(desktopPlace('general', 'worktrees', false)).toEqual({ page: 'conversations', section: null });
    expect(desktopHas('general', 'worktrees', false)).toBe(false);
    expect(desktopHas('accounts', 'provider-claude', false)).toBe(false);
    expect(desktopHas('accounts', 'provider-claude', true)).toBe(true);
    expect(desktopHas('limits', null, false)).toBe(true);
  });

  test('experiments are a section of Version, and only where the build runs them', () => {
    expect(cardsOf('version', true).some((card) => card.id === 'experiments')).toBe(true);
    experiments.shown = false;
    expect(cardsOf('version', true).map((card) => card.id)).toEqual(['updates', 'agent-updates']);
    expect(navOf(true)).toContain('version');
    expect(desktopPlace('experiments', null, true)).toEqual({ page: 'version', section: null });
    expect(desktopHas('experiments', 'device-stream', true)).toBe(false);
    expect(phonePage('experiments', null, true)).toBe('home');
  });
});

describe('the phone, which still lists the pages from before', () => {
  test('a route from before opens what it opened', () => {
    expect(phonePage('accounts', null, true)).toBe('accounts');
    expect(phonePage('accounts', null, false)).toBe('home');
    expect(phonePage('voice', null, false)).toBe('voice');
    expect(phonePage('usage', null, true)).toBe('usage');
    expect(phonePage('experiments', null, true)).toBe('experiments');
    expect(phonePage('resources', null, true)).toBe('diagnostics');
    expect(phonePage('resources', null, false)).toBe('home');
    expect(phonePage('plugins', null, true)).toBe('plugins');
    expect(phonePage('plugins', null, false)).toBe('home');
    expect(phonePage('keyboard', null, true)).toBe('home');
    expect(phonePage('task-manager', null, true)).toBe('diagnostics');
    expect(phonePage('task-manager', null, false)).toBe('task-manager');
    expect(phonePage('general', 'quiet', true)).toBe('conversations');
    expect(phonePage('general', 'quiet', false)).toBe('home');
    expect(phonePage('general', 'secrets', true)).toBe('accounts');
    expect(phonePage('general', 'secrets', false)).toBe('home');
    expect(phonePage('general', 'windows', true)).toBe('machines');
    expect(phonePage('advanced', 'auto-compact', true)).toBe('advanced');
    expect(phonePage('general', 'archived', true)).toBe('archived');
  });

  test('a route to a page of the map is read back to the old page that holds its card', () => {
    expect(legacyRoute('conversations', 'agent-replies', true)).toEqual({ tab: 'general', section: 'agent-replies' });
    expect(phonePage('conversations', 'agent-replies', true)).toBe('conversations');
    expect(phonePage('conversations', 'archived', true)).toBe('archived');
    expect(phonePage('safeguards', 'limits', true)).toBe('diagnostics');
    expect(phonePage('safeguards', 'quiet', true)).toBe('conversations');
    expect(phonePage('ai', 'usage', true)).toBe('usage');
    expect(phonePage('ai', 'quotas', false)).toBe('limits');
    expect(phonePage('ai', 'provider-claude', true)).toBe('accounts');
    expect(phonePage('agents', 'auto-compact', true)).toBe('advanced');
    expect(phonePage('agents', 'plugins', true)).toBe('plugins');
    expect(phonePage('devices', 'machines', true)).toBe('machines');
    expect(phonePage('version', 'device-stream', true)).toBe('experiments');
    expect(phonePage('input', 'voice', true)).toBe('voice');
    expect(phonePage('input', 'keyboard', true)).toBe('home');
    expect(phonePage('appearance', 'theme', true)).toBe('appearance');
  });
});

test('a window answers only to the old page names whose cards it shows', () => {
  expect(aliasesOf(true)).toEqual(expect.arrayContaining(['general', 'accounts', 'plugins', 'brain', 'machines', 'advanced']));
  // A paired device never had Providers, Plugins or Instructions: no route by those names.
  for (const gone of ['accounts', 'plugins', 'brain'] as const) expect(aliasesOf(false)).not.toContain(gone);
  expect(aliasesOf(false)).toEqual(expect.arrayContaining(['general', 'machines', 'limits']));
});
