import { beforeEach, expect, test, vi } from 'vitest';
import { SETTINGS_PAGES } from '@boite/contracts';

const experiments = vi.hoisted(() => ({ shown: true }));
vi.mock('./experiments.svelte', () => ({ experimentsShown: () => experiments.shown }));

import { cardWords, fold, searchSettings, settingsEntries } from './settings-index';
import { SETTINGS_CARDS, cardsOf, placeOf } from './settings-tabs';
import { setLocaleSetting } from './i18n.svelte';
import { strings } from './strings';

beforeEach(async () => { experiments.shown = true; await setLocaleSetting('en'); });

const find = (query: string, owner = true) => searchSettings(settingsEntries(owner), query);

test('the index holds every page and every card of the map, each with a title', () => {
  const words = cardWords();
  expect(Object.keys(words).sort()).toEqual(SETTINGS_CARDS.map((card) => card.id).sort());
  for (const card of SETTINGS_CARDS) expect(words[card.id].title.trim(), card.id).not.toBe('');
  const entries = settingsEntries(true);
  for (const page of SETTINGS_PAGES) {
    expect(entries.some((entry) => entry.page === page && entry.section === null), page).toBe(true);
    for (const card of cardsOf(page, true)) expect(entries.some((entry) => entry.page === page && entry.section === card.id), card.id).toBe(true);
  }
  // Every entry opens where it says: its section is a card of its page.
  for (const entry of entries) if (entry.section) expect(placeOf(entry.page, entry.section), entry.label).toEqual({ page: entry.page, section: entry.section });
});

test.each([
  ['compaction', 'agents', 'auto-compact'],
  ['resume', 'ai', 'limit-resume'],
  ['proxy', 'ai', 'subscription-proxy'],
  ['origins', 'devices', 'origins'],
  ['start at login', 'devices', 'app'],
  ['archive', 'conversations', 'archived'],
  ['hotkeys', 'input', 'keyboard'],
  ['cpu', 'safeguards', 'limits'],
  ['telemetry', 'safeguards', 'privacy'],
  ['nightly', 'version', 'updates'],
  ['errors', 'help', 'diagnostics-log'],
  ['tour', 'help', 'tour'],
  ['theme', 'appearance', 'theme']
])('"%s" lands on %s, card %s', (query, page, section) => {
  const first = find(query)[0];
  expect(first, query).toBeDefined();
  expect({ page: first!.page, section: first!.section }).toEqual({ page, section });
});

test('a result names its page, and a control names its card too', () => {
  const card = find('proxy')[0]!;
  expect(card.trail).toBe(strings.settingsMap.pages.ai);
  const control = find(strings.settings.muteAgents)[0]!;
  expect(control.section).toBe('quiet');
  expect(control.trail).toBe(`${strings.settingsMap.pages.safeguards} · ${strings.protection.quiet}`);
  // A page is found by its own name, and comes before what merely mentions it.
  expect(find('safeguards')[0]).toMatchObject({ page: 'safeguards', section: null });
});

test('a hint finds its control, and accents or case never decide', () => {
  expect(find('reverse proxy').some((entry) => entry.section === 'phone')).toBe(true);
  expect(fold('Dépannage')).toBe('depannage');
  expect(find('APPEARANCE')[0]).toMatchObject({ page: 'appearance', section: null });
  // A page's name from before the map still finds the page that took its content.
  expect(find('providers').some((entry) => entry.page === 'ai' && entry.section === null)).toBe(true);
  expect(find('look and language')[0]).toMatchObject({ page: 'appearance', section: null });
  expect(find('')).toEqual([]);
  expect(find('zzzz-nothing')).toEqual([]);
});

test('a paired device finds only what it may open, and a Release finds no experiment', () => {
  expect(find('subscription proxy', false)).toEqual([]);
  expect(find('compaction', false)).toEqual([]);
  expect(find('usage', false).some((entry) => entry.section === 'usage')).toBe(true);
  experiments.shown = false;
  expect(settingsEntries(true).some((entry) => entry.section === 'experiments' || entry.section === 'device-stream')).toBe(false);
});

test('rows the live data names join the index under their card', () => {
  const entries = settingsEntries(true, [{ page: 'ai', section: 'provider-claude', label: 'Zeta Cloud', card: 'providers' }]);
  const found = searchSettings(entries, 'zeta')[0]!;
  expect(found).toMatchObject({ page: 'ai', section: 'provider-claude' });
  expect(found.trail).toBe(`${strings.settingsMap.pages.ai} · ${cardWords().providers.title}`);
});

test('in French the pages wear their French names and the search answers French words', async () => {
  await setLocaleSetting('fr');
  expect(strings.settingsMap.pages).toMatchObject({ ai: 'Comptes IA', safeguards: 'Garde-fous', input: 'Saisie', devices: 'Appareils', help: 'Dépannage' });
  expect(find('depannage')[0]).toMatchObject({ page: 'help', section: null });
  expect(find('garde-fous')[0]).toMatchObject({ page: 'safeguards', section: null });
  expect(find('origines')[0]).toMatchObject({ page: 'devices', section: 'origins' });
});
