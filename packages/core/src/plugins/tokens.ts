/*
 * The token a schema 2 plugin's processes reach the core with. It opens the
 * methods and events of the permissions its manifest declares and nothing
 * else (`pluginMayCall` in contracts/access.ts), so a plugin never holds the
 * owner token. One token per plugin per core run, kept in memory only: a new
 * core start mints new ones, an install or reload that changes the
 * permissions revokes it, an uninstall too. A revoked token's open sockets
 * close with it.
 */

import type { PluginPermission } from '@boite/contracts';
import { newToken } from '../ids.ts';

export interface PluginGrant {
  pluginId: string;
  permissions: readonly PluginPermission[];
}

export class PluginTokens {
  #byToken = new Map<string, PluginGrant>();
  #byPlugin = new Map<string, string>();
  #revoked: (pluginId: string) => void;

  /** `revoked` closes the sockets a revoked token opened. */
  constructor(revoked: (pluginId: string) => void = () => undefined) {
    this.#revoked = revoked;
  }

  /** The plugin's token, minted on first use or when its permissions changed since. */
  tokenFor(pluginId: string, permissions: readonly PluginPermission[]): string {
    const current = this.#byPlugin.get(pluginId);
    if (current !== undefined) {
      const grant = this.#byToken.get(current);
      if (grant !== undefined && sameSet(grant.permissions, permissions)) return current;
      this.revoke(pluginId);
    }
    const token = `plg_${newToken()}`;
    this.#byToken.set(token, { pluginId, permissions: [...permissions] });
    this.#byPlugin.set(pluginId, token);
    return token;
  }

  /** What a presented token opens, or null. */
  authenticate(token: string): PluginGrant | null {
    return this.#byToken.get(token) ?? null;
  }

  /** After an install or a reload: the grant goes unless the plugin still declares exactly its permissions. */
  keepIf(pluginId: string, permissions: readonly PluginPermission[] | null): void {
    const grant = this.#byToken.get(this.#byPlugin.get(pluginId) ?? '');
    if (grant !== undefined && (permissions === null || !sameSet(grant.permissions, permissions))) this.revoke(pluginId);
  }

  revoke(pluginId: string): void {
    const token = this.#byPlugin.get(pluginId);
    if (token === undefined) return;
    this.#byToken.delete(token);
    this.#byPlugin.delete(pluginId);
    this.#revoked(pluginId);
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
