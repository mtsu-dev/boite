import { expect, test } from 'vitest';
import { emailParts, quotaAlertTitle, withoutEmails } from '@boite/contracts';

test('an address, a gateway\'s shortened one too, is cut out of the text to blur; other text stays one part', () => {
  expect(emailParts('Claude Pro · work@corp.io')).toEqual([{ text: 'Claude Pro · ', email: false }, { text: 'work@corp.io', email: true }]);
  expect(emailParts('Claude Max x20 · chris@…')).toEqual([{ text: 'Claude Max x20 · ', email: false }, { text: 'chris@…', email: true }]);
  expect(emailParts('nefreex2 + mtsu patrol')).toEqual([{ text: 'nefreex2 + mtsu patrol', email: false }]);
  expect(emailParts('@handle · user@host')).toEqual([{ text: '@handle · user@host', email: false }]);
});

test('a limit alert, shown on a locked screen where nothing blurs, leaves the address out', () => {
  expect(withoutEmails('Work (jean.dupont@mail.company.fr)')).toBe('Work');
  const window = { id: 'five-hour', label: '5 hours', usedPercent: 92, resetsAt: null };
  expect(quotaAlertTitle({ label: 'you@example.com', providerName: 'Claude', window })).toBe('Claude');
  expect(quotaAlertTitle({ label: 'Claude Pro · work@corp.io', providerName: 'Claude', window })).toBe('Claude Pro');
});
