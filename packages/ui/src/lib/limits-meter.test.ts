import { expect, test } from 'vitest';
import type { AccountQuota } from '@boite/contracts';
import { limitsNotice } from './limits-meter';

type Win = [label: string, used: number, resetsAt?: number];
const row = (label: string, ...windows: Win[]) => ({
  accountId: label, providerId: 'claude', providerName: 'Claude', label, enabled: true, status: 'ready', checkedAt: null, error: null,
  windows: windows.map(([name, usedPercent, resetsAt], index) => ({ id: `w${index}`, label: name, usedPercent, resetsAt: resetsAt ?? null })),
}) as unknown as AccountQuota;
const pooled = (label: string, status: 'ready' | 'cooldown' | 'error' | 'disabled', ...windows: Win[]) => ({
  ...row(label, ...windows), accountId: `proxy:claude:${label}`,
  gateway: { kind: 'douane', entryId: label, display: 'accounts', plan: null, accounts: 1, status, credits: [] },
}) as unknown as AccountQuota;

test('the line stays silent while every provider has an account with room', () => {
  expect(limitsNotice([])).toBeNull();
  expect(limitsNotice([row('Home', ['5 hours', 20], ['Weekly', 40])])).toBeNull();
  // The owner's gateway: one account spent on 5 hours, one on its week, one on a model's week; the fourth serves everything.
  expect(limitsNotice([
    pooled('lzt', 'ready', ['Weekly', 36], ['Fable weekly', 57]),
    pooled('Main', 'ready', ['Weekly', 67], ['Fable weekly', 100]),
    pooled('suisse', 'ready', ['Weekly', 100], ['Fable weekly', 8]),
    pooled('x1', 'ready', ['5 hours', 100], ['Weekly', 32], ['Fable weekly', 64]),
  ])).toBeNull();
  // An account nothing is read of may still serve: no alarm on the others' word.
  expect(limitsNotice([row('Home', ['Weekly', 100]), row('Work')])).toBeNull();
});

test('a provider spent on every account says so, until the first of them resets', () => {
  expect(limitsNotice([row('Home', ['5 hours', 100, 5000], ['Weekly', 40, 9000])])).toEqual(
    { kind: 'out', provider: 'Claude', window: '5 hours', scoped: false, left: 0, until: 5000, account: 'Home', accounts: 1 });
  // Each account waits for the latest of its spent windows; the line gives the earliest account back.
  expect(limitsNotice([
    pooled('Main', 'ready', ['5 hours', 100, 3000], ['Weekly', 100, 9000]),
    pooled('Second', 'cooldown', ['5 hours', 100, 6000], ['Weekly', 50, 8000]),
  ])).toMatchObject({ kind: 'out', scoped: false, until: 6000, accounts: 2 });
  // No reset known for one of them: no time is promised.
  expect(limitsNotice([row('Home', ['Weekly', 100])])).toMatchObject({ kind: 'out', until: null });
  // An entry the gateway cannot use is not counted as room, nor as a reason to stay silent.
  expect(limitsNotice([pooled('Main', 'ready', ['Weekly', 100, 4000]), pooled('Broken', 'error')])).toMatchObject({ kind: 'out', accounts: 1, until: 4000 });
});

test('a model spent on every account is named alone while the provider still works', () => {
  expect(limitsNotice([
    pooled('Main', 'ready', ['Weekly', 30, 9000], ['Fable weekly', 100, 7000]),
    pooled('Second', 'ready', ['Weekly', 100, 5000], ['Fable weekly', 10, 7000]),
  ])).toEqual({ kind: 'out', provider: 'Claude', window: 'Fable weekly', scoped: true, left: 0, until: 5000, account: 'Main', accounts: 2 });
});

test('running low reads what the best account has left, and out comes before low', () => {
  expect(limitsNotice([row('Home', ['Weekly', 95]), row('Work', ['Weekly', 88.4])])).toEqual(
    { kind: 'low', provider: 'Claude', window: 'Weekly', scoped: false, left: 11, until: null, account: 'Work', accounts: 2 });
  const codex = { ...row('Plus', ['5 hours', 100, 2000]), providerId: 'codex', providerName: 'Codex' } as AccountQuota;
  expect(limitsNotice([row('Home', ['Weekly', 95]), codex])).toMatchObject({ kind: 'out', provider: 'Codex' });
});

test('an account that keeps serving on credits is not out', () => {
  const paid = { ...row('Home', ['Weekly', 100]), credits: { kind: 'balance', enabled: true, remaining: 12, limit: null, unlimited: false } } as unknown as AccountQuota;
  expect(limitsNotice([paid])).toBeNull();
});

// A daily window bounds the whole account like a weekly one: it read as one model's.
test('a daily window is the account\'s, not a model\'s', () => {
  expect(limitsNotice([row('Home', ['Daily', 100, 5000])])).toMatchObject({ kind: 'out', window: 'Daily', scoped: false });
});
