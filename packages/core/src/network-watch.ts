import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/**
 * How often the interfaces are read while an owner window is connected. Reading
 * them is a system call and a few objects; Tailscale coming up shows within it.
 */
export const NETWORK_WATCH_MS = 2500;

export type InterfacesReader = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

/** The non-internal addresses `read` gives, sorted and without repeats: what decides whether the network changed. */
export function externalAddresses(read: InterfacesReader = networkInterfaces): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(read())) {
    for (const entry of entries ?? []) if (!entry.internal) found.add(entry.address);
  }
  return [...found].sort();
}

/** The connections the server holds, as far as the watch needs to know them. */
interface Watcher { authenticated: boolean; identity: { principal: string }; clientName?: string | null }

/** An owner window: neither a paired device, nor an agent, nor a desktop-app plugin that draws nothing. */
export function ownerPresent(connections: Iterable<Watcher>): boolean {
  for (const connection of connections) {
    if (connection.authenticated && connection.identity.principal === 'owner' && connection.clientName !== 'plugin') return true;
  }
  return false;
}

export interface NetworkWatchOptions {
  /** Whether any socket is open: with none, the timer stops until `wake`. */
  live: () => boolean;
  /** Whether an owner window listens: only then are the interfaces read. */
  wanted: () => boolean;
  /** The set of addresses changed since the last reading. */
  changed: (addresses: string[]) => void;
  read?: InterfacesReader;
  /** Runs `tick` every `ms` until the returned function is called. Replaced in tests. */
  every?: (tick: () => void, ms: number) => () => void;
}

function interval(tick: () => void, ms: number): () => void {
  const timer = setInterval(tick, ms);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Tells owner windows when this machine's addresses change, so a machine they
 * could not reach is tried again at once instead of at its next backoff. It
 * costs nothing while no socket is open: the timer starts on `wake` (a socket
 * opened) and stops at the first tick that finds none. The first reading after
 * a start is the baseline, never a change.
 */
export class NetworkWatch {
  #stop: (() => void) | null = null;
  #last: string | null = null;
  readonly #options: NetworkWatchOptions;
  readonly #read: InterfacesReader;
  readonly #every: (tick: () => void, ms: number) => () => void;

  constructor(options: NetworkWatchOptions) {
    this.#options = options;
    this.#read = options.read ?? networkInterfaces;
    this.#every = options.every ?? interval;
  }

  get running(): boolean {
    return this.#stop !== null;
  }

  /** A socket opened: the watch runs, if it did not already. */
  wake(): void {
    if (this.#stop !== null) return;
    this.#last = null;
    this.#stop = this.#every(() => this.tick(), NETWORK_WATCH_MS);
  }

  sleep(): void {
    this.#stop?.();
    this.#stop = null;
    this.#last = null;
  }

  tick(): void {
    if (!this.#options.live()) { this.sleep(); return; }
    // Only owner windows hear the event: with none, a change while they are away is no news to the next one.
    if (!this.#options.wanted()) { this.#last = null; return; }
    let addresses: string[];
    try { addresses = externalAddresses(this.#read); } catch { return; }
    const key = addresses.join(' ');
    const before = this.#last;
    this.#last = key;
    if (before !== null && before !== key) this.#options.changed(addresses);
  }
}
