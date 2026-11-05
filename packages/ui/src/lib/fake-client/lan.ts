/**
 * The fake core's local network: Windows Defender Firewall in front of it, and
 * the private address a machine of a group listens on beside loopback.
 *
 * `?firewall=` sets the firewall: `blocked` is a dismissed prompt on a private
 * network, `unset` a private network with no rule yet, `public` a public
 * network Windows keeps closed, `refused` a block whose administrator prompt
 * nobody accepts, `ready` the private rule in place. Anything else is a
 * machine that is not Windows. `?lan=on` is a grouped machine that listens on
 * its LAN address once nothing stops it, as the real core does.
 */
import type { FirewallStatus } from '@boite/contracts';
import type { FakeContext } from './context';

/** The LAN address the fake core listens on, the one its pairing links name too. */
export const FAKE_LAN = 'http://192.168.1.20:8777';

export type FakeFirewall = 'blocked' | 'unset' | 'public' | 'refused' | 'ready' | 'unsupported';

function query(name: string): string | null {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(name);
}

export function fakeFirewallKind(kind: FakeFirewall | undefined): FakeFirewall {
  const asked = kind ?? query('firewall');
  return asked === 'blocked' || asked === 'unset' || asked === 'public' || asked === 'refused' || asked === 'ready' ? asked : 'unsupported';
}

export function fakeFirewall(kind: FakeFirewall): FirewallStatus {
  switch (kind) {
    case 'blocked':
    case 'refused': return { state: 'blocked', networks: ['private'], allowed: [], blocked: ['private'] };
    case 'unset': return { state: 'unset', networks: ['private'], allowed: [], blocked: [] };
    case 'public': return { state: 'public', networks: ['public'], allowed: [], blocked: [] };
    case 'ready': return { state: 'ready', networks: ['private'], allowed: ['private'], blocked: [] };
    default: return { state: 'unsupported', networks: [], allowed: [], blocked: [] };
  }
}

export function fakeLan(lan: boolean | undefined): boolean {
  return lan ?? query('lan') === 'on';
}

/**
 * What a fake core of a group publishes for itself: its HTTPS address, else its
 * LAN address while it listens there, else loopback. The LAN needs the policy
 * to allow it and, on Windows, the private rule.
 */
export function ownAddresses(ctx: FakeContext): string[] {
  if (ctx.identity.url.startsWith('https://')) return [ctx.identity.url];
  const network = ctx.policy.present ? ctx.policy.values.network : undefined;
  const open = ctx.firewall.state === 'ready' || ctx.firewall.state === 'unsupported';
  return ctx.lanListening && open && network?.lan !== false && network?.groups !== false ? [FAKE_LAN] : [ctx.identity.url];
}
