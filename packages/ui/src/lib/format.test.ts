import { expect, test } from 'vitest';
import { ago, bytes, clockTime, dayClock, effortName, elapsed, formatTokens, levelName, levelTitle, longDay, millis, quotaLimitName, quotaResetTime, quotaWindowName, relativeTime, shortPath } from './format';
import { setLocaleSetting } from './i18n.svelte';

test('elapsed reads like a stopwatch', () => {
  expect(elapsed(0)).toBe('0s');
  expect(elapsed(12_900)).toBe('12s');
  expect(elapsed(281_000)).toBe('4m 41s');
  expect(elapsed(65_000)).toBe('1m 05s');
  expect(elapsed(3_720_000)).toBe('1h 02m');
  expect(elapsed(-5)).toBe('0s');
});

test('one time rule everywhere: now, minutes and hours under a day, then the date, clock skew clamped to now', async () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  expect(relativeTime(now + 60_000, now)).toBe('now');
  expect(relativeTime(now - 59_999, now)).toBe('now');
  expect(relativeTime(now - 120_000, now)).toBe('2m ago');
  expect(relativeTime(now - 7_200_000, now)).toBe('2h ago');
  expect(relativeTime(now - 172_800_000, now)).toBe('Sep 30');
  // A row says the same without "ago", and a day older is a date there too, never a clock.
  expect(ago(now - 240_000, now)).toBe('4m');
  expect(ago(now - 7_200_000, now)).toBe('2h');
  expect(ago(now - 86_400_000, now)).toBe('Oct 1');
  expect(ago(Date.parse('2025-03-02T12:00:00Z'), now)).toBe('Mar 2, 2025');
  await setLocaleSetting('fr');
  try {
    expect(relativeTime(now - 120_000, now)).toBe('il y a 2 min');
    expect(ago(now - 7_200_000, now)).toBe('2 h');
    expect(relativeTime(now, now)).toBe("à l'instant");
  } finally { await setLocaleSetting('en'); }
});

test('clockTime gives the hour today, a weekday this week and a date beyond', () => {
  const now = new Date(2026, 8, 24, 18, 0).getTime();
  const today = new Date(2026, 8, 24, 10, 31).getTime();
  const monday = new Date(2026, 8, 21, 10, 31).getTime();
  const old = new Date(2026, 7, 2, 10, 31).getTime();
  expect(clockTime(today, now)).toMatch(/10:31/);
  expect(clockTime(monday, now)).not.toBe(clockTime(today, now));
  expect(clockTime(old, now)).toMatch(/10:31/);
  expect(clockTime(old, now).length).toBeGreaterThan(clockTime(today, now).length);
});

test('durations, sizes, effort levels and quota windows follow the language the app speaks', async () => {
  const friday = new Date(2026, 8, 25, 20, 55).getTime();
  expect(quotaResetTime(friday, friday)).toMatch(/^Friday /);
  // One duration style: a trace, an uptime and a turn read alike; under a second keeps its milliseconds.
  expect(millis(38_000)).toBe('38s');
  expect(millis(89_000)).toBe('1m 29s');
  expect(millis(120)).toBe('120 ms');
  // Xhigh and ultrathink read in plain words, whatever label the core sends; the tooltip keeps the agent's word.
  expect(levelName({ id: 'xhigh', label: 'Xhigh' })).toBe('Extra high');
  expect(levelName({ id: 'ultrathink', label: 'Ultrathink' })).toBe('Ultra');
  expect(levelTitle({ id: 'ultrathink', description: 'Extended thinking' })).toBe('Extended thinking (ultrathink)');
  expect(levelTitle({ id: 'high', description: 'Deeper reasoning' })).toBe('Deeper reasoning');
  expect(quotaLimitName('Weekly')).toBe('weekly');
  expect(quotaLimitName('5 hours')).toBe('5-hour');
  await setLocaleSetting('fr');
  try {
    expect(millis(38_000)).toBe('38s');
    expect(bytes(3.5 * 1024 ** 3)).toBe('3,5 Go');
    expect(levelName({ id: 'high', label: 'High' })).toBe('Élevé');
    expect(levelName({ id: 'fast', label: 'Fast' })).toBe('Rapide');
    expect(levelName({ id: 'xhigh', label: 'Extra high' })).toBe('Très élevé');
    // A level the app has no word for keeps the provider's.
    expect(levelName({ id: 'turbo', label: 'Turbo' })).toBe('Turbo');
    expect(quotaWindowName('Weekly')).toBe('Hebdomadaire');
    expect(quotaWindowName('5 hours')).toBe('5 heures');
    expect(quotaWindowName('Opus weekly')).toBe('Opus weekly');
    // The core joins a period to a model or a group: only the period changes language.
    expect(quotaWindowName('Weekly · Opus')).toBe('Hebdomadaire · Opus');
    expect(quotaWindowName('Gemini Pro · 5 hours')).toBe('Gemini Pro · 5 heures');
    expect(quotaWindowName('Credits')).toBe('Crédits');
    // The quota line's sentence: the period in lower case, a model's name as sent.
    expect(quotaLimitName('Weekly · Opus')).toBe('hebdomadaire · Opus');
    expect(quotaLimitName('5 hours')).toBe('de 5 heures');
    expect(quotaResetTime(friday, friday)).toBe('vendredi 20:55');
    expect(levelName({ id: 'none', label: 'None' })).toBe('Aucun');
    // A subagent row names its model's effort in French, an unknown id as sent.
    const model = { effort: { levels: [{ id: 'high', label: 'High' }] } };
    expect(effortName(model, 'high')).toBe('Élevé');
    expect(effortName(model, 'turbo')).toBe('turbo');
    // A day heading and a token count, whatever language the OS speaks.
    expect(longDay(new Date(2026, 8, 15, 10, 31).getTime())).toBe('mardi 15 septembre');
    expect(formatTokens(84_400).replace(/\s/g, ' ')).toBe('84,4 k');
  } finally { await setLocaleSetting('en'); }
});

test('quota resets beyond the next seven calendar days show their date instead of an ambiguous weekday', async () => {
  const now = new Date(2026, 9, 25, 9, 0).getTime();
  const today = new Date(2026, 9, 25, 14, 0).getTime();
  const monthly = new Date(2026, 10, 22, 9, 35).getTime();
  const nextYear = new Date(2027, 0, 3, 9, 35).getTime();
  expect(quotaResetTime(today, now)).toMatch(/^Sunday /);
  expect(quotaResetTime(monthly, now)).toBe(`Nov 22 ${dayClock(monthly)}`);
  expect(quotaResetTime(nextYear, now)).toBe(`Jan 3, 2027 ${dayClock(nextYear)}`);
  await setLocaleSetting('fr');
  try {
    expect(quotaResetTime(today, now)).toBe('dimanche 14:00');
    expect(quotaResetTime(monthly, now)).toBe('22 nov. 09:35');
    expect(quotaResetTime(nextYear, now)).toBe('3 janv. 2027 09:35');
  } finally { await setLocaleSetting('en'); }
});

test('quota reset dates use local calendar boundaries, including across daylight saving changes', () => {
  const now = new Date(2026, 9, 24, 23, 0).getTime();
  const thisWeek = new Date(2026, 9, 30, 23, 30).getTime();
  const nextWeek = new Date(2026, 9, 31, 0, 0).getTime();
  const past = new Date(2026, 9, 17, 9, 35).getTime();
  expect(quotaResetTime(thisWeek, now)).toMatch(/^Friday /);
  expect(quotaResetTime(nextWeek, now)).toBe(`Oct 31 ${dayClock(nextWeek)}`);
  expect(quotaResetTime(past, now)).toBe(`Oct 17 ${dayClock(past)}`);
});

test('a project folder keeps its root and last two folders, the home folded to ~, on Windows and POSIX', () => {
  // Windows: the home, then a drive, then a network share stay; the middle goes.
  expect(shortPath('C:\\Users\\timothe\\Documents\\GitHub\\boite')).toBe('~\\…\\GitHub\\boite');
  expect(shortPath('D:\\Projets\\clients\\2026\\site-asso')).toBe('D:\\…\\2026\\site-asso');
  expect(shortPath('\\\\nas\\work\\clients\\2026\\site-asso')).toBe('\\\\nas\\work\\…\\2026\\site-asso');
  // POSIX: Linux and macOS homes, and a folder from `/`.
  expect(shortPath('/home/chris/Dev/Unity/game')).toBe('~/…/Unity/game');
  expect(shortPath('/Users/chris/Code/apps/site/')).toBe('~/…/apps/site');
  expect(shortPath('/srv/projects/2026/site')).toBe('/…/2026/site');
  // A root and two folders or fewer is already short: it stays as it is, the home still folded.
  expect(shortPath('C:\\Users\\timothe\\Documents\\notes')).toBe('~\\Documents\\notes');
  expect(shortPath('D:\\Perso\\compta-2026')).toBe('D:\\Perso\\compta-2026');
  expect(shortPath('C:\\src\\boite')).toBe('C:\\src\\boite');
  expect(shortPath('/srv/app')).toBe('/srv/app');
  expect(shortPath('/home/chris')).toBe('~');
  expect(shortPath('C:\\')).toBe('C:\\');
});