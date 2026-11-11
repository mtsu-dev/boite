/*
 * What the plugin store reads and checks before it trusts a file: the
 * recommended list shipped with the core, a download's sha256, an account
 * pool listing, an install's installed.json and a dev plugin's folder.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { PLUGIN_MANIFEST_FILE } from '@boite/contracts';
import type { PluginManifest, PluginPool, PluginRejected, PluginSource, PluginState } from '@boite/contracts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { ManifestRefused, authorityChange, isRecord, parseManifest, parseManifestText, refusal } from './manifest.ts';
import { parseRecommendedEntry, type UpdateSource } from './updates.ts';
import recommendedList from './recommended.json';

export const INSTALLED_FILE = 'installed.json';

let recommendedEntries: ReturnType<typeof parseRecommendedEntry>[] | undefined;
/** The recommended entries, parsed on the first plugins call rather than at every start. A bad entry fails the core's own tests. */
function parsedRecommended(): ReturnType<typeof parseRecommendedEntry>[] {
  return recommendedEntries ??= (recommendedList as unknown[]).map((raw, index) => parseRecommendedEntry(raw, `recommended.json[${index}]`));
}
/** The recommended plugins. */
export function recommendedPlugins(): PluginManifest[] { return parsedRecommended().map((entry) => entry.manifest); }
/** Where an entry's newer releases are published, by id, for the entries that name one. */
export function recommendedUpdates(): Record<string, UpdateSource> {
  return Object.fromEntries(parsedRecommended().flatMap((entry) => (entry.updates === null ? [] : [[entry.manifest.id, entry.updates]])));
}

export function verifyPluginDownload(bytes: Uint8Array, digest: string, name = 'plugin'): void {
  if (createHash('sha256').update(bytes).digest('hex') !== digest) {
    throw new Error(`${name} download sha256 does not match the one its manifest publishes.`);
  }
}

/** One `list -<pool> -Json` answer, the account pool contract docs/plugins.md describes. */
export function parsePluginPool(provider: string, text: string, name = 'plugin'): PluginPool {
  let raw: { accounts?: unknown };
  try { raw = JSON.parse(text) as { accounts?: unknown }; }
  catch { throw new Error(`${name} ${provider} returned invalid JSON.`); }
  if (!raw || typeof raw !== 'object') throw new Error(`${name} ${provider} JSON must be an object.`);
  if (!Array.isArray(raw.accounts)) throw new Error(`${name} ${provider} JSON must contain an accounts array.`);
  return { provider, accounts: raw.accounts.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error(`${name} ${provider} account must be an object.`);
    const row = value as Record<string, unknown>;
    if (typeof row['email'] !== 'string' || !row['email']) throw new Error(`${name} ${provider} account.email must be a nonempty string.`);
    return { email: row['email'], active: row['live'] === true,
      checkedSecondsAgo: typeof row['checkedSecondsAgo'] === 'number' ? row['checkedSecondsAgo'] : null,
      windows: [['fiveHour', '5 hours'], ['sevenDay', 'Weekly']].flatMap(([key, label]) => {
        const percent = row[key!];
        // The list JSON reports percentages but no per-window reset time.
        return typeof percent === 'number' && Number.isFinite(percent) ? [{ id: key!, label: label!, usedPercent: Math.max(0, Math.min(100, percent)), resetsAt: null }] : [];
      }),
    };
  }) };
}

export type Origin = PluginState['origin'];

export interface Installed {
  version: string;
  origin: Origin;
  source: PluginSource | null;
  manifest: PluginManifest;
  /** Null for a plugin that runs nothing. */
  binary: string | null;
  /** The folder a dev plugin runs from, or null. */
  devPath: string | null;
}

/** An installed plugin as the guide, the composer and the command runner read it. */
export interface InstalledPlugin {
  id: string;
  manifest: PluginManifest;
  /** Its directory under the data dir: where its skills are written. */
  dir: string;
}

/** What a plugin's directory holds, as the store reads it. */
export type OnDisk =
  | { kind: 'none' }
  | { kind: 'installed'; installed: Installed }
  | { kind: 'error'; message: string }
  | { kind: 'rejected'; rejected: PluginRejected };

/** A download or text install under way. */
export interface Job {
  controller: AbortController;
  progress: number;
  promise: Promise<void>;
  /** The install finished, or stopped the desktop app to replace its binary: start the app again after. */
  relaunch: boolean;
}

/** installed.json as `plugins.add` and `plugins.install` write it. */
export function readRecord(data: Record<string, unknown>, file: string, id: string, dir: string): Omit<Installed, 'binary'> {
  const keys = ['schema', 'origin', 'source', 'installedAt', 'manifest', 'devPath'];
  for (const key of Object.keys(data)) if (!keys.includes(key)) throw refusal(file, key, `one of ${keys.join(', ')}`, key);
  if (data['schema'] !== 1) throw refusal(file, 'schema', '1', data['schema']);
  const origin = data['origin'];
  if (origin !== 'recommended' && origin !== 'url' && origin !== 'dev') throw refusal(file, 'origin', 'recommended, url or dev', origin);
  let devPath: string | null = null;
  if (origin === 'dev') {
    const raw = data['devPath'];
    if (typeof raw !== 'string' || !isAbsolute(raw)) throw refusal(file, 'devPath', 'the absolute path of the plugin folder', raw);
    devPath = raw;
  } else if (data['devPath'] !== undefined) {
    throw refusal(file, 'devPath', 'absent unless origin is dev', data['devPath']);
  }
  if (typeof data['installedAt'] !== 'number') throw refusal(file, 'installedAt', 'a timestamp in milliseconds', data['installedAt']);
  const manifest = parseManifest(data['manifest'], file, 'manifest.', origin === 'dev');
  if (manifest.id !== id) throw refusal(file, 'manifest.id', `${id}, the name of ${dir}`, manifest.id);
  let source: PluginSource | null = null;
  if (origin === 'url') {
    const raw = data['source'];
    if (!isRecord(raw)) throw refusal(file, 'source', 'an object with url, ref and commit', raw);
    if (typeof raw['url'] !== 'string' || raw['url'].length === 0) throw refusal(file, 'source.url', 'the repository URL', raw['url']);
    if (typeof raw['ref'] !== 'string' || raw['ref'].length === 0) throw refusal(file, 'source.ref', 'a branch, tag or commit', raw['ref']);
    if (typeof raw['commit'] !== 'string' || !/^[0-9a-f]{40,64}$/.test(raw['commit'])) throw refusal(file, 'source.commit', 'a full commit hash', raw['commit']);
    source = { url: raw['url'], ref: raw['ref'], commit: raw['commit'] };
  } else if (data['source'] !== null) {
    throw refusal(file, 'source', 'null for a recommended or dev plugin', data['source']);
  }
  return { version: manifest.version, origin, source, manifest, devPath };
}

/** Windows holds an executable a moment after its process exits. */
export async function removeTree(path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 20) throw refused(`could not remove ${path}: ${messageOf(error)}`);
      await new Promise((done) => setTimeout(done, 50));
    }
  }
}

/** `plugins.dev`'s folder: its absolute path and the manifest it holds, refused with what is wrong. */
export function readDevFolder(path: unknown): { path: string; file: string; manifest: PluginManifest } {
  const expected = `an absolute path to a folder holding ${PLUGIN_MANIFEST_FILE}`;
  if (typeof path !== 'string' || !isAbsolute(path) || !statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw invalidParams(`plugin dev path must be ${expected}, got ${JSON.stringify(path)}`, { field: 'path', expected });
  }
  const file = join(path, PLUGIN_MANIFEST_FILE);
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch {
    throw invalidParams(`${file} is missing; plugin dev path must be ${expected}`, { field: 'path', expected });
  }
  try { return { path, file, manifest: parseManifestText(text, file, true) }; } catch (error) {
    if (error instanceof ManifestRefused) throw refused(error.rejected.message, error.rejected);
    throw error;
  }
}

/**
 * A dev plugin's manifest, read from its folder on every use. Its code and
 * text follow the folder; its access stays `approved`, what the owner's last
 * plugins.dev loaded, and a folder that changes it answers `changed` instead,
 * so whoever can write the folder cannot widen the plugin's token.
 */
export function devManifest(id: string, devPath: string, approved: PluginManifest): { manifest: PluginManifest; version: string } | { changed: string } {
  const file = join(devPath, PLUGIN_MANIFEST_FILE);
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch (error) {
    throw refusal(file, '(file)', `a readable ${PLUGIN_MANIFEST_FILE} in ${devPath}`, messageOf(error));
  }
  const manifest = parseManifestText(text, file, true);
  if (manifest.id !== id) throw refusal(file, 'id', `${id}, the id it was added under; remove it and run boite plugin dev again to change it`, manifest.id);
  const changed = authorityChange(approved, manifest);
  if (changed !== null) return { changed: `${file} changed ${changed} since boite plugin dev loaded it. Run boite plugin dev ${devPath} again to load it.` };
  return { manifest, version: manifest.version };
}
