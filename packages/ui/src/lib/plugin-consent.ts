import type { PluginPermission, PluginPreview, PluginState } from '@boite/contracts';
import type { ConsentRequest } from '../components/PluginConsent.svelte';

/**
 * What the consent dialog asks before `plugins.install`: a first install ticks
 * everything the version asks for; an update ticks what the owner granted
 * before plus what is new, marked New, and leaves unticked what they refused.
 */
export function consentForInstall(plugin: PluginState): ConsentRequest {
  const requested = plugin.requested ?? null;
  const before = plugin.permissions;
  const updating = plugin.version !== null && before !== undefined;
  const added = updating ? (requested ?? []).filter((name) => !before.includes(name)) : [];
  const granted = plugin.granted ?? [];
  const next = plugin.updates?.available;
  return {
    name: plugin.name,
    mode: 'install',
    source: next && plugin.updates ? { url: plugin.updates.source.url, commit: next.commit } : plugin.source ? { url: plugin.source.url, commit: plugin.source.commit } : null,
    requested,
    ticked: updating ? (requested ?? []).filter((name) => granted.includes(name) || added.includes(name)) : requested ?? [],
    added,
    runsProgram: plugin.runsProgram ?? false,
  };
}

/** Before `plugins.add`: the manifest the preview read, every permission ticked. */
export function consentForPreview(preview: PluginPreview): ConsentRequest | null {
  const manifest = preview.manifest;
  if (!manifest) return null;
  const requested = manifest.schema === 1 ? null : manifest.permissions ?? [];
  return {
    name: manifest.name,
    mode: 'install',
    source: { url: preview.source.url, commit: preview.source.commit },
    requested,
    ticked: requested ?? [],
    added: [],
    runsProgram: manifest.executable !== undefined,
  };
}

/** The editor `plugins.setGrants` saves: what the installed version asks for, ticked as granted now. */
export function consentForEdit(plugin: PluginState): ConsentRequest {
  return {
    name: plugin.name,
    mode: 'edit',
    source: null,
    requested: plugin.permissions ?? [],
    ticked: plugin.granted ?? plugin.permissions ?? [],
    added: [],
    runsProgram: plugin.runsProgram ?? false,
  };
}

/** Only a schema 2 plugin that is installed has grants to edit. */
export const grantsEditable = (plugin: PluginState) => plugin.status === 'installed' && plugin.permissions !== undefined;

/** The dialog answers names; these are the ones the plugin asked for, so they are permissions. */
export const asGrants = (names: readonly string[]) => names as PluginPermission[];
