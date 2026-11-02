/*
 * Which private LAN addresses a grouped core listens on, so a phone or a
 * computer on the same Wi-Fi reaches it without Tailscale.
 *
 * Elsewhere than Windows, every private address of a physical adapter
 * (`privateLanAddresses`). On Windows, only those of adapters on a private
 * network the firewall lets the core through on: a listener anywhere else
 * would make Windows raise its own prompt, and a public network stays closed.
 * While the core is grouped, the gate watches for itself, whether or not a
 * window is open: the interfaces every few seconds (a call, no process), and
 * the firewall every two minutes, since Windows can turn a network public or
 * private without changing its address. A reading runs PowerShell, so there
 * is never more than one at a time and never one per tick. Between a network
 * change and the reading that follows, and after a reading that failed, the
 * LAN stays closed: an older rule that allowed every profile would otherwise
 * keep the core open on a network that just turned public.
 */

import { networkInterfaces } from 'node:os';
import type { FirewallAccess } from '../firewall.ts';
import { externalAddresses, NETWORK_WATCH_MS } from '../network-watch.ts';
import { privateLanAddresses, type SysNet } from '../server/lan.ts';

/** How often Windows is asked again while grouped: a network turned public or private keeps its address. */
export const FIREWALL_RECHECK_MS = 120_000;

/** Runs `tick` every `ms` until the returned function is called. */
export type Every = (tick: () => void, ms: number) => () => void;

function interval(tick: () => void, ms: number): () => void {
  const timer = setInterval(tick, ms);
  timer.unref?.();
  return () => clearInterval(timer);
}

export class LanGate {
  /** Undefined while closed: before Windows answered, after a network change, after a failed reading. Null where there is no firewall to ask. */
  #adapters: ReadonlySet<string> | null | undefined;
  #reading: Promise<void> | null = null;
  /** A reading is wanted: none yet, or the network changed since. */
  #due: boolean;
  /** The timers' stops while the gate watches; empty while the core is in no group. */
  #stops: (() => void)[] = [];
  /** The interfaces at the last look, to tell a change. */
  #seen: string | null = null;
  /** Replaced in tests, which have no network, timers or sysfs of their own; `sys` undefined is this machine's own. */
  interfaces: typeof networkInterfaces = networkInterfaces;
  every: Every = interval;
  sys: SysNet | null | undefined;

  /** `changed` runs when the adapters changed: the listeners and the published entry follow. */
  constructor(readonly firewall: FirewallAccess, readonly changed: () => void) {
    this.#adapters = firewall.supported() ? undefined : null;
    this.#due = this.#adapters === undefined;
    firewall.watch((adapters) => {
      const before = this.#adapters;
      if (adapters === null) {
        // An unreadable firewall says nothing about the network now: closed until one answers.
        this.#adapters = undefined;
        if (before instanceof Set) changed();
        return;
      }
      // A change is waiting for its own reading: this one may describe the network before it.
      if (this.#due) return;
      this.#adapters = new Set(adapters);
      if (!(before instanceof Set) || before.size !== adapters.length || adapters.some((name) => !before.has(name))) changed();
    });
  }

  /** Whether the gate is watching the network and the firewall. */
  get watching(): boolean {
    return this.#stops.length > 0;
  }

  /**
   * The addresses to listen on now. `wanted` false (no group, or the policy
   * forbids the LAN) stops the watch. On Windows the first call, or the first
   * after a change, reads the firewall in the background.
   */
  addresses(wanted = true): string[] {
    if (!wanted) { this.stop(); return []; }
    if (this.#adapters === null) return privateLanAddresses(this.interfaces(), null, this.sys);
    this.#watch();
    if (this.#due) this.#read();
    return this.#adapters === undefined ? [] : privateLanAddresses(this.interfaces(), this.#adapters, this.sys);
  }

  /** The network changed: closed at once, until a reading says which networks are private now. */
  stale(): void {
    if (this.#adapters === null) return;
    this.#adapters = undefined;
    this.#due = true;
  }

  /** The core left its group or stops: no timer stays behind. */
  stop(): void {
    for (const stop of this.#stops.splice(0)) stop();
    this.#seen = null;
  }

  #watch(): void {
    if (this.#stops.length > 0) return;
    this.#seen = null;
    this.#stops.push(this.every(() => this.#look(), NETWORK_WATCH_MS), this.every(() => this.#read(), FIREWALL_RECHECK_MS));
  }

  /** The interfaces changed: the LAN closes now, and the listeners ask again, which reads the firewall. */
  #look(): void {
    let key: string;
    try { key = externalAddresses(this.interfaces).join(' '); } catch { return; }
    const before = this.#seen;
    this.#seen = key;
    if (before === null || before === key) return;
    this.stale();
    this.changed();
  }

  #read(): void {
    if (this.#reading !== null) return;
    this.#due = false;
    // The reading reaches `#adapters` through `watch`, a failed one included; a rejection is one too.
    this.#reading = this.firewall.status().then(() => undefined, () => {
      if (this.#adapters instanceof Set) { this.#adapters = undefined; this.changed(); }
    }).finally(() => {
      this.#reading = null;
      // A change came during the reading: what it said may be the old network.
      if (this.#due) this.#read();
    });
  }
}
