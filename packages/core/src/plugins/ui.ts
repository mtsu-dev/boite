/*
 * A plugin's interface (`provides.ui`): the script and stylesheet Boite's
 * window loads. They are files of the plugin's repository, read at the commit
 * the owner previewed, the same commit its manifest came from, and written
 * beside `installed.json` under their SHA-256, which the record names. A dev
 * plugin's are read from its folder on every request, so an edit applies at
 * the next load. docs/plugins.md, Interface.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLUGIN_MANIFEST_FILE, PLUGIN_UI_LIMITS } from '@boite/contracts';
import type { PluginManifest, PluginPermission, PluginRejected, PluginSource, PluginUiBundle, RpcEvents } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf, refused } from '../errors.ts';
import { ManifestRefused, refusal } from './manifest.ts';
import type { InstalledUi } from './record.ts';
import { fetchManifest, type FetchedFile } from './source.ts';

/** The files' text, by the key `provides.ui` names them under. */
export interface UiTexts {
  script?: string;
  style?: string;
}

const UI_DIR = 'ui';
const EXTENSION = { script: '.js', style: '.css' } as const;
const KEYS = ['script', 'style'] as const;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The texts `provides.ui` names, out of what the fetch read at the commit.
 * A missing file or one past its cap is refused like a manifest field, so the
 * preview says which and an install never starts.
 */
export function uiFromFetched(manifest: PluginManifest, files: Record<string, FetchedFile>): UiTexts | null {
  const ui = manifest.provides.ui;
  if (ui === undefined) return null;
  const texts: UiTexts = {};
  for (const key of KEYS) {
    const path = ui[key];
    if (path === undefined) continue;
    const found = files[path];
    const expected = `a file of the repository at this commit, at most ${PLUGIN_UI_LIMITS[key]} bytes`;
    if (found === undefined || found.text === null) {
      throw refusal(PLUGIN_MANIFEST_FILE, `provides.ui.${key}`, expected, found === undefined || found.bytes < 0 ? `no file at ${path}` : `${found.bytes} bytes at ${path}`);
    }
    texts[key] = found.text;
  }
  return texts;
}

/**
 * Writes the texts as `ui/<sha256>.<ext>` and answers their digests, which
 * the record then names. A name is its content, so writing one never clobbers
 * what the previous record still names: an update that fails keeps the
 * interface that worked, and `pruneUi` drops the rest once the record commits.
 */
export async function writeUi(dir: string, texts: UiTexts): Promise<InstalledUi> {
  const folder = join(dir, UI_DIR);
  mkdirSync(folder, { recursive: true });
  const out: InstalledUi = {};
  for (const key of KEYS) {
    const text = texts[key];
    if (text === undefined) continue;
    const digest = sha256(text);
    const target = join(folder, `${digest}${EXTENSION[key]}`);
    // The same name holds the same bytes, unless something altered them since: those are written again.
    if (!existsSync(target) || sha256(readFileSync(target, 'utf8')) !== digest) {
      const staged = `${target}.part`;
      await writeFile(staged, text, { mode: 0o600 });
      await rename(staged, target);
    }
    out[key] = digest;
  }
  return out;
}

/** Deletes the interface files the record no longer names: an older version's, a failed update's. */
export async function pruneUi(dir: string, keep: InstalledUi | null): Promise<void> {
  const folder = join(dir, UI_DIR);
  if (!existsSync(folder)) return;
  const kept = new Set(KEYS.flatMap((key) => (keep?.[key] === undefined ? [] : [`${keep[key]}${EXTENSION[key]}`])));
  for (const name of readdirSync(folder)) {
    if (!kept.has(name)) await rm(join(folder, name), { force: true }).catch(() => undefined);
  }
  if (kept.size === 0) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
}

/** The texts an install wrote, each checked against the digest its record names. Null when one is gone or altered. */
export function readInstalledUi(dir: string, ui: InstalledUi): UiTexts | null {
  const texts: UiTexts = {};
  for (const key of KEYS) {
    const digest = ui[key];
    if (digest === undefined) continue;
    let text: string;
    try { text = readFileSync(join(dir, UI_DIR, `${digest}${EXTENSION[key]}`), 'utf8'); } catch { return null; }
    if (sha256(text) !== digest) return null;
    texts[key] = text;
  }
  return texts;
}

/** A dev plugin's files, read from its folder now. Throws a sentence naming the file that is missing or too large. */
export function readDevUi(devPath: string, manifest: PluginManifest): UiTexts {
  const ui = manifest.provides.ui ?? {};
  const texts: UiTexts = {};
  for (const key of KEYS) {
    const path = ui[key];
    if (path === undefined) continue;
    const file = join(devPath, path);
    let size: number;
    try { size = statSync(file).size; } catch (error) { throw new Error(`${file} is missing (${messageOf(error)}): provides.ui.${key} names it.`); }
    if (size > PLUGIN_UI_LIMITS[key]) throw new Error(`${file} is ${size} bytes, past the ${PLUGIN_UI_LIMITS[key]} provides.ui.${key} may take.`);
    texts[key] = readFileSync(file, 'utf8');
  }
  return texts;
}

/** What `plugins.ui` hands a client for one plugin. */
export function uiBundle(manifest: PluginManifest, permissions: PluginPermission[], texts: UiTexts | null, error: string | null, settings: PluginUiBundle['settings']): PluginUiBundle {
  const script = texts?.script ?? null;
  const style = texts?.style ?? null;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    digest: sha256([manifest.version, permissions.join(','), error ?? '', script === null ? '' : sha256(script), style === null ? '' : sha256(style)].join('\n')),
    script,
    style,
    permissions,
    settings,
    error,
  };
}

/** One digest for the whole set: what `plugins.uiUpdated` carries. */
export function uiSetDigest(bundles: PluginUiBundle[]): string {
  return sha256(bundles.map((bundle) => `${bundle.id}:${bundle.digest}:${JSON.stringify(bundle.settings)}`).join('\n'));
}

/** `uiFromFetched` for `plugins.inspect`: a refused file is the preview's refusal, not an error. */
export function previewUi(manifest: PluginManifest, files: Record<string, FetchedFile>): { ui: UiTexts | null; rejected: PluginRejected | null } {
  try {
    return { ui: uiFromFetched(manifest, files), rejected: null };
  } catch (error) {
    if (error instanceof ManifestRefused) return { ui: null, rejected: error.rejected };
    throw error;
  }
}

/** `boite plugin dev` refuses a folder whose interface files are missing or too large. */
export function checkDevUi(path: string, manifest: PluginManifest): void {
  if (manifest.provides.ui === undefined) return;
  try { readDevUi(path, manifest); } catch (error) { throw refused(`${messageOf(error)} Write it first.`); }
}

/**
 * Writes the files under their digest, then `commit`s the record that names
 * them. The new files sit beside the old ones until it commits; then the old
 * ones go, or on failure the new ones do.
 */
export async function commitWithUi(dir: string, ui: UiTexts | null, previous: InstalledUi | null, commit: (written: InstalledUi | null) => Promise<void>): Promise<void> {
  const written = ui === null ? null : await writeUi(dir, ui);
  try {
    await commit(written);
  } catch (error) {
    await pruneUi(dir, previous);
    throw error;
  }
  await pruneUi(dir, written);
}

/**
 * The `provides.ui` files of `manifest`: those the preview read, or for a
 * reinstall from the record, read again at the commit it recorded. A
 * recommended entry carries no files, so it cannot bring an interface.
 */
export async function uiAtCommit(core: Core, id: string, manifest: PluginManifest, source: PluginSource | null, given: UiTexts | null, options: { allowLocal: boolean; signal: AbortSignal }): Promise<UiTexts | null> {
  if (manifest.provides.ui === undefined) return null;
  if (given !== null) return given;
  if (source === null) throw new Error(`${id} ${manifest.version} provides an interface, which only a plugin added from its repository or run with boite plugin dev can bring.`);
  const fetched = await fetchManifest(core, source.url, source.commit, options);
  if (fetched.commit !== source.commit) throw new Error(`${source.url} answered ${fetched.commit} for ${source.commit}.`);
  return uiFromFetched(manifest, fetched.files);
}

/** What the store reads of a plugin on disk, as `PluginInterfaces` needs it. */
export interface UiOnDisk {
  kind: string;
  installed?: {
    manifest: PluginManifest;
    /** The folder of a plugin run with `boite plugin dev`, or null. */
    devPath: string | null;
    /** The digests installed.json names, or null. */
    ui: InstalledUi | null;
  };
}

/** What the owner chose for a plugin: left on, the permissions granted of those its manifest asks for, its settings' values. */
export interface InterfaceOwner {
  enabled(id: string): boolean;
  granted(id: string, manifest: PluginManifest): PluginPermission[];
  settings(id: string, manifest: PluginManifest): PluginUiBundle['settings'];
}

/**
 * The interfaces clients load, and `plugins.uiUpdated` when that set moves.
 * It watches the store's own `plugins.updated` (and any later `plugin*`
 * event, settings included) rather than being called from each path that
 * installs, updates, removes or regrants a plugin.
 */
export class PluginInterfaces {
  readonly #ids: () => string[];
  readonly #onDisk: (id: string) => UiOnDisk;
  readonly #directory: (id: string) => string;
  readonly #owner: InterfaceOwner;
  /** The digest last announced. Only an announcement sets it, so one client reading first never silences the others. */
  #digest: string | null = null;

  constructor(core: Core, store: { ids: () => string[]; onDisk: (id: string) => UiOnDisk; directory: (id: string) => string }, owner: InterfaceOwner) {
    this.#ids = store.ids;
    this.#onDisk = store.onDisk;
    this.#directory = store.directory;
    this.#owner = owner;
    core.bus.onCommitted((name, payload) => {
      if (!name.startsWith('plugin') || name === 'plugins.uiUpdated') return;
      // A download's progress changes no interface: the set is read again once the job ends.
      if (name === 'plugins.updated' && (payload as RpcEvents['plugins.updated']).status === 'installing') return;
      try {
        const digest = uiSetDigest(this.bundles());
        if (digest === this.#digest) return;
        this.#digest = digest;
        core.bus.emit('plugins.uiUpdated', { digest });
      } catch (error) {
        core.log('warn', `plugin interfaces unreadable: ${messageOf(error)}`);
      }
    });
  }

  /**
   * `plugins.ui`: the script and style of every installed plugin that is on,
   * provides an interface and holds the `ui` grant, in list order. An
   * installed plugin's files are read from its directory and checked against
   * the digests its record names; a dev plugin's from its folder, now. A file
   * that is gone comes back as the bundle's error, with no code.
   */
  bundles(): PluginUiBundle[] {
    let ids: string[];
    try { ids = this.#ids(); } catch { return []; }
    const out: PluginUiBundle[] = [];
    for (const id of ids) {
      let disk: UiOnDisk;
      try { disk = this.#onDisk(id); } catch { continue; }
      if (disk.kind !== 'installed' || disk.installed === undefined) continue;
      const { manifest, devPath, ui } = disk.installed;
      if (manifest.provides.ui === undefined || !this.#owner.enabled(id)) continue;
      const granted = this.#owner.granted(id, manifest);
      if (!granted.includes('ui')) continue;
      let texts: UiTexts | null = null;
      let error: string | null = null;
      if (devPath !== null) {
        try { texts = readDevUi(devPath, manifest); } catch (problem) { error = messageOf(problem); }
      } else {
        texts = ui === null ? null : readInstalledUi(this.#directory(id), ui);
        if (texts === null) error = `The interface files of ${id} ${manifest.version} are missing or altered. Reinstall ${id}.`;
      }
      out.push(uiBundle(manifest, granted, texts, error, this.#owner.settings(id, manifest)));
    }
    return out;
  }
}
