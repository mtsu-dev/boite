/*
 * The agent-desktop build `boite desktop` runs, which Boite fetches itself on
 * first use: one pinned npm release, checked against the digests below, so no
 * agent installs a tool, and every machine runs the version the CLI's help
 * describes. Only the Linux binary and its clipboard helper are kept, in
 * `<data dir>/tools/agent-desktop-<version>/`. See docs/desktop.md.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProcRegistry } from '../procs.ts';
import { messageOf } from '../errors.ts';
import { runCommand } from '../run-command.ts';

export interface AgentDesktopRelease {
  version: string;
  url: string;
  /** Of the whole archive. */
  sha256: string;
  /** Per CPU: the archive entries kept, each under the name agent-desktop looks for, with its digest. */
  builds: Partial<Record<string, { entry: string; name: string; sha256: string }[]>>;
}

export const AGENT_DESKTOP_RELEASE: AgentDesktopRelease = {
  version: '1.0.2',
  url: 'https://registry.npmjs.org/agent-desktop/-/agent-desktop-1.0.2.tgz',
  sha256: '6a2bbcc1bda2cf92a23e52675ad7ca3f36fd8cb2ac649cd01361bfc8b3820b28',
  builds: {
    x64: [
      { entry: 'package/bin/agent-desktop-linux-x64', name: 'agent-desktop', sha256: '05427281a6746489bc0e15c16698a70a86322125c76c7a9e2f4c2d7a12bf7c5b' },
      // agent-desktop runs its clipboard owner from its own folder, under this name.
      { entry: 'package/bin/agent-desktop-linux-clipboard-owner-linux-x64', name: 'agent-desktop-linux-clipboard-owner', sha256: 'bf17de139902724e86b3616970b7b7f16f5f1fb4143910b532a38dd2182720fa' },
    ],
    arm64: [
      { entry: 'package/bin/agent-desktop-linux-arm64', name: 'agent-desktop', sha256: '529ae49006278f778bcda6b68d7460a55148e2cefb1cb69a23485381d9dbdec0' },
      { entry: 'package/bin/agent-desktop-linux-clipboard-owner-linux-arm64', name: 'agent-desktop-linux-clipboard-owner', sha256: 'dcd6f2ce9a0e92e42f4d2ee9161ea1b9f2b11c0e4b1878119a19c0a2db3630a6' },
    ],
  },
};

const SCOPE = 'system:desktop';
const DOWNLOAD_TIMEOUT_MS = 120_000;
const EXTRACT_TIMEOUT_MS = 60_000;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface AgentDesktopToolOptions {
  release?: AgentDesktopRelease;
  arch?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** The installed agent-desktop: found, checked once per core, or fetched by the first call that needs it. */
export class AgentDesktopTool {
  readonly #root: string;
  readonly #procs: Pick<ProcRegistry, 'spawn'>;
  readonly #release: AgentDesktopRelease;
  readonly #arch: string;
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>;
  #verified: string | null = null;
  #installing: Promise<string> | null = null;

  constructor(toolsDir: string, procs: Pick<ProcRegistry, 'spawn'>, options: AgentDesktopToolOptions = {}) {
    this.#procs = procs;
    this.#release = options.release ?? AGENT_DESKTOP_RELEASE;
    this.#root = join(toolsDir, `agent-desktop-${this.#release.version}`);
    this.#arch = options.arch ?? process.arch;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  get version(): string { return this.#release.version; }

  /** The binary's path, installing it first when this machine has none; concurrent calls share one install. */
  async path(): Promise<string> {
    if (this.#verified) return this.#verified;
    const build = this.#release.builds[this.#arch];
    if (!build) throw new Error(`agent-desktop ${this.#release.version} has no Linux build for ${this.#arch}`);
    if (this.#intact(build)) return (this.#verified = join(this.#root, 'agent-desktop'));
    this.#installing ??= this.#install(build).finally(() => { this.#installing = null; });
    return this.#installing;
  }

  #intact(build: { name: string; sha256: string }[]): boolean {
    return build.every(file => {
      const path = join(this.#root, file.name);
      return existsSync(path) && sha256(readFileSync(path)) === file.sha256;
    });
  }

  /**
   * Renames the checked folder into place. Another core sharing the data dir
   * may have published first: its intact install is kept and this copy dropped.
   * A damaged one is renamed aside before removal, so no core deletes a folder
   * another just published under the final name.
   */
  #publish(folder: string, parent: string, build: { name: string; sha256: string }[]): void {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        renameSync(folder, this.#root);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
      }
      if (this.#intact(build)) return;
      const aside = join(parent, `.agent-desktop-old-${randomBytes(6).toString('hex')}`);
      try {
        renameSync(this.#root, aside);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      rmSync(aside, { recursive: true, force: true });
    }
    throw new Error(`${this.#root} kept changing while it was installed`);
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

    // Staged beside the final folder, then renamed: a crash leaves a stray folder, never a half-written tool.
    const parent = join(this.#root, '..');
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const staging = join(parent, `.agent-desktop-${randomBytes(6).toString('hex')}`);
    mkdirSync(staging, { mode: 0o700 });
    try {
      const tgz = join(staging, 'release.tgz');
      writeFileSync(tgz, archive, { mode: 0o600 });
      const run = await runCommand(this.#procs, SCOPE, 'tar', ['-xzf', tgz, '-C', staging, ...build.map(file => file.entry)], EXTRACT_TIMEOUT_MS);
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
      this.#publish(folder, parent, build);
    } catch (error) {
      throw new Error(`agent-desktop ${version} could not be installed: ${messageOf(error)}`);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return (this.#verified = join(this.#root, 'agent-desktop'));
  }
}
