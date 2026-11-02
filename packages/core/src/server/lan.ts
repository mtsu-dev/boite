import { existsSync, readdirSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * The IPv4 address a phone on the same network dials to reach this machine: a
 * private one first (home and office networks), then any other external one.
 * Null when the machine has no external IPv4 address at all.
 */
export function lanAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string | null {
  const external = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => (entry.family === 'IPv4' || (entry.family as unknown) === 4) && !entry.internal)
    .map((entry) => entry.address)
    // Link-local (169.254/16) is what Windows gives an adapter with no DHCP answer.
    .filter((address) => !address.startsWith('169.254.'));
  return external.find((address) => PRIVATE_V4.some((range) => range.test(address))) ?? external[0] ?? null;
}

/** RFC 1918: 10/8, 172.16/12, 192.168/16, written as four numbers. */
export function isPrivateV4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Adapters that are not a network a phone is on, by name: container and VM
 * bridges (docker0, br-1a2b, veth, virbr, lxcbr, lxdbr, incusbr, cni, podman,
 * Hyper-V's and WSL's vEthernet, VirtualBox and VMware host-only adapters,
 * macOS's `bridge100` and up for Internet Sharing and virtual machines), and
 * tunnels (Tailscale, which has its own listener, macOS `utun`, ZeroTier,
 * WireGuard, OpenVPN's tun and tap). Their 10.x or 172.x address leads to a
 * guest or a VPN, never to the Wi-Fi the owner's phone is on. The rule on
 * Windows and macOS, and on Linux when sysfs says nothing.
 */
const VIRTUAL = /^(bridge1\d\d|docker|br-|veth|virbr|lxcbr|lxdbr|incusbr|cni|podman|flannel|vethernet|vboxnet|virtualbox|vmnet|vmware|tailscale|utun|zt|zerotier|wg|tun|tap)/i;

/** What Linux's `/sys/class/net` says, read through two calls so tests give their own. */
export interface SysNet {
  /** Whether a path exists. */
  has(path: string): boolean;
  /** The entries of a directory, or null when it cannot be read. */
  list(path: string): string[] | null;
}

const SYSFS: SysNet = {
  has: (path) => existsSync(path),
  list: (path) => { try { return readdirSync(path); } catch { return null; } },
};

const NET = '/sys/class/net';

/**
 * Linux's own answer to "is this adapter on a real network": a physical one
 * (it has a `device`), or a bridge with a physical port (`br0` or Proxmox's
 * `vmbr0` with the NIC enslaved to it, which is the LAN itself). A bridge
 * with no physical port (docker0, virbr0, a `br0` of guests only) and every
 * other virtual interface are out. A machine with no physical adapter at all
 * is a container or a VM whose `eth0` is virtual yet is its LAN: there the
 * names decide, and sysfs still rules out every bridge (none has a physical
 * port) and every tunnel (`tun_flags`). Null means sysfs cannot be read.
 */
export function sysfsAdapters(sys: SysNet): ((name: string) => boolean) | null {
  const names = sys.list(NET);
  if (names === null) return null;
  const physical = (name: string) => sys.has(`${NET}/${name}/device`);
  const bridge = (name: string) => sys.has(`${NET}/${name}/bridge`);
  if (names.some(physical)) return (name) => physical(name) || (bridge(name) && (sys.list(`${NET}/${name}/brif`) ?? []).some(physical));
  return (name) => !VIRTUAL.test(name) && !bridge(name) && !sys.has(`${NET}/${name}/tun_flags`);
}

/**
 * This machine's private LAN IPv4 addresses, the ones a phone on the same
 * Wi-Fi dials: RFC 1918 only, on a physical adapter. Never loopback,
 * link-local, a public address or the tailnet's 100.64/10 (it has a listener
 * of its own). With `adapters`, only those adapters count: on Windows, the
 * ones on a private network the firewall lets the core through on. `sys` is
 * Linux's sysfs, read for which adapters are physical (`sysfsAdapters`).
 */
export function privateLanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
  adapters: ReadonlySet<string> | null = null,
  sys: SysNet | null = process.platform === 'linux' ? SYSFS : null,
): string[] {
  const real = (sys === null ? null : sysfsAdapters(sys)) ?? ((name: string) => !VIRTUAL.test(name));
  const found: string[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (entries === undefined || !real(name) || (adapters !== null && !adapters.has(name))) continue;
    for (const entry of entries) {
      if ((entry.family === 'IPv4' || (entry.family as unknown) === 4) && !entry.internal && isPrivateV4(entry.address)) found.push(entry.address);
    }
  }
  return [...new Set(found)];
}
