import { expect, test } from 'vitest';
import { usableAddresses } from './group-addresses';

test('over plain HTTP only an address written as numbers is used, a MagicDNS name included in the refusal', () => {
  // With Tailscale's DNS not accepted, the LAN's resolver answers `*.ts.net`; 100.x is routed through Tailscale.
  const given = ['http://desk.tail0d6070.ts.net:7000', 'http://100.101.102.103:7000', 'http://192.168.1.20:7000'];
  expect(usableAddresses(given, false)).toEqual(['http://100.101.102.103:7000', 'http://192.168.1.20:7000']);
  // A name is reached safely over HTTPS alone, and an HTTPS page opens secure sockets only.
  expect(usableAddresses(['https://desk.tail0d6070.ts.net', ...given], false)).toEqual(['https://desk.tail0d6070.ts.net']);
  expect(usableAddresses(given, true)).toEqual([]);
});
