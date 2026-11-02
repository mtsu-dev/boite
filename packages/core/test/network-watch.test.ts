import { expect, test } from 'bun:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { externalAddresses, NETWORK_WATCH_MS, NetworkWatch, ownerPresent } from '../src/network-watch.ts';

const entry = (address: string, internal = false): NetworkInterfaceInfo => ({
  address, internal, netmask: '255.255.255.0', family: address.includes(':') ? 'IPv6' : 'IPv4', mac: '00:00:00:00:00:00', cidr: null, ...(address.includes(':') ? { scopeid: 0 } : {})
} as NetworkInterfaceInfo);

/** A clock driven by hand: `run` fires the watch's tick as its timer would. */
function harness() {
  let interfaces: Record<string, NetworkInterfaceInfo[]> = { lo: [entry('127.0.0.1', true)], eth0: [entry('192.168.1.20')] };
  let open = 1;
  let owner = true;
  let tick: (() => void) | null = null;
  let period = 0;
  const changes: string[][] = [];
  let reads = 0;
  const watch = new NetworkWatch({
    live: () => open > 0,
    wanted: () => owner,
    changed: (addresses) => changes.push(addresses),
    read: () => { reads += 1; return interfaces; },
    every: (fn, ms) => { tick = fn; period = ms; return () => { tick = null; }; }
  });
  return {
    watch, changes,
    get reads() { return reads; },
    get armed() { return tick !== null; },
    get period() { return period; },
    run: () => tick?.(),
    set interfaces(next: Record<string, NetworkInterfaceInfo[]>) { interfaces = next; },
    set open(count: number) { open = count; },
    set owner(present: boolean) { owner = present; }
  };
}

test('reads only non-internal addresses, sorted and once each', () => {
  expect(externalAddresses(() => ({
    lo: [entry('127.0.0.1', true), entry('::1', true)],
    tailscale0: [entry('100.64.0.15'), entry('fd7a::f')],
    eth0: [entry('192.168.1.20'), entry('100.64.0.15')]
  }))).toEqual(['100.64.0.15', '192.168.1.20', 'fd7a::f']);
});

test('tells once when Tailscale comes up or goes down, and never on the first reading', () => {
  const h = harness();
  h.watch.wake();
  expect(h.armed).toBe(true);
  expect(h.period).toBe(NETWORK_WATCH_MS);
  h.run();
  expect(h.changes).toEqual([]);
  h.run();
  expect(h.changes).toEqual([]);
  h.interfaces = { eth0: [entry('192.168.1.20')], tailscale0: [entry('100.64.0.15')] };
  h.run();
  h.run();
  expect(h.changes).toEqual([['100.64.0.15', '192.168.1.20']]);
  h.interfaces = { eth0: [entry('192.168.1.20')] };
  h.run();
  expect(h.changes).toEqual([['100.64.0.15', '192.168.1.20'], ['192.168.1.20']]);
});

test('costs nothing without a socket, reads nothing without an owner window, and starts afresh on wake', () => {
  const h = harness();
  h.watch.wake();
  h.run();
  // Only a paired phone left: no reading, and a change meanwhile is no news to the next owner window.
  h.owner = false;
  const before = h.reads;
  h.interfaces = { wlan0: [entry('10.0.0.7')] };
  h.run();
  expect(h.reads).toBe(before);
  h.owner = true;
  h.run();
  expect(h.changes).toEqual([]);
  // Every socket gone: the timer stops at its next tick, and a socket opening starts it again with a new baseline.
  h.open = 0;
  h.run();
  expect(h.armed).toBe(false);
  expect(h.watch.running).toBe(false);
  h.open = 1;
  h.interfaces = { wlan0: [entry('10.0.0.8')] };
  h.watch.wake();
  h.run();
  expect(h.changes).toEqual([]);
});

test('counts an authenticated owner window only, never a plugin, a phone or an agent', () => {
  const owner = { authenticated: true, identity: { principal: 'owner' }, clientName: 'shell' };
  expect(ownerPresent([owner])).toBe(true);
  expect(ownerPresent([{ ...owner, authenticated: false }])).toBe(false);
  expect(ownerPresent([{ ...owner, clientName: 'plugin' }])).toBe(false);
  expect(ownerPresent([{ ...owner, identity: { principal: 'session' } }, { ...owner, identity: { principal: 'agent' } }])).toBe(false);
});
