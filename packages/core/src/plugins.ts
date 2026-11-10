/*
 * The plugin store. A plugin is one executable Boite downloads over https,
 * checks against the sha256 its manifest publishes, and runs through
 * `core.procs` for the features the manifest names: a native program, or one
 * JavaScript file the core's own Bun runs (`runtime: bun`). A plugin that only
 * adds skills, a prompt or slash commands downloads nothing.
 *
 * `boite plugin dev <folder>` (`plugins.dev`) installs a plugin from a folder
 * on this machine instead: its record names the folder, and the manifest and
 * executable are read from there on every use, so edits apply at once. The recommended ones ship
 * in plugins/recommended.json; the owner adds others from a git URL, with
 * `plugins.inspect` showing the manifest before `plugins.add` installs it.
 *
 * An installed plugin is `<dataDir>/plugins/<id>/`: the executable and
 * `installed.json`, which records the manifest it came from, the commit a URL
 * resolved to and when. That directory is all an install writes, so uninstall
 * deletes it and nothing else. docs/plugins.md is the authoring guide.
 *
 * A recommended entry may name an update source; plugins/updates.ts reads it
 * and the newest of the pinned entry, the release found there and the install
 * is what Install and Update bring.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PLUGIN_MANIFEST_FILE, sameRepository } from '@boite/contracts';
import type { PluginArtifact, PluginCommandResult, PluginManifest, PluginPermission, PluginPool, PluginPreview, PluginRejected, PluginSource, PluginState, RpcParams } from '@boite/contracts';
import type { Identity } from './sessions.ts';
import type { Core } from './core.ts';
import { invalidParams, messageOf, refused } from './errors.ts';
import {
  ManifestRefused,
  addsOf,
  artifactFor,
  commandsOf,
  executableFile,
  isPluginId,
  isRecord,
  parseManifest,
  parseManifestText,
  permissionsOf,
  platformKey,
  poolsOf,
  providesApp,
  providesGateway,
  providesService,
  refusal,
  runsExecutable,
} from './plugins/manifest.ts';
import { PluginApps, appEnv, type AppProgram } from './plugins/apps.ts';
import { PluginRuns, commandOwner, commandRequest, nameClash } from './plugins/runs.ts';
import { PluginAccounts } from './plugins/accounts.ts';
import { INSTALLED_FILE, devManifest, readDevFolder, readRecord, recommendedPlugins, recommendedUpdates, removeTree, verifyPluginDownload, type Installed, type Origin } from './plugins/record.ts';
import { PluginTokens } from './plugins/tokens.ts';
import { PREVIEW_TTL_MS, PluginPreviews } from './plugins/previews.ts';
import { PluginGrants, carriedGrant, checkGrants } from './plugins/grants.ts';
import { DOUANE_PLUGIN, PluginGateways } from './plugins/gateway.ts';
import { prepareLocalProxyKey } from './subscription-proxy-auth.ts';
import { recoverActivation, switchRelease, type Activation } from './plugins/activation.ts';
import { PluginLanes } from './plugins/lanes.ts';
import { fetchManifest, readSource } from './plugins/source.ts';
import { PluginUpdateChecks, compareVersions, type UpdateSource } from './plugins/updates.ts';

const DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** A download that receives nothing for this long stops; one still receiving goes on, up to the ceiling. */
const DOWNLOAD_IDLE_MS = 30_000;
const DOWNLOAD_CEILING_MS = 30 * 60_000;
/** How long an install waits on its update source before taking the newest version it already knows. */
const INSTALL_SOURCE_WAIT_MS = 15_000;

/** An installed plugin as the guide, the composer and the command runner read it. */
export interface InstalledPlugin {
  id: string;
  manifest: PluginManifest;
  /** Its directory under the data dir: where its skills are written. */
  dir: string;
}

type OnDisk =
  | { kind: 'none' }
  | { kind: 'installed'; installed: Installed }
  | { kind: 'error'; message: string }
  | { kind: 'rejected'; rejected: PluginRejected };

interface Job {
  controller: AbortController;
  progress: number;
  promise: Promise<void>;
  /** The install finished, or stopped the desktop app to replace its binary: start the app again after. */
  relaunch: boolean;
}

interface Pending {
  manifest: PluginManifest;
  source: PluginSource;
}

export { parsePluginPool, recommendedPlugins, recommendedUpdates, verifyPluginDownload } from './plugins/record.ts';

export class PluginStore {
  #core: Core;

  #recommended: PluginManifest[] | undefined;
  #updateSources: Record<string, UpdateSource> | undefined;
  /** The manifests `plugins.list` offers. Tests swap an entry to point an install at a fixture. */
  get recommended(): PluginManifest[] { return this.#recommended ??= recommendedPlugins(); }
  set recommended(value: PluginManifest[]) { this.#recommended = value; }
  /** The update source of each recommended entry that names one. Tests swap it like `recommended`. */
  get updateSources(): Record<string, UpdateSource> { return this.#updateSources ??= recommendedUpdates(); }
  set updateSources(value: Record<string, UpdateSource>) { this.#updateSources = value; }
  /** Lets `plugins.inspect` read a repository by its path on disk. Tests only; no client can set it. */
  allowLocalSources = false;
  /** Test seam: how an update source is read. The git path of `plugins.inspect` otherwise. */
  readUpdateSource = (source: UpdateSource): Promise<{ commit: string; text: string | null }> =>
    fetchManifest(this.#core, source.url, source.ref, { allowLocal: this.allowLocalSources, signal: this.#shutdown.signal });

  #jobs = new Map<string, Job>();
  #failures = new Map<string, string>();
  #pending = new Map<string, Pending>();
  /** Dev plugins being loaded: their command names are taken before they are on disk. */
  #claims = new Set<PluginManifest>();
  #previews = new PluginPreviews();
  #inspecting = new Set<Promise<unknown>>();
  #shutdown = new AbortController();
  #closing = false;
  /** Install and uninstall hold a plugin alone; its commands share it. */
  #lanes = new PluginLanes();

  /** Test seam: how long a download may receive nothing. */
  downloadIdleMs = DOWNLOAD_IDLE_MS;

  /** The desktop apps plugins provide: started, stopped and relaunched here. */
  readonly apps: PluginApps;
  /** The gateways plugins provide: run in the background on a loopback port. */
  readonly gateways: PluginGateways;
  /** Newer releases of recommended plugins, read from the update sources the list names. */
  readonly updates: PluginUpdateChecks;
  /** The tokens schema 2 plugins reach the core with, scoped to the permissions the owner granted. */
  readonly tokens = new PluginTokens((id) => this.#core.subscribers.closePlugin(id));
  readonly grants: PluginGrants;
  /** The account pools plugins manage. */
  readonly accountPools: PluginAccounts;
  #runs: PluginRuns;

  constructor(core: Core) {
    this.#core = core;
    this.grants = new PluginGrants(core.journal);
    this.#runs = new PluginRuns(core);
    this.accountPools = new PluginAccounts({
      core, lanes: this.#lanes,
      known: (id) => this.#known(id),
      usable: (id) => this.#usable(id),
      run: (id, installed, args) => this.#run(id, installed, args),
      closing: () => this.#closing,
    });
    this.updates = new PluginUpdateChecks({
      // The admin policy's `plugins.recommended: false` leaves every source unread.
      source: (id) => (core.policy.recommendedPluginsOff() || this.#recommendedManifest(id) === null ? null : this.updateSources[id] ?? null),
      ids: () => core.policy.recommendedPluginsOff() ? [] : this.recommended.map((manifest) => manifest.id).filter((id) => this.updateSources[id] !== undefined),
      pinned: (id) => this.#recommendedManifest(id),
      installed: (id) => {
        try {
          const disk = this.#onDisk(id);
          return disk.kind === 'installed' ? disk.installed.version : null;
        } catch {
          return null;
        }
      },
      read: (source) => this.readUpdateSource(source),
      changed: (id) => this.#emit(id),
      log: (level, message) => core.log(level, message),
    });
    this.apps = new PluginApps({
      procs: core.procs,
      coreUrl: () => core.baseUrl(),
      coreDataDir: core.dataDir,
      log: (level, message) => core.log(level, message),
      installed: (id) => {
        const disk = this.#onDisk(id);
        if (disk.kind !== 'installed') return null;
        const { manifest, binary } = disk.installed;
        if (binary === null || (!providesApp(manifest) && !providesService(manifest))) return null;
        return { binary, dir: this.#directory(id), service: providesService(manifest), ...this.#access(id, manifest) } satisfies AppProgram;
      },
      changed: (id) => this.#emit(id),
    });
    this.gateways = new PluginGateways({
      procs: core.procs,
      dataDir: core.dataDir,
      log: (level, message, event) => core.logs.record(level, message, { source: 'plugins', event }),
      getSetting: (key) => core.journal.getSetting(key),
      setSetting: (key, value) => core.journal.setSetting(key, value),
      installed: (id) => {
        const disk = this.#onDisk(id);
        if (disk.kind !== 'installed' || disk.installed.binary === null || !providesGateway(disk.installed.manifest)) return null;
        return { binary: disk.installed.binary, executable: disk.installed.manifest.executable! };
      },
      changed: (id) => this.#emit(id),
      moved: (id, port) => { if (id === DOUANE_PLUGIN) core.settings.followGateway(port); },
      ready: async (id, isCurrent) => {
        if (id === DOUANE_PLUGIN) { await prepareLocalProxyKey(core, isCurrent); core.quotas.gateway.reset(); }
      },
    });
  }

  #root(): string {
    return resolve(this.#core.dataDir, 'plugins');
  }

  #directory(id: string): string {
    const root = this.#root();
    const dir = resolve(root, id);
    // A cancelled install can remove its directory while state is being polled.
    for (const path of [root, dir]) if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw refused(`plugin path ${path} must not be a symbolic link`);
    return dir;
  }

  #binaryPath(dir: string, manifest: PluginManifest): string | null {
    const file = executableFile(manifest);
    return file === null ? null : join(dir, file);
  }

  /**
   * The token and data folder a plugin's processes get: a schema 1 desktop
   * app keeps the owner token it was written for; schema 2 gets its own,
   * scoped to what the owner granted, and a data folder that outlives it.
   */
  #access(id: string, manifest: PluginManifest): { token: string; dataDir: string | null } {
    if (manifest.schema === 1) return { token: this.#core.token, dataDir: null };
    const dataDir = this.dataDir(id);
    mkdirSync(dataDir, { recursive: true });
    return { token: this.tokens.tokenFor(id, this.grants.effective(id, permissionsOf(manifest))), dataDir };
  }

  /** BOITE_PLUGIN_DATA: kept across updates and uninstalls, like a gateway's sign-ins. */
  dataDir(id: string): string {
    return join(this.#core.dataDir, 'plugin-data', id);
  }

  #recommendedManifest(id: string): PluginManifest | null {
    return this.recommended.find((manifest) => manifest.id === id) ?? null;
  }

  /**
   * What installing a recommended plugin brings: the newest of the pinned
   * entry, a release its update source offers and the manifest installed.
   * The installed one only wins a tie, so a retry reinstalls it rather than
   * going back to an older pinned entry.
   */
  #recommendedTarget(id: string, installed: Installed | null): PluginManifest | null {
    const pinned = this.#recommendedManifest(id);
    if (pinned === null) return null;
    let best = installed?.origin === 'recommended' && installed.manifest.id === id ? installed.manifest : pinned;
    for (const candidate of [pinned, this.updates.offered(id)?.manifest ?? null]) {
      if (candidate !== null && compareVersions(candidate.version, best.version) > 0) best = candidate;
    }
    return best;
  }

  /** The id, when it names a recommended plugin or one this core has anything of. */
  #known(id: unknown): string {
    const expected = `a plugin id from plugins.list: ${this.recommended.map((manifest) => manifest.id).join(', ')} or one added from a URL`;
    if (isPluginId(id) && (this.#recommendedManifest(id) !== null || this.#pending.has(id) || this.#jobs.has(id) || existsSync(join(this.#root(), id)))) return id;
    throw invalidParams(`unknown plugin ${String(id)}; expected ${expected}`, { field: 'id', expected });
  }

  /**
   * What the plugin's directory holds. A manifest a power loss truncated must
   * not take the Plugins page with it: the state carries the file and what was
   * expected, and the page can still reinstall or remove.
   */
  #onDisk(id: string): OnDisk {
    const dir = this.#directory(id);
    // An activation a stopped core left half done settles first, unless it is this core's own, still running.
    if (this.#lanes.rewrite(id) === null) {
      try {
        if (recoverActivation(dir) === 'restored') this.#core.log('warn', `plugin ${id}: an update that did not finish was rolled back`);
      } catch (error) {
        return { kind: 'error', message: `${dir} holds an update that did not finish and could not be rolled back (${messageOf(error)}). Reinstall ${id}.` };
      }
    }
    const file = join(dir, INSTALLED_FILE);
    if (!existsSync(file)) return { kind: 'none' };
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      return { kind: 'error', message: `${file} is not readable JSON (${messageOf(error)}). Reinstall ${id}.` };
    }
    if (!isRecord(data)) return { kind: 'error', message: `${file} must be a JSON object. Reinstall ${id}.` };
    let record: Omit<Installed, 'binary'>;
    try {
      record = readRecord(data, file, id, dir);
      const live = record.devPath === null ? null : devManifest(id, record.devPath, record.manifest);
      if (live !== null && 'changed' in live) { this.tokens.revoke(id); return { kind: 'error', message: live.changed }; }
      if (live !== null) record = { ...record, ...live };
    } catch (error) {
      if (error instanceof ManifestRefused) return { kind: 'rejected', rejected: error.rejected };
      throw error;
    }
    const binary = this.#binaryPath(record.devPath ?? dir, record.manifest);
    if (binary !== null && !existsSync(binary)) return { kind: 'error', message: `${binary} is missing. ${record.devPath === null ? 'Reinstall' : 'Build it, then run boite plugin dev again for'} ${id}.` };
    return { kind: 'installed', installed: { ...record, binary } };
  }

  state(id: string): PluginState {
    const recommended = this.#recommendedManifest(id);
    const disk = this.#onDisk(id);
    const job = this.#jobs.get(id);
    const pending = this.#pending.get(id);
    const installed = disk.kind === 'installed' ? disk.installed : null;
    // What an install brings; the recommended list wins, then a URL add in progress.
    const target = this.#recommendedTarget(id, installed) ?? pending?.manifest ?? installed?.manifest ?? null;
    const running = installed?.manifest ?? target;
    const failure = this.#failures.get(id) ?? (disk.kind === 'error' ? disk.message : null);
    const dev = installed?.devPath ?? null;
    return {
      id,
      name: target?.name ?? id,
      origin: recommended !== null ? 'recommended' : dev !== null ? 'dev' : 'url',
      description: target?.description ?? '',
      homepage: target?.homepage ?? null,
      version: installed?.version ?? null,
      availableVersion: target?.version ?? null,
      status: job ? 'installing' : disk.kind === 'rejected' ? 'rejected' : failure !== null ? 'error' : installed ? 'installed' : 'not-installed',
      progress: job?.progress ?? 0,
      error: failure,
      source: recommended !== null ? null : installed?.source ?? pending?.source ?? null,
      artifact: target ? artifactFor(target) : null,
      platform: platformKey(),
      commands: running ? commandsOf(running) : [],
      pools: running ? poolsOf(running) : [],
      rejected: disk.kind === 'rejected' ? disk.rejected : null,
      ...(running?.schema === 1 ? {} : { permissions: running ? permissionsOf(running) : [], granted: installed ? this.grants.effective(id, permissionsOf(installed.manifest)) : [] }),
      ...(target !== null && target.schema !== 1 ? { requested: permissionsOf(target) } : {}),
      runsProgram: target !== null && runsExecutable(target),
      adds: running ? addsOf(running) : null,
      devPath: dev,
      app: running !== null && (providesApp(running) || providesService(running)) ? this.apps.state(id, this.#directory(id), providesService(running)) : null,
      gateway: running !== null && providesGateway(running) ? this.gateways.state(id, this.#directory(id)) : null,
      updates: recommended !== null ? this.updates.state(id) : null,
    };
  }

  /** The recommended plugins in their list order, then the URL ones by id. */
  list(): PluginState[] {
    return this.#ids().map((id) => this.state(id));
  }

  /** Every plugin id the store knows: recommended, being installed or with an install on disk. */
  #ids(): string[] {
    const ids = new Set<string>([...this.#pending.keys(), ...this.#jobs.keys()]);
    const root = this.#root();
    if (existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        // `.fetch-*` is a repository `plugins.inspect` is reading.
        if (!entry.isDirectory() || entry.name.startsWith('.') || !isPluginId(entry.name)) continue;
        if (existsSync(join(root, entry.name, INSTALLED_FILE))) ids.add(entry.name);
      }
    }
    for (const manifest of this.recommended) ids.delete(manifest.id);
    return [...this.recommended.map((manifest) => manifest.id), ...[...ids].sort()];
  }

  #emit(id: string): void {
    try {
      this.#core.bus.emit('plugins.updated', this.state(id));
    } catch (error) {
      this.#core.log('warn', `plugin ${id} state unreadable: ${messageOf(error)}`);
    }
  }

  /** Installs a recommended plugin, or reinstalls a URL one from the manifest it recorded. `grants`: plugins.install's. */
  install(id: string, grants?: unknown): PluginState {
    this.#core.policy.assert(this.#core.policy.pluginInstallsOff(), 'plugins.install', id);
    this.#known(id);
    if (this.#jobs.has(id)) return this.state(id);
    const recommended = this.#recommendedManifest(id);
    if (recommended !== null) {
      const target = () => {
        const disk = this.#onDisk(id);
        return this.#recommendedTarget(id, disk.kind === 'installed' ? disk.installed : null) ?? recommended;
      };
      // The pinned entry can be releases behind its source, and the periodic
      // checks read only installed plugins: the source is read first, so a
      // first install brings the latest release rather than the pinned one.
      const latest = this.updateSources[id] === undefined ? undefined : async (signal: AbortSignal) => {
        const aborted = new Promise<void>((done) => signal.addEventListener('abort', () => done(), { once: true }));
        await Promise.race([this.updates.check([id]), Bun.sleep(INSTALL_SOURCE_WAIT_MS), aborted]);
        return target();
      };
      return this.#start(id, target(), null, 'recommended', grants, latest);
    }
    const pending = this.#pending.get(id);
    if (pending !== undefined) return this.#start(id, pending.manifest, pending.source, 'url', grants);
    const disk = this.#onDisk(id);
    if (disk.kind === 'installed' && disk.installed.source !== null) return this.#start(id, disk.installed.manifest, disk.installed.source, 'url', grants);
    if (disk.kind === 'rejected') throw refused(`${id} was refused (${disk.rejected.message}). Remove it, then add it again from its URL.`, disk.rejected);
    throw refused(`${id} has no manifest to reinstall from. Remove it, then add it again from its URL.`);
  }

  /** `latest` may swap `manifest` for a newer one; of what it asks, only `grants` (checked against `manifest`, which the owner saw) or what `carriedGrant` keeps is granted. */
  #start(id: string, manifest: PluginManifest, source: PluginSource | null, origin: Origin, grants?: unknown, latest?: (signal: AbortSignal) => Promise<PluginManifest>): PluginState {
    if (this.#closing) throw refused('Boite is shutting down.');
    if (this.#lanes.busy(id)) throw refused('Wait for the current plugin operation before installing.');
    const artifact = artifactFor(manifest);
    if (artifact === null && runsExecutable(manifest)) throw refused(`${id} has no binary for ${platformKey()}`);
    const ticked = grants === undefined ? null : checkGrants(grants, permissionsOf(manifest), id);
    this.#failures.delete(id);
    // A first install that fails leaves nothing behind; an update that fails keeps the version that worked.
    const disk = this.#onDisk(id);
    const fresh = disk.kind !== 'installed';
    const before = disk.kind === 'installed' && disk.installed.manifest.schema !== 1 ? permissionsOf(disk.installed.manifest) : null;
    const controller = new AbortController();
    const job: Job = { controller, progress: 0, promise: Promise.resolve(), relaunch: false };
    this.#jobs.set(id, job);
    job.promise = this.#lanes.alone(id, 'install', () => (latest === undefined ? Promise.resolve(manifest) : latest(controller.signal))
      .then((target) => {
        const found = target === manifest ? artifact : artifactFor(target);
        if (found === null && runsExecutable(target)) throw new Error(`${id} ${target.version} has no binary for ${platformKey()}`);
        return (found === null ? this.#installText(id, target, source, origin, job) : this.#download(id, target, source, origin, found, job)).then(() => target);
      })
      .then((target) => { const asks = permissionsOf(target); this.grants.set(id, ticked === null ? carriedGrant(this.grants.stored(id), before, asks) : asks.filter((name) => ticked.includes(name))); this.#pending.delete(id); job.relaunch = true; })
      .catch(async (error: unknown) => {
        if (!controller.signal.aborted) this.#failures.set(id, messageOf(error));
        if (fresh) await removeTree(this.#directory(id)).catch(() => undefined);
        if (fresh && controller.signal.aborted) this.#pending.delete(id);
      })
      .finally(() => {
        this.#jobs.delete(id);
        this.accountPools.forget(id);
        this.#regrant(id);
        this.#emit(id);
        if (job.relaunch) this.#resumeApp(id);
      }), 'Wait for the current plugin operation before installing.');
    this.#emit(id);
    return this.state(id);
  }

  /** A plugin that runs nothing: its record is the whole install. One that ran before stops and its binary goes. */
  async #installText(id: string, manifest: PluginManifest, source: PluginSource | null, origin: Origin, job: Job): Promise<void> {
    const dir = this.#directory(id);
    mkdirSync(dir, { recursive: true });
    const previous = this.#onDisk(id);
    const installed = previous.kind === 'installed' ? previous.installed : null;
    if (installed !== null && (providesApp(installed.manifest) || providesService(installed.manifest))) await this.apps.forget(id);
    if (installed !== null && providesGateway(installed.manifest)) await this.gateways.forget(id);
    job.controller.signal.throwIfAborted();
    const staged = join(dir, `${INSTALLED_FILE}.part`);
    await writeFile(staged, JSON.stringify({ schema: 1, origin, source, installedAt: Date.now(), manifest }, null, 2), { mode: 0o600 });
    await rename(staged, join(dir, INSTALLED_FILE));
    if (installed?.binary) await rm(installed.binary, { force: true }).catch(() => undefined);
    job.progress = 100;
  }

  async #download(id: string, manifest: PluginManifest, source: PluginSource | null, origin: Origin, artifact: PluginArtifact, job: Job): Promise<void> {
    const signal = job.controller.signal;
    const dir = this.#directory(id);
    mkdirSync(dir, { recursive: true });
    const temporary = join(dir, 'download.part');
    // An idle timer rather than a deadline on the whole transfer: a slow link that
    // keeps sending finishes, a silent one stops with words saying so.
    let size = 0;
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(new Error(`${id} download stalled: no data for ${Math.round(this.downloadIdleMs / 1000)} seconds after ${size} bytes.`)), this.downloadIdleMs);
    };
    const ceiling = setTimeout(() => idle.abort(new Error(`${id} download did not finish within ${DOWNLOAD_CEILING_MS / 60_000} minutes.`)), DOWNLOAD_CEILING_MS);
    const stop = AbortSignal.any([signal, idle.signal]);
    // A body already handed over does not always hear the abort: every wait races it.
    const stopped = new Promise<never>((_, reject) => stop.addEventListener('abort', () => reject(stop.reason), { once: true }));
    stopped.catch(() => undefined);
    try {
      arm();
      const response = await Promise.race([fetch(artifact.url, { signal: stop }), stopped]);
      if (response.url !== '' && !response.url.startsWith('https://')) {
        throw new Error(`${id} download was redirected to ${response.url}; artifacts come over https only.`);
      }
      if (!response.ok || !response.body) throw new Error(`${id} download returned HTTP ${response.status}.`);
      const declared = Number(response.headers.get('content-length'));
      if (declared > DOWNLOAD_MAX_BYTES) throw new Error(`${id} download is ${declared} bytes, past the 64 MB a plugin may take.`);
      const total = declared || 3_000_000;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const chunk = await Promise.race([reader.read(), stopped]);
          if (chunk.done) break;
          arm();
          size += chunk.value.length;
          if (size > DOWNLOAD_MAX_BYTES) throw new Error(`${id} download exceeds the 64 MB a plugin may take.`);
          chunks.push(chunk.value);
          const progress = Math.min(95, Math.floor(size / total * 95));
          if (progress !== job.progress) { job.progress = progress; this.#emit(id); }
        }
      } finally { clearTimeout(timer); clearTimeout(ceiling); void reader.cancel().catch(() => undefined); }
      const bytes = Buffer.concat(chunks);
      verifyPluginDownload(bytes, artifact.sha256, id);
      signal.throwIfAborted();
      await writeFile(temporary, bytes, { mode: 0o700 });
      if (process.platform !== 'win32') await chmod(temporary, 0o700);
      signal.throwIfAborted();
      const previous = this.#onDisk(id);
      const installed = previous.kind === 'installed' ? previous.installed : null;
      // Windows locks a running executable: the app stops before its binary is replaced.
      if (installed !== null && (providesApp(installed.manifest) || providesService(installed.manifest))) {
        job.relaunch = true;
        await this.apps.kill(id);
      }
      // A gateway still serving would be cut off: it waits for its requests like an update, then stops.
      const ran = installed !== null && providesGateway(installed.manifest) && await this.gateways.drainForUpdate(id, manifest.version);
      await this.#activate(id, dir, installed, manifest, temporary, ran, JSON.stringify({ schema: 1, origin, source, installedAt: Date.now(), manifest }, null, 2));
      job.progress = 100;
    } finally {
      clearTimeout(timer);
      clearTimeout(ceiling);
      await rm(temporary, { force: true });
    }
  }

  /**
   * The new binary and its record replace the previous ones together
   * (`plugins/activation.ts`). A gateway that ran before starts from the new
   * binary and must answer `/health` before the record commits; when it does
   * not, or the record cannot be written, the previous binary and record go
   * back, the previous gateway starts again, and the update fails with the
   * reason, keeping the version that worked.
   */
  async #activate(id: string, dir: string, previous: Installed | null, manifest: PluginManifest, temporary: string, ran: boolean, record: string): Promise<void> {
    const binary = this.#binaryPath(dir, manifest)!;
    let activation: Activation | null = null;
    let why: string | null = null;
    try {
      activation = switchRelease(dir, { previous: previous?.binary ?? null, binary, temporary, record });
      // The record names the previous release until the commit: the gateway is handed the new binary.
      if (ran && providesGateway(manifest) && !await this.gateways.launch(id, false, { binary, executable: manifest.executable!, replaces: previous?.manifest.executable ?? null })) {
        why = this.gateways.state(id, dir).error ?? `${id} ${manifest.version} did not start`;
        throw new Error(why);
      }
      activation.commit();
    } catch (error) {
      if (ran) await this.gateways.kill(id);
      activation?.rollback();
      if (!ran || previous === null) throw error;
      const restarted = await this.gateways.launch(id);
      if (!restarted) {
        throw new Error(`${why ?? messageOf(error)}. ${previous.version} did not start again: ${this.gateways.state(id, dir).error ?? 'the gateway is not running'}.`);
      }
      throw new Error(`${why ?? messageOf(error)}. ${previous.version} runs again.`);
    }
  }

  /**
   * Fetches the repository at `ref` and reads its manifest. Nothing is
   * downloaded or run; the preview is what the owner confirms.
   */
  async inspect(params: RpcParams<'plugins.inspect'>): Promise<PluginPreview> {
    if (this.#closing) throw refused('Boite is shutting down.');
    const { url, ref, pagePath } = readSource(params.url, params.ref, this.allowLocalSources);
    const fetching = fetchManifest(this.#core, url, ref, { allowLocal: this.allowLocalSources, signal: this.#shutdown.signal, pagePath });
    this.#inspecting.add(fetching);
    let fetched: Awaited<typeof fetching>;
    try { fetched = await fetching; } finally { this.#inspecting.delete(fetching); }
    const source: PluginSource = { url, ref: fetched.ref, commit: fetched.commit };
    const preview: PluginPreview = {
      previewId: null, source, manifest: null, rejected: null, artifact: null,
      platform: platformKey(), commands: [], replaces: null, expiresAt: Date.now() + PREVIEW_TTL_MS,
    };
    if (fetched.text === null) {
      const rejected = refusal(PLUGIN_MANIFEST_FILE, '(file)', `a ${PLUGIN_MANIFEST_FILE} at the root of the repository`, undefined).rejected;
      return { ...preview, rejected };
    }
    let manifest: PluginManifest;
    try {
      manifest = parseManifestText(fetched.text, PLUGIN_MANIFEST_FILE);
    } catch (error) {
      if (error instanceof ManifestRefused) return { ...preview, rejected: error.rejected };
      throw error;
    }
    const read: PluginPreview = { ...preview, manifest, artifact: artifactFor(manifest), commands: commandsOf(manifest) };
    const conflict = this.#conflict(manifest, url);
    if (conflict !== null) return { ...read, rejected: conflict };
    if (read.artifact === null && runsExecutable(manifest)) {
      const published = Object.keys(manifest.artifacts ?? {}).join(', ');
      return { ...read, rejected: refusal(PLUGIN_MANIFEST_FILE, 'artifacts', `an artifact for ${platformKey()}, this machine`, published).rejected };
    }
    const previewId = this.#previews.put({ manifest, source }, preview.expiresAt);
    const disk = this.#onDisk(manifest.id);
    return { ...read, previewId, replaces: disk.kind === 'installed' ? disk.installed.version : null };
  }

  /**
   * Why `manifest` cannot take its id here, or null. A recommended id stays
   * the recommended plugin's; an id added from one URL is not taken over by
   * another. The same URL again is an update.
   */
  #conflict(manifest: PluginManifest, url: string): PluginRejected | null {
    const found = manifest.id;
    if (this.#recommendedManifest(found) !== null) {
      return refusal(PLUGIN_MANIFEST_FILE, 'id', `an id no recommended plugin uses (${this.recommended.map((entry) => entry.id).join(', ')})`, found).rejected;
    }
    const pending = this.#pending.get(found);
    const disk = this.#onDisk(found);
    const taken = pending?.source.url ?? (disk.kind === 'installed' ? disk.installed.source?.url ?? null : null);
    if (taken !== null && !sameRepository(taken, url)) {
      return refusal(PLUGIN_MANIFEST_FILE, 'id', `an id not already used by the plugin from ${taken}`, found).rejected;
    }
    if (taken === null && (disk.kind === 'rejected' || disk.kind === 'error')) {
      return refusal(PLUGIN_MANIFEST_FILE, 'id', `an id free of the broken ${found} already installed; remove it first`, found).rejected;
    }
    if (disk.kind === 'installed' && disk.installed.devPath !== null) {
      return refusal(PLUGIN_MANIFEST_FILE, 'id', `an id free of the dev plugin ${found} run from ${disk.installed.devPath}; remove it first`, found).rejected;
    }
    return this.#nameClash(manifest);
  }

  /** Why the manifest's command or slash command names are taken: by an installed plugin, an install under way or a dev load. */
  #nameClash(manifest: PluginManifest): PluginRejected | null {
    const coming = [...this.#pending.values(), ...this.#claims.values()].map((entry) => ('manifest' in entry ? entry.manifest : entry));
    return nameClash(manifest, [...this.installedPlugins(), ...coming.map((other) => ({ id: other.id, manifest: other }))]);
  }

  /** Installs what one preview showed, at the commit it showed. A preview is used once. `grants`: plugins.add's. */
  add(previewId: unknown, grants?: unknown): PluginState {
    const { manifest, source } = this.#previews.take(previewId);
    const conflict = this.#conflict(manifest, source.url);
    if (conflict !== null) throw refused(conflict.message, conflict);
    if (this.#lanes.busy(manifest.id)) throw refused('Wait for the current plugin operation before installing.');
    const before = this.#pending.get(manifest.id);
    this.#pending.set(manifest.id, { manifest, source });
    try {
      return this.#start(manifest.id, manifest, source, 'url', grants);
    } catch (error) {
      if (before === undefined) this.#pending.delete(manifest.id);
      else this.#pending.set(manifest.id, before);
      throw error;
    }
  }

  async cancel(id: string): Promise<PluginState> {
    this.#known(id);
    const job = this.#jobs.get(id);
    if (job !== undefined) {
      job.controller.abort();
      await job.promise;
    }
    return this.state(id);
  }

  /** Deletes the plugin's directory, the whole of what its install wrote. */
  async uninstall(id: string): Promise<PluginState> {
    this.#known(id);
    // Held before the first await: an install or a start asked for meanwhile is refused, not erased.
    return this.#lanes.alone(id, 'uninstall', async () => {
      await this.apps.forget(id);
      this.tokens.revoke(id);
      this.grants.clear(id);
      // Its data directory stays: a gateway's sign-ins outlive its program.
      await this.gateways.forget(id);
      await removeTree(this.#directory(id));
      this.#pending.delete(id);
      this.#failures.delete(id);
      this.accountPools.forget(id);
      return this.state(id);
    }, 'Wait for the current plugin operation before uninstalling.').then((state) => {
      this.#core.bus.emit('plugins.updated', state);
      return state;
    });
  }

  /** The installed plugin an account call runs, or the reason there is none. */
  #usable(id: string): Installed {
    if (this.#closing) throw refused('Boite is shutting down.');
    this.#lanes.assertUsable(id);
    const disk = this.#onDisk(id);
    if (disk.kind === 'rejected') throw refused(`${id} was refused: ${disk.rejected.message}`, disk.rejected);
    if (disk.kind !== 'installed') throw refused(`Install ${id} first.`);
    return disk.installed;
  }

  #run(id: string, installed: Installed, args: string[]): Promise<string> {
    if (this.#closing) throw refused('Boite is shutting down.');
    if (installed.binary === null) throw refused(`${id} runs nothing.`);
    return this.#runs.pool(id, installed.binary, installed.manifest.executable ?? id, args, this.#directory(id), this.#env(id, installed.manifest));
  }

  accounts(id: string, refresh = false): Promise<PluginPool[]> { return this.accountPools.list(id, refresh); }
  blocksAccount(accountId: string): boolean { return this.accountPools.blocks(accountId); }
  accountAction(params: RpcParams<'plugins.accountAction'>): Promise<PluginPool[]> { return this.accountPools.action(params); }

  /** Starts the plugin's desktop app and gateway it provides: at core start those that start with it, after an install those left enabled. */
  #resumeApp(id: string, atStart = false): void {
    if (this.#closing) return;
    try {
      const disk = this.#onDisk(id);
      if (disk.kind === 'installed' && (providesApp(disk.installed.manifest) || providesService(disk.installed.manifest))) this.apps.resume(id, this.#directory(id), atStart);
      if (disk.kind === 'installed' && providesGateway(disk.installed.manifest)) this.gateways.resume(id, this.#directory(id), atStart);
    } catch (error) {
      this.#core.log('warn', `plugin ${id} app did not start: ${messageOf(error)}`);
    }
  }

  /**
   * At core start: every installed desktop app and gateway that starts with
   * the core. One plugin the store cannot read is logged by `resumeApp` and
   * skipped; the others still start.
   */
  startApps(): void {
    let ids: string[];
    try {
      ids = this.#ids();
    } catch (error) {
      this.#core.log('warn', `desktop apps did not start: ${messageOf(error)}`);
      return;
    }
    for (const id of ids) if (!this.#jobs.has(id)) this.#resumeApp(id, true);
  }

  /** `plugins.autostart`: whether the plugin's desktop app and gateway start when the core starts. */
  async autostart(params: RpcParams<'plugins.autostart'>): Promise<PluginState> {
    const id = this.#known(params.id);
    if (typeof params.autostart !== 'boolean') throw invalidParams('autostart must be true or false', { field: 'autostart', expected: 'true or false' });
    const installed = this.#usable(id);
    const app = providesApp(installed.manifest) || providesService(installed.manifest);
    const gateway = providesGateway(installed.manifest);
    if (!app && !gateway) throw refused(`${id} provides no desktop app, service or gateway to start with Boite.`);
    await this.#lanes.shared(id, async () => {
      if (app) await this.apps.setAutostart(id, this.#directory(id), params.autostart);
      if (gateway) await this.gateways.setAutostart(id, this.#directory(id), params.autostart);
    });
    return this.state(id);
  }

  /** `plugins.app` and `plugins.gateway`: start, stop or restart the desktop app or service, or the gateway, a plugin provides. */
  app(params: RpcParams<'plugins.app'>): Promise<PluginState> { return this.#control(params, 'app'); }
  gateway(params: RpcParams<'plugins.gateway'>): Promise<PluginState> { return this.#control(params, 'gateway'); }

  async #control(params: RpcParams<'plugins.app'>, kind: 'app' | 'gateway'): Promise<PluginState> {
    const id = this.#known(params.id);
    if (!['start', 'stop', 'restart'].includes(params.action)) {
      throw invalidParams(`plugin ${kind} action must be start, stop or restart`, { field: 'action', expected: 'start, stop or restart' });
    }
    const { manifest } = this.#usable(id);
    if (kind === 'app' ? !providesApp(manifest) && !providesService(manifest) : !providesGateway(manifest)) throw refused(`${id} provides no ${kind === 'app' ? 'desktop app or service' : 'gateway'}.`);
    await this.#lanes.shared(id, () => (kind === 'app' ? this.apps : this.gateways).control(id, this.#directory(id), params.action));
    return this.state(id);
  }

  /**
   * Every plugin installed and readable, in list order. What the guide, the
   * composer and the command runner read; one broken plugin is left out, not
   * the others.
   */
  installedPlugins(): InstalledPlugin[] {
    let ids: string[];
    try { ids = this.#ids(); } catch { return []; }
    const out: InstalledPlugin[] = [];
    for (const id of ids) {
      if (this.#jobs.has(id)) continue;
      try {
        const disk = this.#onDisk(id);
        if (disk.kind === 'installed') out.push({ id, manifest: disk.installed.manifest, dir: this.#directory(id) });
      } catch { /* unreadable: the Plugins page says why */ }
    }
    return out;
  }

  /**
   * `plugins.command`: an agent's `boite <name> args...`. The plugin providing
   * `name` runs with argv `<name> args...` in the caller's directory, with
   * its token, its data folder and the calling thread in its environment,
   * stdin empty, for at most ten minutes. Its exit code and output come back,
   * each stream cut at 1 MB.
   */
  async command(params: RpcParams<'plugins.command'>, caller: Identity): Promise<PluginCommandResult> {
    if (this.#closing) throw refused('Boite is shutting down.');
    const { name, args, cwd } = commandRequest(params);
    const threadId = caller.principal === 'agent' ? caller.threadId : params.threadId ?? null;
    const id = commandOwner(this.installedPlugins(), name).id;
    const installed = this.#usable(id);
    const binary = installed.binary;
    if (binary === null) throw refused(`${id} provides ${name} but ships no executable.`);
    return this.#lanes.shared(id, () => this.#runs.command(id, binary, [name, ...args], cwd, this.#env(id, installed.manifest, threadId) ?? {}));
  }

  /** A schema 2 plugin's environment (docs/plugins.md, "Environment"); a schema 1 pool inherits the core's. */
  #env(id: string, manifest: PluginManifest, callerThreadId: string | null = null): Record<string, string | undefined> | undefined {
    if (manifest.schema === 1) return undefined;
    const { token, dataDir } = this.#access(id, manifest);
    return appEnv(process.env, { coreUrl: this.#core.baseUrl(), token, pluginId: id, dataDir, callerThreadId });
  }

  /** After an install, a reload or a grant: a token reaching other than what is granted now goes, its sockets with it. */
  #regrant(id: string): void {
    const disk = this.#onDisk(id);
    const manifest = disk.kind === 'installed' ? disk.installed.manifest : null;
    this.tokens.keepIf(id, manifest === null || manifest.schema === 1 ? null : this.grants.effective(id, permissionsOf(manifest)));
  }

  /** `plugins.setGrants`: a new token reaching `grants`, the app or service restarted on it. */
  async setGrants(id: string, grants: unknown): Promise<PluginState> {
    this.#known(id);
    await this.#lanes.alone(id, 'install', async () => {
      const disk = this.#onDisk(id);
      if (disk.kind !== 'installed') throw refused(`${id} is not installed; its permissions are granted at install`);
      const { manifest } = disk.installed;
      if (manifest.schema === 1) throw refused(`${id} is a schema 1 plugin: its processes hold the owner token, which no grant narrows`);
      this.grants.set(id, checkGrants(grants, permissionsOf(manifest), id));
      this.#regrant(id);
      const app = providesApp(manifest) || providesService(manifest) ? this.apps.state(id, this.#directory(id), providesService(manifest)).status : 'stopped';
      if (app === 'running' || app === 'starting') await this.apps.control(id, this.#directory(id), 'restart');
    }, 'Wait for the current plugin operation before changing its permissions.');
    this.#emit(id);
    return this.state(id);
  }

  /**
   * `plugins.dev`: installs, or reloads, the plugin in a folder of this
   * machine. Nothing is downloaded: the folder holds the manifest and the
   * executable, both read from there on every use. A desktop app, service or
   * gateway it provides restarts.
   */
  async dev(params: RpcParams<'plugins.dev'>): Promise<PluginState> {
    this.#core.policy.assert(this.#core.policy.pluginInstallsOff(), 'plugins.install', String(params?.path));
    if (this.#closing) throw refused('Boite is shutting down.');
    const { path, file, manifest } = readDevFolder(params?.path);
    const id = manifest.id;
    if (this.#recommendedManifest(id) !== null) throw refused(`${file}: id ${id} is a recommended plugin's; pick another id for a dev plugin`);
    const binary = this.#binaryPath(path, manifest);
    if (binary !== null && !existsSync(binary)) {
      throw refused(`${binary} is missing: ${manifest.runtime === 'bun' ? 'build the plugin to that file' : 'build the executable'} first.`);
    }
    const before = this.#onDisk(id);
    if (before.kind === 'installed' && before.installed.devPath === null) throw refused(`${id} is installed${before.installed.source ? ` from ${before.installed.source.url}` : ''}; remove it before running it from a folder.`);
    const clash = this.#nameClash(manifest);
    if (clash !== null) throw refused(clash.message, clash);
    // Taken before the first await, so a second load naming the same command is refused; each load
    // releases only its own entry, a reload the lane refuses (it throws at once) included.
    this.#claims.add(manifest);
    await (async () => this.#lanes.alone(id, 'install', async () => {
      const dir = this.#directory(id);
      mkdirSync(dir, { recursive: true });
      const staged = join(dir, `${INSTALLED_FILE}.part`);
      await writeFile(staged, JSON.stringify({ schema: 1, origin: 'dev', source: null, devPath: path, installedAt: Date.now(), manifest }, null, 2), { mode: 0o600 });
      await rename(staged, join(dir, INSTALLED_FILE));
      this.#failures.delete(id);
      this.accountPools.forget(id);
      // The owner loads the folder after reading what it asks for: it gets all of it, until plugins.setGrants narrows it.
      this.grants.set(id, permissionsOf(manifest));
      this.#regrant(id);
      if (providesApp(manifest) || providesService(manifest)) await this.apps.control(id, dir, 'restart');
      else await this.apps.forget(id);
      if (providesGateway(manifest)) await this.gateways.control(id, dir, 'restart');
      else await this.gateways.forget(id);
    }, 'Wait for the current plugin operation before reloading.'))().finally(() => this.#claims.delete(manifest));
    this.#emit(id);
    return this.state(id);
  }

  /** At core start: the update checks of the recommended plugins that name a source. */
  startUpdateChecks(): void {
    if (!this.#closing) this.updates.start();
  }

  /** `plugins.checkUpdates`: reads the update sources now and answers with the states they leave. */
  async checkUpdates(params: RpcParams<'plugins.checkUpdates'>): Promise<PluginState[]> {
    if (this.#closing) throw refused('Boite is shutting down.');
    const sourced = this.recommended.map((manifest) => manifest.id).filter((id) => this.updateSources[id] !== undefined);
    let ids = sourced;
    if (params?.id !== undefined) {
      const expected = `a recommended plugin that names an update source: ${sourced.join(', ') || 'none'}`;
      if (!sourced.includes(params.id)) throw invalidParams(`plugin ${String(params.id)} has no update source; expected ${expected}`, { field: 'id', expected });
      ids = [params.id];
    }
    await this.updates.check(ids);
    return ids.map((id) => this.state(id));
  }

  async close(): Promise<void> {
    this.#closing = true;
    const apps = this.apps.close();
    const gateways = this.gateways.close();
    this.#shutdown.abort();
    const checks = this.updates.close();
    const jobs = [...this.#jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.all([...jobs.map((job) => job.promise), ...this.#lanes.rewrites()]);
    await this.#runs.close();
    await Promise.all([...this.accountPools.pending(), ...this.#inspecting].map((pending) => pending.catch(() => undefined)));
    await apps;
    await gateways;
    await checks;
  }
}
