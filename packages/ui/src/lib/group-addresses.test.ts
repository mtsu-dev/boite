import { expect, test } from 'vitest';
import { usableAddresses } from './group-addresses';

test('over plain HTTP a MagicDNS name under ts.net comes before the tailnet address, and no other name is used', () => {
  const given = ['http://100.101.102.103:7000', 'http://desk.tail0d6070.ts.net:7000', 'http://192.168.1.20:7000'];
  expect(usableAddresses(given, false)).toEqual(['http://desk.tail0d6070.ts.net:7000', 'http://100.101.102.103:7000', 'http://192.168.1.20:7000']);
  // An HTTPS page opens secure sockets only, and a machine with HTTPS is reached there alone.
  expect(usableAddresses(given, true)).toEqual([]);
  expect(usableAddresses(['https://desk.tail0d6070.ts.net', ...given], false)).toEqual(['https://desk.tail0d6070.ts.net']);
  // The core's rule (`ticketAddresses`): any other zone, a bare tailnet, a name hidden under another zone, a user or a path.
  expect(usableAddresses(['http://desk.tail.example:7000', 'http://ts.net:7000', 'http://tail0d6070.ts.net:7000', 'http://desk.tail0d6070.ts.net.evil.example:7000',
    'http://user@desk.tail0d6070.ts.net:7000', 'http://desk.tail0d6070.ts.net:7000/path', 'http://-desk.tail0d6070.ts.net:7000'], false)).toEqual([]);
});
