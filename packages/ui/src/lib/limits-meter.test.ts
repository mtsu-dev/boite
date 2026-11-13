import { expect, test } from 'vitest';
import type { AccountQuota } from '@boite/contracts';
import { lowestLimit } from './limits-meter';

const row = (label: string, ...used: number[]) => ({
  accountId: label, providerId: 'claude', providerName: 'Claude', label, enabled: true, status: 'ready', checkedAt: null, error: null,
  windows: used.map((usedPercent, index) => ({ id: `w${index}`, label: index ? 'Weekly' : '5 hours', usedPercent, resetsAt: null })),
}) as unknown as AccountQuota;

test('the gauge reads the least left in any window of any account, toned as the limits views tone it', () => {
  expect(lowestLimit([])).toBeNull();
  expect(lowestLimit([row('Work', 20, 40), row('Home', 10, 94.5)])).toEqual({ left: 5, tone: 'low', account: 'Home', provider: 'Claude', several: true, window: 'Weekly' });
  expect(lowestLimit([row('Work', 100)])?.tone).toBe('out');
  expect(lowestLimit([row('Work', 12)])).toMatchObject({ left: 88, tone: 'ok', provider: 'Claude', several: false });
});

const pooled = (label: string, status: 'ready' | 'cooldown' | 'error' | 'disabled', ...used: number[]) => ({
  ...row(label, ...used), accountId: `proxy:claude:${label}`,
  gateway: { kind: 'douane', entryId: label, display: 'accounts', plan: null, accounts: 1, status, credits: [] },
}) as unknown as AccountQuota;

test('a gateway\'s accounts of one provider read as their pool, not as the emptiest of them', () => {
  // One account of three spent: the gateway still serves from the two others.
  const rows = [pooled('Main', 'ready', 10, 100), pooled('Second', 'ready', 30, 40), pooled('Third', 'cooldown', 20, 10)];
  expect(lowestLimit(rows)).toEqual({ left: 50, tone: 'ok', account: 'Claude · 3 accounts', provider: 'Claude', several: true, window: 'Weekly', pool: 3 });
  // An entry the gateway cannot use is not part of what is left.
  expect(lowestLimit([...rows, pooled('Broken', 'error', 0, 0)])).toMatchObject({ left: 50, pool: 3 });
  // Every account spent: the pool is out.
  expect(lowestLimit([pooled('Main', 'ready', 5, 100), pooled('Second', 'ready', 5, 100)])).toMatchObject({ left: 0, tone: 'out', pool: 2 });
  // A gateway's one account stays an account.
  expect(lowestLimit([pooled('Main', 'ready', 10, 100)])).toEqual({ left: 0, tone: 'out', account: 'Main', provider: 'Claude', several: false, window: 'Weekly' });
});
