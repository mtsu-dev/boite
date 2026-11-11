/*
 * The agent-desktop build `boite desktop` runs, which Boite fetches itself on
 * first use: one pinned npm release, checked against the digests below, so no
 * agent installs a tool, and every machine runs the version the CLI's help
 * describes. Only this machine's binary and its helper are kept, in
 * `<data dir>/tools/agent-desktop-<version>/<install id>/`. See docs/internals/desktop.md.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcRegistry } from '../procs.ts';
import { messageOf } from '../errors.ts';
import { runCommand } from '../run-command.ts';

export interface AgentDesktopRelease {
  version: string;
  url: string;
  /** Of the whole archive. */
  sha256: string;
  /** Per `<platform>-<cpu>`: the archive entries kept, the executable first, each under the name agent-desktop looks for, with its digest. */
  builds: Partial<Record<string, { entry: string; name: string; sha256: string }[]>>;
}

export const AGENT_DESKTOP_RELEASE: AgentDesktopRelease = {
  version: '1.0.2',
  url: 'https://registry.npmjs.org/agent-desktop/-/agent-desktop-1.0.2.tgz',
  sha256: '6a2bbcc1bda2cf92a23e52675ad7ca3f36fd8cb2ac649cd01361bfc8b3820b28',
  builds: {
    'linux-x64': [
      { entry: 'package/bin/agent-desktop-linux-x64', name: 'agent-desktop', sha256: '05427281a6746489bc0e15c16698a70a86322125c76c7a9e2f4c2d7a12bf7c5b' },
      // agent-desktop runs its helpers from its own folder, under these names.
      { entry: 'package/bin/agent-desktop-linux-clipboard-owner-linux-x64', name: 'agent-desktop-linux-clipboard-owner', sha256: 'bf17de139902724e86b3616970b7b7f16f5f1fb4143910b532a38dd2182720fa' },
    ],
    'linux-arm64': [
      { entry: 'package/bin/agent-desktop-linux-arm64', name: 'agent-desktop', sha256: '529ae49006278f778bcda6b68d7460a55148e2cefb1cb69a23485381d9dbdec0' },
      { entry: 'package/bin/agent-desktop-linux-clipboard-owner-linux-arm64', name: 'agent-desktop-linux-clipboard-owner', sha256: 'dcd6f2ce9a0e92e42f4d2ee9161ea1b9f2b11c0e4b1878119a19c0a2db3630a6' },
    ],
    'win32-x64': [
      { entry: 'package/bin/agent-desktop-win32-x64.exe', name: 'agent-desktop.exe', sha256: '409e58cbdd6aed47e29771ffa60bc122a9843505a227af488cded85215943988' },
    ],
    'win32-arm64': [
      { entry: 'package/bin/agent-desktop-win32-arm64.exe', name: 'agent-desktop.exe', sha256: '5877fbca41fb85806353d0aaf67c23cfdf06a58a77c5d9cba005727a2891034e' },
    ],
    'darwin-x64': [
      { entry: 'package/bin/agent-desktop-darwin-x64', name: 'agent-desktop', sha256: '9684916bb4b5486c02cef8b2d480e55a551639b08358284f90a87cef43b2da8b' },
      { entry: 'package/bin/agent-desktop-macos-helper-darwin-x64', name: 'agent-desktop-macos-helper', sha256: 'ce52467818ac601ae1145a0b9ecaa14aaf04d2e72d24cf6d29d26757340f9c6b' },
    ],
    'darwin-arm64': [
      { entry: 'package/bin/agent-desktop-darwin-arm64', name: 'agent-desktop', sha256: 'bf0a3c9256512f2f57288d37ccd17d7f03665fccc53c2f74011a49b98e61ba59' },
      { entry: 'package/bin/agent-desktop-macos-helper-darwin-arm64', name: 'agent-desktop-macos-helper', sha256: '522829116cb006b5770c6a82b361f466a4775f794d6af4083e75231a2d6bb551' },
    ],
  },
};

const SCOPE = 'system:desktop';
const DOWNLOAD_TIMEOUT_MS = 120_000;
const EXTRACT_TIMEOUT_MS = 60_000;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A file's SHA-256, or null when it cannot be read: missing, unreadable, or removed meanwhile by another core repairing it. */
function digestOf(path: string): string | null {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

export interface AgentDesktopToolOptions {
  release?: AgentDesktopRelease;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * The installed agent-desktop: found, checked once per core, or fetched by the
 * first call that needs it. Each install is a folder of its own under
 * `agent-desktop-<version>/`, renamed there whole and never changed after, so
 * cores sharing a data dir need no lock: two installing at once both keep
 * theirs, and only a folder whose files no longer match is removed.
 */
export class AgentDesktopTool {
  readonly #root: string;
  readonly #procs: Pick<ProcRegistry, 'spawn'>;
  readonly #release: AgentDesktopRelease;
  readonly #platform: NodeJS.Platform;
  readonly #arch: string;
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>;
  #verified: string | null = null;
  #installing: Promise<string> | null = null;

  constructor(toolsDir: string, procs: Pick<ProcRegistry, 'spawn'>, options: AgentDesktopToolOptions = {}) {
    this.#procs = procs;
    this.#release = options.release ?? AGENT_DESKTOP_RELEASE;
    this.#root = join(toolsDir, `agent-desktop-${this.#release.version}`);
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  get version(): string { return this.#release.version; }

  /** The binary's path, installing it first when this machine has none; concurrent calls share one install. */
  async path(): Promise<string> {
    if (this.#verified) return this.#verified;
    const build = this.#release.builds[`${this.#platform}-${this.#arch}`];
    if (!build) throw new Error(`agent-desktop ${this.#release.version} has no build for ${this.#platform}-${this.#arch}`);
    const found = this.#find(build);
    if (found) return (this.#verified = found);
    this.#installing ??= this.#install(build).finally(() => { this.#installing = null; });
    return this.#installing;
  }

  /** An intact install's binary. A published folder is always complete, so one that does not match was damaged: it goes. */
  #find(build: { name: string; sha256: string }[]): string | null {
    if (!existsSync(this.#root)) return null;
    for (const name of readdirSync(this.#root).sort()) {
      if (name.startsWith('.')) continue;
      const folder = join(this.#root, name);
      const intact = build.every(file => digestOf(join(folder, file.name)) === file.sha256);
      if (intact) return join(folder, build[0]!.name);
      rmSync(folder, { recursive: true, force: true });
    }
    return null;
  }

  async #install(build:{ entry: string; name: string; sha256: string }[]): Promise<string> {
    const { url, version } = this.#release;
    let response: Response;
    try {
      response = await this.#fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      throw new Error(`agent-desktop ${version} could not be downloaded from ${url}: ${messageOf(error)}`);
    }
    if (!response.ok) throw new Error(`agent-desktop ${version} could not be downloaded from ${url}: HTTP ${response.status}`);
    const archive = new Uint8Array(await response.arrayBuffer());
    if (sha256(archive) !== this.#release.sha256) throw new Error(`the agent-desktop ${version} archive from ${url} does not match its pinned SHA-256; nothing was installed`);

    // Staged beside the final folder, then renamed: a crash leaves a stray dot folder, never a half-written tool.
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    const id = randomBytes(6).toString('hex');
    const staging = join(this.#root, `.staging-${id}`);
    const published = join(this.#root, id);
    mkdirSync(staging, { mode: 0o700 });
    try {
      const tgz = join(staging, 'release.tgz');
      writeFileSync(tgz, archive, { mode: 0o600 });
      const run = await runCommand(this.#procs, SCOPE, tarProgram(this.#platform), ['-xzf', tgz, '-C', staging, ...build.map(file => file.entry)], EXTRACT_TIMEOUT_MS);
      if (run.code !== 0) throw new Error(`tar could not unpack it: ${run.stderr.trim() || (run.timedOut ? 'it timed out' : `exit code ${run.code}`)}`);
      const folder = join(staging, 'tool');
      mkdirSync(folder, { mode: 0o755 });
      for (const file of build) {
        const bytes = readFileSync(join(staging, file.entry));
        if (sha256(bytes) !== file.sha256) throw new Error(`${file.entry} does not match its pinned SHA-256`);
        const target = join(folder, file.name);
        writeFileSync(target, bytes, { mode: 0o755 });
        chmodSync(target, 0o755);
      }
      renameSync(folder, published);
    } catch (error) {
      throw new Error(`agent-desktop ${version} could not be installed: ${messageOf(error)}`);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return (this.#verified = join(published, build[0]!.name));
  }
}

/**
 * Windows' own bsdtar, never the first `tar` on PATH: Git's GNU tar reads the
 * `C:` of an archive path as a remote host.
 */
function tarProgram(platform: NodeJS.Platform): string {
  return platform === 'win32' ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}
