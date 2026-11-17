import { expect, test } from 'vitest';
import type { AccountQuota, QuotaWindow } from '@boite/contracts';
import { outsideNotice } from './outside-usage';
import { fill, strings } from './strings';

const window = (id: string, outsidePercent?: number): QuotaWindow =>
  ({ id, label: id, usedPercent: 50, resetsAt: null, ...(outsidePercent === undefined ? {} : { outsidePercent }) });
const row = (accountId: string, label: string, windows: QuotaWindow[], more: Partial<AccountQuota> = {}): AccountQuota => ({
  accountId, providerId: 'claude', providerName: 'Claude', label, enabled: true, status: 'ready', windows, checkedAt: null, error: null, ...more,
});

test('names the account with the largest share used outside Douane, across every window', () => {
  expect(outsideNotice([
    row('a', 'Claude Max · chris@…', [window('five-hour', 12), window('weekly', 30)]),
    row('b', 'Claude Pro · work@…', [window('five-hour', 41), window('weekly', 5)]),
    row('c', 'ChatGPT Plus', [window('weekly', 35)], { providerId: 'codex', providerName: 'Codex' }),
  ])).toEqual({ account: 'Claude Pro · work@…', provider: 'Claude', percent: 41 });
});

test('below 10 points, or without the field, nothing is worth a notice', () => {
  expect(outsideNotice([])).toBeNull();
  expect(outsideNotice([row('a', 'A', [window('weekly'), window('five-hour', 9.9)])])).toBeNull();
  expect(outsideNotice([row('a', 'A', [window('weekly', 10)])])).toEqual({ account: 'A', provider: 'Claude', percent: 10 });
});

test('a tie keeps the first account, and an unlabeled or averaged row reads as the limits view names it', () => {
  expect(outsideNotice([row('a', '', [window('weekly', 20)]), row('b', 'B', [window('weekly', 20)])]))
    .toEqual({ account: 'Claude', provider: 'Claude', percent: 20 });
  const average = row('avg', 'Antigravity · 10 comptes', [window('weekly', 15)], {
    providerId: 'antigravity', providerName: 'Antigravity',
    gateway: { kind: 'douane', entryId: 'antigravity', display: 'average', plan: null, accounts: 10, status: 'ready', credits: [] },
  });
  expect(outsideNotice([average])).toEqual({ account: fill(strings.subscriptionProxy.average, { name: 'Antigravity', count: '10' }), provider: 'Antigravity', percent: 15 });
});

test('a window whose reset has passed no longer counts: its figure was the past window\'s', () => {
  const ended = { ...window('weekly', 40), resetsAt: 1_000 };
  expect(outsideNotice([row('a', 'A', [ended])], 2_000)).toBeNull();
  expect(outsideNotice([row('a', 'A', [ended])], 500)).toEqual({ account: 'A', provider: 'Claude', percent: 40 });
});
