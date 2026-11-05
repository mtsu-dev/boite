/*
 * The account pools a plugin manages (docs/plugins.md, "Account pools"): the
 * listing `plugins.accounts` reads, cached a minute, and the login changes of
 * `plugins.accountAction`. While a change runs, `blocks` holds the scheduler
 * and the thread views off that provider's default account.
 */

import { threadActive } from '@boite/contracts';
import type { PluginPool, RpcParams } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, refused } from '../errors.ts';
import type { PluginLanes } from './lanes.ts';
import { POOL_COMMANDS, poolsOf } from './manifest.ts';
import type { Installed } from './record.ts';
import { parsePluginPool } from './record.ts';

export interface AccountHost {
  core: Core;
  lanes: PluginLanes;
  /** The id when it names a known plugin; refuses it otherwise. */
  known(id: unknown): string;
  /** The installed plugin, refused while it is missing, rejected or rewritten. */
  usable(id: string): Installed;
  /** Runs one pool command of the plugin's executable and answers with its stdout. */
  run(id: string, installed: Installed, args: string[]): Promise<string>;
  closing(): boolean;
}

export class PluginAccounts {
  #host: AccountHost;
  #listings = new Map<string, Promise<PluginPool[]>>();
  #cache = new Map<string, { pools: PluginPool[]; at: number }>();
  #action: { id: string; provider: string } | null = null;

  constructor(host: AccountHost) {
    this.#host = host;
  }

  /** The cached listing of `id` is stale: an install, an update or a reload replaced it. */
  forget(id: string): void {
    this.#cache.delete(id);
  }

  async list(id: string, refresh = false): Promise<PluginPool[]> {
    this.#host.known(id);
    const installed = this.#host.usable(id);
    const listing = this.#listings.get(id);
    if (listing !== undefined) return listing;
    const cached = this.#cache.get(id);
    if (cached !== undefined && Date.now() - cached.at < (refresh ? 10_000 : 60_000)) return cached.pools;
    const promise = this.#host.lanes.shared(id, async () => {
      const pools: PluginPool[] = [];
      for (const provider of poolsOf(installed.manifest)) {
        pools.push(parsePluginPool(provider, await this.#host.run(id, installed, [...POOL_COMMANDS.list(provider, refresh)]), installed.manifest.executable ?? id));
      }
      this.#cache.set(id, { pools, at: Date.now() });
      return pools;
    });
    this.#listings.set(id, promise);
    try { return await promise; } finally { this.#listings.delete(id); }
  }

  blocks(accountId: string): boolean {
    if (this.#action === null) return false;
    const account = this.#host.core.journal.getAccount(accountId);
    return account?.providerId === this.#action.provider && account.isolationDir === null;
  }

  async action(params: RpcParams<'plugins.accountAction'>): Promise<PluginPool[]> {
    const id = this.#host.known(params.id);
    const installed = this.#host.usable(id);
    const pools = poolsOf(installed.manifest);
    if (!pools.includes(params.provider)) throw invalidParams(`plugin provider must be one of ${pools.join(', ')}`, { field: 'provider' });
    if (!['add', 'switch', 'remove'].includes(params.action)) throw invalidParams('plugin action must be add, switch or remove', { field: 'action' });
    if (params.action !== 'add' && (typeof params.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(params.email))) throw invalidParams('plugin email must be an email address', { field: 'email' });
    // One login change at a time across plugins: `blocks` holds the scheduler for one provider.
    if (this.#action !== null || this.#listings.has(id)) throw refused('Wait for the current plugin operation to finish.');
    return this.#host.lanes.shared(id, () => this.#changeLogin(id, installed, params));
  }

  async #changeLogin(id: string, installed: Installed, params: RpcParams<'plugins.accountAction'>): Promise<PluginPool[]> {
    const core = this.#host.core;
    this.#action = { id, provider: params.provider };
    try {
      const affected = core.journal.listThreads().filter((thread) => this.blocks(thread.accountId));
      if (core.scheduler.activeAccountIds().some((accountId) => this.blocks(accountId))) throw refused('Stop this provider\'s default-account turns before changing its saved login.');
      if (affected.some((thread) => threadActive(thread.status))) throw refused('Stop this provider\'s default-account turns before changing its saved login.');
      for (const thread of affected) core.threads.releaseAgent(thread.id);
      const args = params.action === 'add' ? POOL_COMMANDS.add(params.provider)
        : params.action === 'switch' ? POOL_COMMANDS.switch(params.provider, params.email!)
        : POOL_COMMANDS.remove(params.provider, params.email!);
      await this.#host.run(id, installed, [...args]);
      if (this.#host.closing()) throw refused('Boite is shutting down.');
      this.#cache.delete(id);
      // The saved login changed hands: its last quota reading is someone else's now.
      core.quotas.forget((accountId) => this.blocks(accountId));
      core.quotas.invalidate();
      // Announced whatever the status reads: a switch between two signed-in
      // logins leaves it at 'ok', yet the model lists belong to the old login.
      for (const account of core.accounts.list()) if (this.blocks(account.id)) core.accounts.check(account.id, true);
      return await this.list(id);
    } finally {
      this.#action = null;
      if (!this.#host.closing()) core.scheduler.onSettingsChanged();
    }
  }

  /** The listings still running, for shutdown to wait on. */
  pending(): Promise<unknown>[] {
    return [...this.#listings.values()];
  }
}
