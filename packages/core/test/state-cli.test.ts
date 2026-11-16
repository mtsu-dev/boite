import { expect, test } from 'bun:test';
import { accessRefusal, maskEmail, readSettings, REQUESTABLE_SETTING_KEYS, SETTING_HELP, SETTINGS_PAGES } from '@boite/contracts';
import { ShortUsage } from '../src/cli-args.ts';
import { selectSettings, settingsLines, STATE_USAGE, stateCommand } from '../src/cli-state.ts';

const settings = readSettings({} as never);

test('every Settings page has a boite state settings read, and every key the app shows has a row', () => {
  for (const page of SETTINGS_PAGES) expect(selectSettings(settings, page), page).not.toBeNull();
  const rows = settingsLines(selectSettings(settings, undefined)!, true).join('\n');
  for (const key of REQUESTABLE_SETTING_KEYS) expect(rows, key).toContain(`${key} `);
  expect(selectSettings(settings, 'nonsense')).toBeNull();
});

test('a page lists its settings with what each does, and every setting an agent reads is explained', () => {
  const advanced = selectSettings(settings, 'advanced')!;
  expect(advanced.map(reading => reading.key)).toContain('warmProcessMinutes');
  expect(advanced.every(reading => reading.page === 'advanced')).toBe(true);
  const lines = settingsLines(advanced, true);
  expect(lines).toContain(`    ${SETTING_HELP.warmProcessMinutes}`);
  for (const key of REQUESTABLE_SETTING_KEYS) expect(SETTING_HELP[key], key).toBeTruthy();
  expect(settingsLines(selectSettings(settings, 'worktreeStorage')!, true)).toEqual([expect.stringContaining('worktreeStorage '), `    ${SETTING_HELP.worktreeStorage}`]);
});

test('agent.state is an agent read for its own thread only, and labels never show a full email', () => {
  expect(accessRefusal('agent.state', { principal: 'agent', threadId: 'thr_a' }, { threadId: 'thr_a', domain: 'inbox' })).toBeNull();
  expect(accessRefusal('agent.state', { principal: 'agent', threadId: 'thr_a' }, { threadId: 'thr_b', domain: 'inbox' })).not.toBeNull();
  expect(maskEmail('Work (ada.lovelace@example.com)')).toBe('Work (a…@example.com)');
  expect(maskEmail('Personal')).toBe('Personal');
});

test('a wrong boite state prints its own usage line, not the whole help', async () => {
  const client = { call: () => { throw new Error('no call expected'); } } as never;
  const refused = await stateCommand(client, 'thr_a', ['nonsense'], () => {}).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(ShortUsage);
  expect((refused as Error).message).toBe(STATE_USAGE);
  expect(STATE_USAGE).toContain('settings [page|key]|limits|machines|updates|inbox|tasks|version|route');
});

test('each part of a setting\'s help reads as its own sentence', () => {
  for (const [key, text] of Object.entries(SETTING_HELP)) expect(text, key).toMatch(/[.!?:]$/);
  expect(SETTING_HELP.listenOnLan).toContain('reach this computer. Lets a phone');
});
