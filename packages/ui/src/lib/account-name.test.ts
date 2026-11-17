import { expect, test } from 'vitest';
import { maskEmails, quotaAlertTitle, type AccountQuota } from '@boite/contracts';
import { accountName } from './account-name';
import { namedQuotas, quotaAccountName } from './quota-reader.svelte';

test('an address reads as its first letters, a gateway\'s shortened one too, and other text is left alone', () => {
  expect(maskEmails('you@example.com')).toBe('y•••@e•••.com');
  expect(maskEmails('Claude Max x20 · chris@…')).toBe('Claude Max x20 · c•••@…');
  expect(maskEmails('Work (jean.dupont@mail.company.fr)')).toBe('Work (j•••@m•••.fr)');
  expect(maskEmails('nefreex2 + mtsu patrol')).toBe('nefreex2 + mtsu patrol');
  expect(maskEmails('@handle · user@host')).toBe('@handle · user@host');
});

test('the adopted login, a gateway entry and a limit alert never show an address', () => {
  expect(accountName({ label: 'Default', identity: 'you@example.com' })).toBe('y•••@e•••.com');
  expect(accountName({ label: 'Home', identity: 'you@example.com' })).toBe('Home');

  const row = { accountId: 'proxy:claude:1', providerId: 'claude', providerName: 'Claude', label: 'Claude Pro · work@corp.io', enabled: true,
    status: 'ready', windows: [], checkedAt: null, error: null } as AccountQuota;
  expect(namedQuotas([row])[0]!.label).toBe('Claude Pro · w•••@c•••.io');
  expect(quotaAccountName(row)).toBe('Claude Pro · w•••@c•••.io');

  const window = { id: 'five-hour', label: '5 hours', usedPercent: 92, resetsAt: null };
  expect(quotaAlertTitle({ label: 'you@example.com', providerName: 'Claude', window })).toBe('Claude · y•••@e•••.com');
});
