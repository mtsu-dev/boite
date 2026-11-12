/*
 * What the owner granted each schema 2 plugin of the permissions its manifest
 * asks for (docs/internals/plugins.md, Permissions). Kept apart from the manifest, in
 * the journal's settings, so an update that asks for more brings nothing
 * the owner did not tick. The plugin's token reaches the granted permissions
 * the installed manifest still asks for, nothing else (`tokens.ts`).
 */

import { PLUGIN_PERMISSION_NAMES, type PluginPermission } from '@boite/contracts';
import type { Journal } from '../journal.ts';
import { invalidParams } from '../errors.ts';

const KEY = 'plugin-grants:';

export class PluginGrants {
  readonly #journal: Journal;

  constructor(journal: Journal) {
    this.#journal = journal;
  }

  /** What was stored, null for a plugin installed before grants existed, which keeps every permission its manifest asks for. */
  stored(id: string): PluginPermission[] | null {
    const value = this.#journal.getSetting(`${KEY}${id}`);
    if (!Array.isArray(value)) return null;
    return value.filter((name): name is PluginPermission => (PLUGIN_PERMISSION_NAMES as readonly unknown[]).includes(name));
  }

  /** What the token reaches: the granted part of what `requested` asks for. */
  effective(id: string, requested: readonly PluginPermission[]): PluginPermission[] {
    const stored = this.stored(id);
    return stored === null ? [...requested] : requested.filter((name) => stored.includes(name));
  }

  set(id: string, grants: readonly PluginPermission[]): void {
    this.#journal.setSetting(`${KEY}${id}`, [...grants]);
  }

  clear(id: string): void {
    this.#journal.deleteSetting(`${KEY}${id}`);
  }
}

/**
 * The grant an install keeps when the owner sent none: a first install
 * (`before` null) gets what it asks for, as `boite plugin` and older apps
 * always installed; an update keeps what was granted and nothing it asks for
 * anew, which the owner grants through plugins.setGrants or a consent.
 */
export function carriedGrant(stored: readonly PluginPermission[] | null, before: readonly PluginPermission[] | null, after: readonly PluginPermission[]): PluginPermission[] {
  if (before === null) return [...after];
  const kept = stored ?? before;
  return after.filter((name) => kept.includes(name));
}

/** `grants` as the owner sent them: distinct names among what the manifest asks for, else refused naming the entry. */
export function checkGrants(grants: unknown, requested: readonly PluginPermission[], id: string): PluginPermission[] {
  const expected = `an array of distinct permissions ${id} asks for: ${requested.join(', ') || 'none'}`;
  if (!Array.isArray(grants)) throw invalidParams(`grants must be ${expected}`, { field: 'grants', expected });
  grants.forEach((name: unknown, index) => {
    if (typeof name !== 'string' || !(requested as readonly string[]).includes(name) || grants.indexOf(name) !== index) {
      throw invalidParams(`grants[${index}] must be one of ${expected}; got ${JSON.stringify(name)}`, { field: `grants[${index}]`, expected });
    }
  });
  return [...grants] as PluginPermission[];
}
