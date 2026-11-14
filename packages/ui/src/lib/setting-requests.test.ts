import { expect, test } from 'vitest';
import { REQUESTABLE_SETTINGS, readSettings, settledSetting, type RequestableKey, type Settings, type SettingAsk } from '@boite/contracts';
import { retiredHint, settingLabel, settingsReachable, settingsSectionLabel, settingValueText } from './setting-requests';
import { strings } from './strings';

const open = (page: SettingAsk['page'], section: string | null): SettingAsk => ({ kind: 'open', page, section });

test('Show and Open are offered only where this client draws the target card', () => {
  // A paired device has no owner page and no owner card on a shared page: Open would land on Home.
  expect(settingsReachable(open('resources', 'limits'), { owner: false, phone: false })).toBe(false);
  expect(settingsReachable(open('general', 'worktrees'), { owner: false, phone: false })).toBe(false);
  expect(settingsReachable(open('appearance', 'theme'), { owner: false, phone: false })).toBe(true);
  // The live device stream runs on the owner's machine: only the owner's Experiments draws its card, on a phone too.
  expect(settingsReachable(open('experiments', 'device-stream'), { owner: false, phone: false })).toBe(false);
  expect(settingsReachable(open('experiments', 'device-stream'), { owner: true, phone: true })).toBe(true);
  // A phone browser lacks the desktop's General, Advanced and pairing cards.
  expect(settingsReachable(open('resources', 'limits'), { owner: true, phone: true })).toBe(true);
  expect(settingsReachable(open('general', 'conversations'), { owner: true, phone: true })).toBe(true);
  expect(settingsReachable(open('advanced', 'origins'), { owner: true, phone: true })).toBe(false);
  expect(settingsReachable(open('machines', 'devices'), { owner: true, phone: true })).toBe(false);
  expect(settingsReachable(open('advanced', 'origins'), { owner: true, phone: false })).toBe(true);
  // Windows and sound sit on General, the owner's only, a page of its own on a phone too.
  expect(REQUESTABLE_SETTINGS.focusGuard).toMatchObject({ page: 'general', section: 'quiet' });
  expect(REQUESTABLE_SETTINGS.muteAgents).toMatchObject({ page: 'general', section: 'quiet' });
  expect(settingsReachable(open('general', 'quiet'), { owner: true, phone: true })).toBe(true);
  expect(settingsReachable(open('general', 'quiet'), { owner: true, phone: false })).toBe(true);
  expect(settingsReachable(open('general', 'quiet'), { owner: false, phone: false })).toBe(false);
  expect(settingsReachable(open('resources', 'quiet'), { owner: true, phone: true })).toBe(false);
});

test('an automatic compaction change that only adds a moment reads differently from the current one', () => {
  const before = settingValueText('autoCompact', { tokens: 8000, moments: ['background'] });
  const after = settingValueText('autoCompact', { tokens: 8000, moments: ['background', 'turn-end'] });
  expect(after).not.toBe(before);
  expect(after.startsWith(before)).toBe(true);
});

test('a reading is a copy: sorting or pushing to it leaves the settings and the defaults alone', () => {
  const settings = { browserOrigins: ['https://b.example', 'https://a.example'] } as Settings;
  const origins = (reading: ReturnType<typeof readSettings>) => reading.find((entry) => entry.key === 'browserOrigins')!.value as string[];
  origins(readSettings(settings)).sort();
  expect(settings.browserOrigins).toEqual(['https://b.example', 'https://a.example']);
  origins(readSettings({} as Settings)).push('https://c.example');
  expect(origins(readSettings({} as Settings))).toEqual([]);
});

test('a card about a graduated experiment is never settled by a core setting moving', () => {
  // Asked before the switch left the Experiments page: an old card in a thread.
  const card: SettingAsk = { kind: 'change', key: 'experiment.open-chat-links' as RequestableKey, value: true, previous: false, page: 'experiments', section: 'open-chat-links', sensitive: false, app: 'app-12345678' };
  expect(settledSetting(card, { agentCpuCapPercent: 40 } as Settings)).toBeNull();
});

test('a graduated experiment keeps its name, and one with no switch left says it is always on', () => {
  expect(settingLabel('experiment.edge-scrollbars' as RequestableKey)).toBe('Hide scrollbars until the pointer is near');
  expect(settingLabel('experiment.press-preload' as RequestableKey)).toBe('Load on press');
  expect(retiredHint('experiment.press-preload')).toBe('This is now on in every build.');
  expect(retiredHint('experiment.preview-comments')).toBe('This experiment has its own switch in Settings now.');
});

test('an old card about a finished experiment reads as words, never as its key', () => {
  expect(settingLabel('experiment.resident-agents' as RequestableKey)).toBe('Bots');
  expect(settingLabel('experiment.prompt-cache' as RequestableKey)).toBe('Prompt cache timer');
  expect(settingLabel('experiment.recording-indicators' as RequestableKey)).toBe('Show actions in recordings');
  for (const id of ['prompt-cache', 'recording-indicators']) {
    expect(retiredHint(`experiment.${id}`)).toBe('This is now on in every build.');
  }
});

// The owner's two conversation cards and the auto-resume card had no name and the wrong reach.
test('the owner-only conversation cards are named, and offered to the owner alone, phone included', () => {
  expect(settingsSectionLabel('agents-alone')).toBe(strings.agentsAlone.heading);
  expect(settingsSectionLabel('limit-resume')).toBe(strings.quotas.autoResume);
  for (const section of ['agents-alone', 'agent-replies']) {
    expect(settingsReachable(open('general', section), { owner: false, phone: false })).toBe(false);
    expect(settingsReachable(open('general', section), { owner: true, phone: true })).toBe(true);
  }
});
