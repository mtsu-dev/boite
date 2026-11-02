/** Where a client may send a ticket or a key of a group. Shared by the group links and the in-memory core, as the real core holds the same rule. */

/** `http://` followed by an address written as numbers, IPv4 or bracketed IPv6: nothing a resolver gets a say in. */
const LITERAL_HTTP = /^http:\/\/(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?$/i;

/** One DNS label: letters, digits and inner hyphens, 63 characters at most. */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

/** `http://` followed by a MagicDNS name, `<machine>.<tailnet>.ts.net`, as an origin: no user, path or query. */
const MAGIC_DNS_HTTP = new RegExp(`^http://${LABEL}(?:\\.${LABEL})+\\.ts\\.net(?::\\d+)?$`, 'i');

/**
 * The addresses of a machine this client may send a ticket and then a key to.
 * The client link is not sealed, so the transport has to say who answers:
 *
 * - a machine that gives an HTTPS address is reached there and nowhere else,
 *   so nothing on the path can talk the client down to plain HTTP;
 * - over plain HTTP a name is whatever the resolver of this device says it is,
 *   so only a MagicDNS name, first, then an address written as numbers.
 *   Tailscale owns `ts.net` and answers it on the tailnet; public DNS has no
 *   record for a tailnet machine; off the tailnet a 100.x number goes to the
 *   default gateway, as open to a hostile LAN as a spoofed name. The name is
 *   no weaker than the number, and a person can read it;
 * - an HTTPS page opens secure sockets only.
 *
 * The core's `ticketAddresses` is the same rule.
 */
export function usableAddresses(addresses: readonly string[], secure: boolean): string[] {
  const https = addresses.filter((address) => address.startsWith('https://'));
  if (https.length > 0 || secure) return https;
  return [...addresses.filter((address) => MAGIC_DNS_HTTP.test(address)), ...addresses.filter((address) => LITERAL_HTTP.test(address))];
}
