/*
 * The listeners a grouped core opens beside its main one, on the same port:
 * its tailnet address, and its private LAN addresses so a phone or a computer
 * on the same Wi-Fi reaches it without Tailscale (`group/lan.ts` says which).
 * One listener per address, opened and closed as the wanted set changes; an
 * address that cannot be bound is said once and skipped, the others stay.
 */

import type { ExtraAddresses, ExtraReach, NetworkSink } from '../group/addresses.ts';

export interface Closable { stop(force: boolean): unknown }

export interface ExtraNetworkOptions<S extends Closable> {
  /** The address the main listener bound. */
  host: string;
  port: number;
  /**
   * Whether this core may open anything beside its main listener: `main` says
   * so unless `--host` or `--lan` chose the address; a test core never does.
   */
  enabled: boolean;
  policy: { networkOff(item: 'lan' | 'groups'): boolean };
  serve(host: string, port: number): S;
  log(level: 'info' | 'warn', message: string): void;
  stopping(): boolean;
}

const NOTHING: ExtraReach = { tailnet: false, lan: [] };

/** Listeners for the set of extra addresses a group asks for. */
export class ExtraListeners<S extends Closable> {
  readonly #open = new Map<string, S>();
  /** Addresses that failed to bind, said once until they leave the set or bind. */
  readonly #refused = new Set<string>();

  constructor(private readonly options: Pick<ExtraNetworkOptions<S>, 'port' | 'serve' | 'log'>) {}

  /** Keeps one listener per address of `wanted` and none other; answers the addresses that listen. */
  set(wanted: readonly string[]): Set<string> {
    const keep = new Set(wanted);
    for (const [address, server] of this.#open) {
      if (keep.has(address)) continue;
      // As for the main listener: `stop()` never resolves once a socket was upgraded.
      void server.stop(true);
      this.#open.delete(address);
    }
    for (const address of this.#refused) if (!keep.has(address)) this.#refused.delete(address);
    for (const address of keep) {
      if (this.#open.has(address)) continue;
      try {
        this.#open.set(address, this.options.serve(address, this.options.port));
        this.#refused.delete(address);
        this.options.log('info', `listening on ${address}:${this.options.port} too, for the machines and devices of this core's group`);
      } catch (error) {
        // Asked again at every tick while the address stays unusable: say it once.
        if (!this.#refused.has(address)) this.options.log('warn', `could not listen on ${address}:${this.options.port} for the group: ${error instanceof Error ? error.message : String(error)}`);
        this.#refused.add(address);
      }
    }
    return new Set(this.#open.keys());
  }

  close(): void {
    this.set([]);
  }
}

/**
 * What the server can do for the group: answer on its tailnet address, and on
 * its private LAN ones. A core bound everywhere already answers on all of
 * them through its main listener and opens nothing.
 */
export function extraNetwork<S extends Closable>(options: ExtraNetworkOptions<S>): NetworkSink & { close(): void } {
  const listeners = new ExtraListeners(options);
  const { host, enabled, policy } = options;
  const everywhere = host === '0.0.0.0' || host === '::';
  const lanAllowed = (): boolean => enabled && !everywhere && !options.stopping() && !policy.networkOff('lan') && !policy.networkOff('groups');
  return {
    lanAllowed,
    also(wanted: ExtraAddresses): ExtraReach {
      if (options.stopping()) return NOTHING;
      const { tailnet } = wanted;
      // An admin policy without groups leaves nothing for the group to reach.
      const extraTailnet = tailnet !== null && !everywhere && tailnet !== host && enabled && !policy.networkOff('groups');
      const lan = lanAllowed() ? wanted.lan.filter((address) => address !== host) : [];
      const open = listeners.set([...(extraTailnet ? [tailnet] : []), ...lan]);
      return {
        tailnet: tailnet !== null && (everywhere || tailnet === host || open.has(tailnet)),
        lan: lan.filter((address) => open.has(address)),
      };
    },
    close: () => listeners.close(),
  };
}
