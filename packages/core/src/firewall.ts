/*
 * Windows Defender Firewall, read and fixed for this core.
 *
 * A phone on the same network reaches the core only when the firewall lets
 * the core's executable accept connections on that network's profile. Boite
 * asks for private networks only: a public one (a café, a station) stays
 * closed. The platform gives the two commands (`platform/windows/firewall.ts`);
 * this module runs them, turns what Windows answered into a `FirewallStatus`,
 * tells the group which adapters it may listen on (`group/lan.ts`), and
 * registers the owner's two methods. Elsewhere the status is `unsupported`.
 */

import type { FirewallStatus, NetworkCategory } from '@boite/contracts';
import type { Core } from './core.ts';
import { processPlatform } from './platform/index.ts';
import { runCommand } from './run-command.ts';
import { FIREWALL_PROMPT_REFUSED } from './platform/types.ts';

const QUERY_TIMEOUT_MS = 15_000;
/** The administrator prompt waits for a person. */
const ALLOW_TIMEOUT_MS = 5 * 60_000;

/** What the query command prints. */
export interface FirewallReading {
  /** Inbound rules naming the core's executable: action 0 blocks, 1 allows; profiles as a bit mask. */
  rules: { action: number; profiles: number }[];
  networks: { adapter: string; category: string }[];
  /** Profiles where the firewall is off. */
  off: number;
}

const BITS: Record<NetworkCategory, number> = { domain: 1, private: 2, public: 4 };
const ORDER: NetworkCategory[] = ['public', 'private', 'domain'];

function category(name: string): NetworkCategory | null {
  const lower = name.toLowerCase();
  if (lower === 'public') return 'public';
  if (lower === 'private') return 'private';
  if (lower.startsWith('domain')) return 'domain';
  return null;
}

const isTailscale = (adapter: string) => /^tailscale/i.test(adapter);

/** Whether the private profile lets the core in: firewall off there, or an allow and no block. A block wins, as it does in Windows. */
function privateOpen(reading: FirewallReading): 'open' | 'blocked' | 'unset' {
  const covers = (action: number) => reading.rules.some((rule) => rule.action === action && (rule.profiles & BITS.private) !== 0);
  if ((reading.off & BITS.private) !== 0) return 'open';
  return covers(0) ? 'blocked' : covers(1) ? 'open' : 'unset';
}

/**
 * The status a reading means. Only private networks count: Boite never asks
 * for a public one or a work domain, so a machine on those alone is `public`,
 * nothing a prompt would fix. Tailscale's adapter is left out: Tailscale
 * allows inbound connections on it with a rule of its own.
 */
export function judge(reading: FirewallReading): FirewallStatus {
  const networks = ORDER.filter((name) => reading.networks.some((network) => !isTailscale(network.adapter) && category(network.category) === name));
  if (!networks.includes('private')) return { state: networks.length > 0 ? 'public' : 'ready', networks, allowed: [], blocked: [] };
  const open = privateOpen(reading);
  const state = open === 'open' ? 'ready' : open;
  return { state, networks, allowed: open === 'open' ? ['private'] : [], blocked: open === 'blocked' ? ['private'] : [] };
}

/** The adapters on a private network the core may listen on without Windows raising its prompt. */
export function lanAdapters(reading: FirewallReading): string[] {
  if (privateOpen(reading) !== 'open') return [];
  return reading.networks.filter((network) => !isTailscale(network.adapter) && category(network.category) === 'private').map((network) => network.adapter);
}

/** A reading from the query command's output, or null when it is not one. */
export function parseReading(output: string): FirewallReading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(output.trim());
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as { rules?: unknown; networks?: unknown; off?: unknown };
  // ConvertTo-Json writes a one-element array as the element itself.
  const list = (item: unknown): unknown[] => (Array.isArray(item) ? item : item === undefined || item === null ? [] : [item]);
  const rules = list(value.rules).flatMap((rule) => {
    const { action, profiles } = (rule ?? {}) as { action?: unknown; profiles?: unknown };
    return typeof action === 'number' && typeof profiles === 'number' ? [{ action, profiles }] : [];
  });
  const networks = list(value.networks).flatMap((network) => {
    const { adapter, category: name } = (network ?? {}) as { adapter?: unknown; category?: unknown };
    return typeof adapter === 'string' && typeof name === 'string' ? [{ adapter, category: name }] : [];
  });
  // Any other object would read as no rule on no network, which is `ready`: what the script did not say is not known.
  if (!('rules' in value) || !('networks' in value) || typeof value.off !== 'number') return null;
  return { rules, networks, off: value.off };
}

const UNSUPPORTED: FirewallStatus = { state: 'unsupported', networks: [], allowed: [], blocked: [] };

export interface FirewallOptions {
  /** The executable the rules name. Defaults to this process's own. */
  program?: string;
  commands?: { query(program: string): string[]; allow(program: string): string[] } | null;
}

export class FirewallAccess {
  readonly #watchers: ((adapters: string[] | null) => void)[] = [];

  constructor(private readonly core: Core, private readonly options: FirewallOptions = {}) {}

  /** False where there is no firewall to ask: every status is `unsupported`. */
  supported(): boolean {
    return this.commands() !== null;
  }

  /** `watch` hears the private adapters the core may listen on after each reading, null when Windows could not be read. */
  watch(watch: (adapters: string[] | null) => void): void {
    this.#watchers.push(watch);
  }

  private commands() {
    return this.options.commands === undefined ? processPlatform.firewall ?? null : this.options.commands;
  }

  private program(): string {
    return this.options.program ?? process.execPath;
  }

  async status(): Promise<FirewallStatus> {
    const commands = this.commands();
    if (commands === null) return UNSUPPORTED;
    const run = await this.run(commands.query(this.program()), QUERY_TIMEOUT_MS);
    const reading = !run.timedOut && run.code === 0 ? parseReading(run.stdout) : null;
    // An unreadable answer closes the LAN listeners until one is read: the network may have turned public.
    for (const watch of this.#watchers) watch(reading === null ? null : lanAdapters(reading));
    if (run.timedOut) return { ...UNSUPPORTED, state: 'error', detail: 'timeout' };
    if (reading === null) return { ...UNSUPPORTED, state: 'error', detail: 'unknown' };
    return judge(reading);
  }

  /**
   * Allow the core on private networks, unless it already is; Windows asks an
   * administrator first. A state that could not be read asks nothing: the
   * prompt would be for a need nobody knows, on a result nobody could check.
   * A public network is not asked for either.
   */
  async allow(): Promise<FirewallStatus> {
    const before = await this.status();
    if (before.state !== 'unset' && before.state !== 'blocked') return before;
    const commands = this.commands()!;
    const run = await this.run(commands.allow(this.program()), ALLOW_TIMEOUT_MS);
    const after = await this.status();
    if (after.state === 'ready') {
      this.core.log('info', 'Windows Defender Firewall now allows Boite on private networks');
      return after;
    }
    // The rule may be in place; what failed is reading it back, and that reason is the one to show.
    if (after.state === 'error') return after;
    const detail = run.timedOut ? 'timeout' : run.code === FIREWALL_PROMPT_REFUSED ? 'cancelled' : 'unknown';
    if (detail === 'unknown') this.core.log('warn', `allowing Boite in Windows Defender Firewall failed with exit code ${run.code}`);
    return { ...after, detail };
  }

  private async run(command: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; timedOut: boolean }> {
    const [cmd, ...args] = command;
    const run = await runCommand(this.core.procs, 'system:firewall', cmd!, args, timeoutMs);
    return { code: run.code, stdout: new TextDecoder().decode(run.stdout), timedOut: run.timedOut };
  }
}

/**
 * Owner only: absent from `DEVICE_METHODS`, so a paired phone is refused them.
 * Allowing changes what the machine accepts from its networks. Both read
 * through the group's own access, so what they learn opens or closes its LAN
 * listeners at once.
 */
export function registerFirewallMethods(core: Core, access?: FirewallAccess): void {
  const current = () => access ?? core.group.lan.firewall;
  core.router.register('firewall.status', () => current().status());
  core.router.register('firewall.allow', () => current().allow());
}
