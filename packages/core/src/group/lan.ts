/*
 * Which private LAN addresses a grouped core listens on, so a phone or a
 * computer on the same Wi-Fi reaches it without Tailscale.
 *
 * Elsewhere than Windows, every private address of a physical adapter
 * (`privateLanAddresses`). On Windows, only those of adapters on a private
 * network the firewall already lets the core through on: a listener anywhere
 * else would make Windows raise its own prompt, and a public network stays
 * closed. The firewall is read once a member first wants the LAN, on a network
 * change (`stale`), and whenever the owner reads or fixes it; never at every
 * tick, since each reading runs PowerShell.
 */

import { networkInterfaces } from 'node:os';
import type { FirewallAccess } from '../firewall.ts';
import { privateLanAddresses } from '../server/lan.ts';

export class LanGate {
  /** Undefined until Windows answered once: nothing opens before. Null where there is no firewall to ask. */
  #adapters: ReadonlySet<string> | null | undefined;
  #reading: Promise<void> | null = null;
  /** A reading is wanted: none yet, or the network changed since. One that fails is not retried before the next change. */
  #due: boolean;
  /** Replaced in tests, which have no network of their own. */
  interfaces: typeof networkInterfaces = networkInterfaces;

  /** `changed` runs when a reading changed the adapters: the listeners and the published entry follow. */
  constructor(readonly firewall: FirewallAccess, readonly changed: () => void) {
    this.#adapters = firewall.supported() ? undefined : null;
    this.#due = this.#adapters === undefined;
    firewall.watch((adapters) => {
      const before = this.#adapters;
      this.#adapters = new Set(adapters);
      if (before === undefined || before === null || before.size !== adapters.length || adapters.some((name) => !before.has(name))) changed();
    });
  }

  /** The addresses to listen on now; the first call on Windows, or the first after `stale`, reads the firewall in the background. */
  addresses(): string[] {
    if (this.#due) this.#read();
    return this.#adapters === undefined ? [] : privateLanAddresses(this.interfaces(), this.#adapters);
  }

  /** The network changed: a network may have turned public or private, so the next `addresses` reads the firewall again. */
  stale(): void {
    if (this.#adapters !== null) this.#due = true;
  }

  #read(): void {
    if (this.#reading !== null) return;
    this.#due = false;
    // The reading reaches `#adapters` through `watch`; an unreadable one keeps what was known.
    this.#reading = this.firewall.status().then(() => undefined, () => undefined).finally(() => { this.#reading = null; });
  }
}
