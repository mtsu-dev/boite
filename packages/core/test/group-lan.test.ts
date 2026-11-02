import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FirewallAccess, judge, lanAdapters, type FirewallReading } from '../src/firewall.ts';
import { advertisedAddresses, ticketAddresses } from '../src/group/addresses.ts';
import { FIREWALL_RECHECK_MS, LanGate, type Every } from '../src/group/lan.ts';
import { NETWORK_WATCH_MS } from '../src/network-watch.ts';
import { firewallAllow } from '../src/platform/windows/firewall.ts';
import { extraNetwork, ExtraListeners } from '../src/server/extra-listeners.ts';
import { privateLanAddresses, type SysNet } from '../src/server/lan.ts';
import { removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }) as NetworkInterfaceInfo;
const v6 = (address: string) => ({ address, family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:00', cidr: null, scopeid: 0 }) as NetworkInterfaceInfo;

const WINDOWS = {
  'Wi-Fi': [v6('fe80::1c2d:3e4f:5a6b:7c8d'), v4('192.168.1.20')],
  Ethernet: [v4('169.254.12.34')],
  'vEthernet (WSL (Hyper-V firewall))': [v4('172.29.16.1')],
  'vEthernet (Default Switch)': [v4('172.20.32.1')],
  'VirtualBox Host-Only Network': [v4('192.168.56.1')],
  'VMware Network Adapter VMnet8': [v4('192.168.183.1')],
  Tailscale: [v4('100.101.102.103'), v6('fd7a:115c:a1e0::1')],
  'ZeroTier One [8056c2e21c000001]': [v4('10.147.17.5')],
  'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
};
const MACOS = {
  lo0: [v4('127.0.0.1', true)],
  en0: [v6('fe80::18a4:2bff:fe3c:1'), v4('10.0.0.42')],
  en5: [v4('172.16.4.9')],
  bridge100: [v4('192.168.64.1')],
  utun3: [v4('100.101.102.103'), v6('fd7a:115c:a1e0::1')],
  utun4: [v4('10.8.0.2')],
  vmnet1: [v4('172.16.150.1')],
};
const LINUX = {
  lo: [v4('127.0.0.1', true)],
  eth0: [v4('192.168.1.42')],
  wlan0: [v4('203.0.113.7')],
  docker0: [v4('172.17.0.1')],
  'br-3f2a1b4c5d6e': [v4('172.18.0.1')],
  veth1a2b3c: [v4('172.17.0.5')],
  virbr0: [v4('192.168.122.1')],
  lxcbr0: [v4('10.0.3.1')],
  tailscale0: [v4('100.64.0.15')],
  zt5u4xbw3k: [v4('10.244.0.3')],
  wg0: [v4('10.66.0.2')],
  enp3s0: [v4('100.72.1.9'), v4('172.32.0.1')],
};

test('a grouped machine listens on its private LAN addresses only, never a virtual adapter, the tailnet or a public address', () => {
  expect(privateLanAddresses(WINDOWS, null, null)).toEqual(['192.168.1.20']);
  // macOS: `bridge100` is Internet Sharing's or a virtual machine's bridge; en0 (Wi-Fi) and en5 (a USB Ethernet adapter) are real.
  expect(privateLanAddresses(MACOS, null, null)).toEqual(['10.0.0.42', '172.16.4.9']);
  expect(privateLanAddresses(LINUX, null, null)).toEqual(['192.168.1.42']);
  // On Windows the firewall names the adapters on a private network it lets the core through on.
  expect(privateLanAddresses(WINDOWS, new Set(['Ethernet']), null)).toEqual([]);
  expect(privateLanAddresses(WINDOWS, new Set(['Wi-Fi']), null)).toEqual(['192.168.1.20']);
  expect(privateLanAddresses({}, null, null)).toEqual([]);
});

/** A Linux `/sys/class/net`: each adapter with its physical `device`, a bridge and its ports, or a tunnel. */
function sysfs(adapters: Record<string, { device?: true; ports?: string[]; tun?: true }>): SysNet {
  const paths = new Set<string>();
  for (const [name, adapter] of Object.entries(adapters)) {
    if (adapter.device) paths.add(`/sys/class/net/${name}/device`);
    if (adapter.ports) paths.add(`/sys/class/net/${name}/bridge`);
    if (adapter.tun) paths.add(`/sys/class/net/${name}/tun_flags`);
  }
  return {
    has: (path) => paths.has(path),
    list: (path) => {
      if (path === '/sys/class/net') return Object.keys(adapters);
      const bridge = /^\/sys\/class\/net\/([^/]+)\/brif$/.exec(path)?.[1];
      return bridge === undefined ? null : adapters[bridge]?.ports ?? null;
    },
  };
}

test('on Linux sysfs decides: a physical adapter, or a bridge with a physical port, never a bridge of guests alone', () => {
  const host = { lo: [v4('127.0.0.1', true)], enp3s0: [], vmbr0: [v4('192.168.1.10')], br0: [v4('172.16.0.1')], docker0: [v4('172.17.0.1')], wlp2s0: [v4('10.0.0.7')] };
  const sys = sysfs({ lo: {}, enp3s0: { device: true }, wlp2s0: { device: true }, vmbr0: { ports: ['enp3s0', 'tap100i0'] }, br0: { ports: ['veth1'] }, docker0: { ports: ['veth2'] }, veth1: {}, veth2: {}, tap100i0: {} });
  // Proxmox's vmbr0 carries the NIC, so it is the LAN; a br0 of guests only is not, whatever its name.
  expect(privateLanAddresses(host, null, sys)).toEqual(['192.168.1.10', '10.0.0.7']);
  expect(privateLanAddresses({ br0: [v4('172.16.0.1')] }, null, sysfs({ br0: { ports: [] }, eth1: { device: true } }))).toEqual([]);
  // A container: no physical adapter at all, its virtual eth0 is its LAN, and the names decide.
  expect(privateLanAddresses(LINUX, null, sysfs({ lo: {}, eth0: {}, tailscale0: {} }))).toEqual(['192.168.1.42']);
  // There sysfs still rules out a bridge of guests and a tunnel, whatever their names; the virtual eth0 stays in.
  const guests = { ...LINUX, br0: [v4('172.16.0.1')], lan1: [v4('10.8.0.2')], lxcbr0: [v4('10.0.3.1')] };
  const container = sysfs({ lo: {}, eth0: {}, br0: { ports: ['veth1'] }, veth1: {}, lan1: { tun: true }, lxcbr0: { ports: [] } });
  expect(privateLanAddresses(guests, null, container)).toEqual(['192.168.1.42']);
  // sysfs unreadable: the names decide too.
  expect(privateLanAddresses(LINUX, null, { has: () => false, list: () => null })).toEqual(['192.168.1.42']);
});

test('extra listeners follow the wanted set: one per address, a refused bind said once and skipped, the others kept', () => {
  const opened: string[] = [];
  const stopped: string[] = [];
  const logs: string[] = [];
  const listeners = new ExtraListeners({
    port: 7000,
    serve: (host) => {
      if (host === '10.0.0.9') throw new Error('EADDRNOTAVAIL');
      opened.push(host);
      return { stop: () => { stopped.push(host); } };
    },
    log: (level, message) => logs.push(`${level} ${message}`),
  });
  expect([...listeners.set(['100.64.0.15', '192.168.1.20'])]).toEqual(['100.64.0.15', '192.168.1.20']);
  expect([...listeners.set(['100.64.0.15', '192.168.1.20', '10.0.0.9'])]).toEqual(['100.64.0.15', '192.168.1.20']);
  expect([...listeners.set(['100.64.0.15', '192.168.1.20', '10.0.0.9'])]).toEqual(['100.64.0.15', '192.168.1.20']);
  expect(opened).toEqual(['100.64.0.15', '192.168.1.20']);
  expect(logs.filter((line) => line.startsWith('warn'))).toEqual(['warn could not listen on 10.0.0.9:7000 for the group: EADDRNOTAVAIL']);
  // The Wi-Fi changed: the old LAN listener closes, the new one opens, the tailnet one is left alone.
  expect([...listeners.set(['100.64.0.15', '192.168.0.12'])]).toEqual(['100.64.0.15', '192.168.0.12']);
  expect(stopped).toEqual(['192.168.1.20']);
  listeners.close();
  expect(stopped).toEqual(['192.168.1.20', '100.64.0.15', '192.168.0.12']);
});

test('LAN listeners open only when the server may: not bound everywhere, no --host, policy network.lan and network.groups on', () => {
  const run = (options: { host?: string; enabled?: boolean; off?: string[] }) => {
    const opened: string[] = [];
    const network = extraNetwork({
      host: options.host ?? '127.0.0.1', port: 7000, enabled: options.enabled ?? true,
      policy: { networkOff: (item) => (options.off ?? []).includes(item) },
      serve: (host) => { opened.push(host); return { stop: () => undefined }; },
      log: () => undefined, stopping: () => false,
    });
    const reach = network.also({ tailnet: '100.64.0.15', lan: ['192.168.1.20'] });
    return { opened, reach, lanAllowed: network.lanAllowed() };
  };
  expect(run({})).toEqual({ opened: ['100.64.0.15', '192.168.1.20'], reach: { tailnet: true, lan: ['192.168.1.20'] }, lanAllowed: true });
  expect(run({ off: ['lan'] })).toEqual({ opened: ['100.64.0.15'], reach: { tailnet: true, lan: [] }, lanAllowed: false });
  expect(run({ off: ['groups'] })).toEqual({ opened: [], reach: { tailnet: false, lan: [] }, lanAllowed: false });
  // `--host` or `--lan`, or a test core.
  expect(run({ enabled: false })).toEqual({ opened: [], reach: { tailnet: false, lan: [] }, lanAllowed: false });
  // Bound everywhere: the main listener answers on all of them.
  expect(run({ host: '0.0.0.0' })).toEqual({ opened: [], reach: { tailnet: true, lan: [] }, lanAllowed: false });
});

test('LAN addresses are published after HTTPS and the tailnet, and a client may be sent there', () => {
  const tailnet = { ip: '100.101.102.103', name: 'desk.tail0d6070.ts.net' };
  expect(advertisedAddresses({ host: '127.0.0.1', port: 7000, tailnet: true, lan: ['192.168.1.20'] }, tailnet, null))
    .toEqual(['http://desk.tail0d6070.ts.net:7000', 'http://100.101.102.103:7000', 'http://192.168.1.20:7000']);
  // No Tailscale: the LAN listener alone, not loopback.
  const alone = advertisedAddresses({ host: '127.0.0.1', port: 7000, tailnet: false, lan: ['192.168.1.20'] }, null, null);
  expect(alone).toEqual(['http://192.168.1.20:7000']);
  expect(ticketAddresses(alone)).toEqual(['http://192.168.1.20:7000']);
});

const ethernet = (category: string, adapter = 'Wi-Fi') => ({ adapter, category });

test('the firewall counts private networks only: a public one has its own state, and the private rule is what opens the LAN', () => {
  // A dismissed prompt on a public network, or a rule for every profile: neither is Boite's to fix there.
  expect(judge({ rules: [{ action: 0, profiles: 4 }], networks: [ethernet('Public')], off: 0 })).toEqual({ state: 'public', networks: ['public'], allowed: [], blocked: [] });
  expect(judge({ rules: [{ action: 1, profiles: 0x7fffffff }], networks: [ethernet('Public'), ethernet('DomainAuthenticated', 'Ethernet')], off: 0 }).state).toBe('public');
  const reading: FirewallReading = { rules: [{ action: 1, profiles: 2 }], networks: [ethernet('Private'), ethernet('Public', 'Ethernet'), { adapter: 'Tailscale', category: 'Private' }], off: 0 };
  expect(judge(reading)).toEqual({ state: 'ready', networks: ['public', 'private'], allowed: ['private'], blocked: [] });
  // Only the private adapter opens, even beside a public one.
  expect(lanAdapters(reading)).toEqual(['Wi-Fi']);
  expect(lanAdapters({ ...reading, rules: [{ action: 1, profiles: 4 }] })).toEqual([]);
  expect(lanAdapters({ ...reading, rules: [{ action: 1, profiles: 2 }, { action: 0, profiles: 2 }] })).toEqual([]);
});

test('the rule Boite asks Windows for covers the Private profile, never Any or Public', () => {
  const outer = Buffer.from(firewallAllow('C:\\Boite\\boite-core.exe').at(-1)!, 'base64').toString('utf16le');
  const inner = /-EncodedCommand ([A-Za-z0-9+/=]+)/.exec(outer)?.[1];
  expect(inner).toBeDefined();
  const script = Buffer.from(inner!, 'base64').toString('utf16le');
  expect(script).toContain('New-NetFirewallRule');
  expect(script).toContain('-Profile Private');
  expect(script).not.toMatch(/-Profile (Any|Public)/);
});

const cores: TestCore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

const FAKE = join(import.meta.dir, 'fixtures', 'fake-firewall.ts');

/** Timers the test fires by hand: `fire(ms)` runs every tick armed at that period. */
function clock() {
  const armed = new Set<{ tick: () => void; ms: number }>();
  const every: Every = (tick, ms) => {
    const entry = { tick, ms };
    armed.add(entry);
    return () => { armed.delete(entry); };
  };
  return { every, armed: () => armed.size, fire: (ms: number) => { for (const entry of [...armed]) if (entry.ms === ms) entry.tick(); } };
}

/** A test core whose network sink opens pretend listeners, on a machine with `interfaces`. */
async function lanCore(options: { policy?: object; firewall?: FirewallReading } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boite-lan-'));
  dirs.push(dir);
  const policyFile = join(dir, 'policy.json');
  if (options.policy) writeFileSync(policyFile, JSON.stringify(options.policy));
  const harness = await startTestCore({ policyFile });
  cores.push(harness);
  const { core } = harness;
  const listening = new Set<string>();
  core.network = extraNetwork({
    host: '127.0.0.1', port: harness.server.port, enabled: true, policy: core.policy,
    serve: (host) => { listening.add(host); return { stop: () => { listening.delete(host); } }; },
    log: () => undefined, stopping: () => false,
  });
  const state = join(dir, 'reading.json');
  let reads = 0;
  if (options.firewall) {
    writeFileSync(state, JSON.stringify(options.firewall));
    const access = new FirewallAccess(core, {
      program: 'C:\\Boite\\boite-core.exe',
      commands: { query: () => { reads += 1; return [process.execPath, FAKE, state, 'query']; }, allow: () => [process.execPath, FAKE, state, 'allow'] },
    });
    core.group.lan = new LanGate(access, core.group.lan.changed);
  }
  let interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = options.firewall ? WINDOWS : LINUX;
  core.group.lan.interfaces = () => interfaces;
  core.group.lan.sys = null;
  const timers = clock();
  core.group.lan.every = timers.every;
  const own = () => core.group.roster?.cores.find((entry) => entry.coreId === core.group.selfId())?.addresses ?? [];
  const setInterfaces = (next: NodeJS.Dict<NetworkInterfaceInfo[]>) => { interfaces = next; };
  return { harness, core, listening, own, state, reads: () => reads, port: harness.server.port, timers, setInterfaces };
}

test('a grouped core listens on its LAN address and publishes it, and closes it when it leaves the group', async () => {
  const { core, listening, own, port } = await lanCore();
  core.group.relisten();
  // In no group, nothing but loopback.
  expect([...listening]).toEqual([]);
  expect(core.reachableUrl()).toBe(`http://127.0.0.1:${port}`);
  await core.group.create('Home');
  expect([...listening]).toEqual(['192.168.1.42']);
  expect(own()).toEqual([`http://192.168.1.42:${port}`]);
  // The Add a device link names it, not 127.0.0.1.
  expect(core.reachableUrl()).toBe(`http://192.168.1.42:${port}`);
  expect(core.group.given()).toEqual([`http://192.168.1.42:${port}`]);
  await core.group.leave();
  expect([...listening]).toEqual([]);
});

test('policy network.lan false keeps a grouped core off the LAN', async () => {
  const { core, listening, own, port } = await lanCore({ policy: { network: { lan: false } } });
  await core.group.create('Home');
  expect([...listening]).toEqual([]);
  expect(own()).toEqual([`http://127.0.0.1:${port}`]);
});

test('on Windows the LAN listener waits for the firewall to allow the private network, and a public one stays closed', async () => {
  const { core, listening, own, state, reads, port } = await lanCore({ firewall: { rules: [], networks: [ethernet('Private')], off: 0 } });
  await core.group.create('Home');
  // No rule for the private network yet: opening would raise Windows' own prompt.
  await waitFor(() => reads() === 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect([...listening]).toEqual([]);
  expect(own()).toEqual([`http://127.0.0.1:${port}`]);
  // The owner allows it: the rule covers private networks, and the listener opens without waiting for a network change.
  expect((await core.group.lan.firewall.allow()).state).toBe('ready');
  await waitFor(() => listening.has('192.168.1.20'));
  await waitFor(() => own().includes(`http://192.168.1.20:${port}`));
  expect([...listening]).toEqual(['192.168.1.20']);
  // The ticks that follow read nothing more: PowerShell runs on a change only.
  const after = reads();
  core.group.relisten();
  core.group.relisten();
  expect(reads()).toBe(after);
  // The same Wi-Fi turns public: the network change reads the firewall again and the listener closes.
  writeFileSync(state, JSON.stringify({ rules: [{ action: 1, profiles: 2 }], networks: [ethernet('Public')], off: 0 }));
  core.group.relisten(true);
  await waitFor(() => listening.size === 0);
  await waitFor(() => !own().includes(`http://192.168.1.20:${port}`));
  expect(reads()).toBe(after + 1);
});

const PRIVATE_ALLOWED: FirewallReading = { rules: [{ action: 1, profiles: 2 }], networks: [ethernet('Private')], off: 0 };
const ANY_RULE_ON_PUBLIC: FirewallReading = { rules: [{ action: 1, profiles: 7 }], networks: [ethernet('Public')], off: 0 };

test('grouped on Windows, the core sees on its own a network turned public with the same address, with no window open', async () => {
  const { core, listening, state, reads, timers } = await lanCore({ firewall: PRIVATE_ALLOWED });
  await core.group.create('Home');
  await waitFor(() => listening.has('192.168.1.20'));
  expect(timers.armed()).toBe(2);
  // Windows turns the Wi-Fi public: same adapter, same address, and an older rule for every profile still allows the core.
  writeFileSync(state, JSON.stringify(ANY_RULE_ON_PUBLIC));
  const before = reads();
  timers.fire(NETWORK_WATCH_MS);
  timers.fire(NETWORK_WATCH_MS);
  expect(reads()).toBe(before);
  // The slow recheck reads Windows again, once even if it fires twice, and the listener closes.
  timers.fire(FIREWALL_RECHECK_MS);
  timers.fire(FIREWALL_RECHECK_MS);
  await waitFor(() => listening.size === 0);
  expect(reads()).toBe(before + 1);
  // An address that changes closes the LAN and reads Windows again at once.
  writeFileSync(state, JSON.stringify(PRIVATE_ALLOWED));
  timers.fire(FIREWALL_RECHECK_MS);
  await waitFor(() => listening.has('192.168.1.20'));
  core.group.lan.interfaces = () => ({ ...WINDOWS, 'Wi-Fi': [v4('192.168.1.21')] });
  writeFileSync(state, 'not a reading');
  timers.fire(NETWORK_WATCH_MS);
  expect(listening.has('192.168.1.20')).toBe(false);
  // Leaving the group stops both timers.
  await core.group.leave();
  expect(timers.armed()).toBe(0);
});

test('a core that leaves its group forgets the firewall: grouped again on a public network, it reads Windows before any listener', async () => {
  const { core, listening, state, reads, setInterfaces } = await lanCore({ firewall: PRIVATE_ALLOWED });
  await core.group.create('Home');
  await waitFor(() => listening.has('192.168.1.20'));
  await core.group.leave();
  expect([...listening]).toEqual([]);
  // Out of the group, the laptop moves to a public Wi-Fi on the same adapter, where an older every-profile rule lets the core through.
  writeFileSync(state, JSON.stringify(ANY_RULE_ON_PUBLIC));
  setInterfaces({ ...WINDOWS, 'Wi-Fi': [v4('10.0.0.9')] });
  const before = reads();
  await core.group.create('Cafe');
  expect([...listening]).toEqual([]);
  await waitFor(() => reads() === before + 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect([...listening]).toEqual([]);
});

test('a network change closes the LAN at once, and a reading that fails keeps it closed until one answers', async () => {
  const { core, listening, state, reads, timers } = await lanCore({ firewall: PRIVATE_ALLOWED });
  await core.group.create('Home');
  await waitFor(() => listening.has('192.168.1.20'));
  // Now on a public network, the old every-profile rule still there, and Windows does not answer.
  writeFileSync(state, 'not a reading');
  const before = reads();
  core.group.relisten(true);
  expect([...listening]).toEqual([]);
  await waitFor(() => reads() === before + 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect([...listening]).toEqual([]);
  // The recheck that fails keeps it closed too; one that answers private and allowed opens it again.
  timers.fire(FIREWALL_RECHECK_MS);
  await waitFor(() => reads() === before + 2);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect([...listening]).toEqual([]);
  writeFileSync(state, JSON.stringify(PRIVATE_ALLOWED));
  timers.fire(FIREWALL_RECHECK_MS);
  await waitFor(() => listening.has('192.168.1.20'));
});
