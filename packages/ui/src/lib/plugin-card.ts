import type { PluginState } from '@boite/contracts';
import { strings } from './strings';

/** What the Plugins page's filter keeps. */
export type PluginFilter = 'all' | 'enabled' | 'disabled';

/** One small chip on a card: what the plugin touches. */
export interface PluginChip {
  id: string;
  label: string;
  /** Said on hover: a permission's name as the manifest writes it. */
  title?: string;
  tone?: 'accent';
  testid?: string;
}

/** Anything with files on disk, and every plugin added from a URL whatever its state. */
export function hasFiles(plugin: PluginState): boolean {
  return plugin.origin === 'url' || plugin.version !== null;
}

/** On unless the core says the owner turned it off; a core older than `plugins.setEnabled` sends nothing. */
export function isOn(plugin: PluginState): boolean {
  return plugin.enabled !== false;
}

/**
 * Who publishes the plugin, read from where it comes from: a GitHub, GitLab
 * or Codeberg repository's owner, any other host's name. Null for a folder.
 */
export function pluginAuthor(plugin: PluginState): string | null {
  const address = plugin.source?.url ?? plugin.homepage;
  if (!address) return null;
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '');
  const owner = url.pathname.split('/').filter(Boolean)[0];
  return owner && /^(github\.com|gitlab\.com|codeberg\.org)$/.test(host) ? owner : host;
}

/** The chips a card draws, most telling first. */
export function pluginChips(plugin: PluginState): PluginChip[] {
  const t = strings.plugins;
  const chips: PluginChip[] = [];
  if (plugin.origin === 'recommended' && plugin.version === null) chips.push({ id: 'recommended', label: t.chipRecommended, tone: 'accent' });
  if (plugin.origin === 'dev') chips.push({ id: 'dev', label: t.dev, tone: 'accent', testid: 'plugin-dev' });
  for (const permission of plugin.permissions ?? []) chips.push({ id: `permission-${permission}`, label: t.permission[permission], title: permission, testid: 'plugin-permission' });
  if (plugin.pools.length > 0) chips.push({ id: 'accounts', label: t.chipAccounts });
  if (plugin.app) chips.push({ id: 'app', label: plugin.app.kind === 'service' ? t.service : t.app });
  if (plugin.gateway) chips.push({ id: 'gateway', label: t.gateway });
  // A program that answers agent commands only: the app, gateway and pool chips already say it runs one.
  if (plugin.commands.length > 0 && !plugin.app && !plugin.gateway && plugin.pools.length === 0) chips.push({ id: 'program', label: t.chipProgram });
  // A schema 2 plugin with nothing to run: skills, a prompt, slash commands.
  if (plugin.commands.length === 0 && plugin.permissions !== undefined && plugin.adds && plugin.status === 'installed') chips.push({ id: 'text', label: t.chipText });
  return chips;
}

/** Whether a card passes the page's search and filter. */
export function pluginMatches(plugin: PluginState, query: string, filter: PluginFilter): boolean {
  // On is what runs or will: a refused install is neither on nor off, and shows under All only.
  if (filter === 'enabled' && !(hasFiles(plugin) && isOn(plugin) && plugin.status !== 'rejected')) return false;
  if (filter === 'disabled' && !(hasFiles(plugin) && !isOn(plugin) && plugin.status !== 'rejected')) return false;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [plugin.name, plugin.id, plugin.description, pluginAuthor(plugin) ?? ''].join(' ').toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}
