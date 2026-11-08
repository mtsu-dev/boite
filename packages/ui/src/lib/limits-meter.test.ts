import { expect, test } from 'vitest';
import type { AccountQuota } from '@boite/contracts';
import { lowestLimit } from './limits-meter';

const row = (label: string, ...used: number[]) => ({
  accountId: label, providerId: 'claude', providerName: 'Claude', label, enabled: true, status: 'ready', checkedAt: null, error: null,
  windows: used.map((usedPercent, index) => ({ id: `w${index}`, label: index ? 'Weekly' : '5 hours', usedPercent, resetsAt: null })),
}) as unknown as AccountQuota;

test('the gauge reads the least left in any window of any account, toned as the limits views tone it', () => {
  expect(lowestLimit([])).toBeNull();
  expect(lowestLimit([row('Work', 20, 40), row('Home', 10, 94.5)])).toEqual({ left: 5, tone: 'low', account: 'Home', window: 'Weekly' });
  expect(lowestLimit([row('Work', 100)])?.tone).toBe('out');
  expect(lowestLimit([row('Work', 12)])).toMatchObject({ left: 88, tone: 'ok' });
});
