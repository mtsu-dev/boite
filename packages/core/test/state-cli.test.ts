import { expect, test } from 'bun:test';
import { accessRefusal, maskEmail, readSettings, REQUESTABLE_SETTING_KEYS, SETTING_HELP, SETTINGS_PAGES } from '@boite/contracts';
import { selectSettings, settingsLines } from '../src/cli-state.ts';

const settings = readSettings({} as never);

test('every Settings page has a boite state settings read, and every key the app shows has a row', () => {
  for (const page of SETTINGS_PAGES) expect(selectSettings(settings, page), page).not.toBeNull();
  const rows = settingsLines(selectSettings(settings, undefined)!, true).join('\n');
  for (const key of REQUESTABLE_SETTING_KEYS) expect(rows, key).toContain(`${key} `);
  expect(selectSettings(settings, 'nonsense')).toBeNull();
});

test('a page lists its settings with what each does, and a setting the app does not explain gets no text', () => {
  const advanced = selectSettings(settings, 'advanced')!;
  expect(advanced.map(reading => reading.key)).toContain('warmProcessMinutes');
  expect(advanced.every(reading => reading.page === 'advanced')).toBe(true);
  const lines = settingsLines(advanced, true);
  expect(lines).toContain(`    ${SETTING_HELP.warmProcessMinutes}`);
  expect(SETTING_HELP.worktreeStorage).toBeUndefined();
  expect(settingsLines(selectSettings(settings, 'worktreeStorage')!, true)).toHaveLength(1);
});

test('agent.state is an agent read for its own thread only, and labels never show a full email', () => {
  expect(accessRefusal('agent.state', { principal: 'agent', threadId: 'thr_a' }, { threadId: 'thr_a', domain: 'inbox' })).toBeNull();
  expect(accessRefusal('agent.state', { principal: 'agent', threadId: 'thr_a' }, { threadId: 'thr_b', domain: 'inbox' })).not.toBeNull();
  expect(maskEmail('Work (ada.lovelace@example.com)')).toBe('Work (a…@example.com)');
  expect(maskEmail('Personal')).toBe('Personal');
});
