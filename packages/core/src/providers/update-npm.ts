import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmInstallOf, npmParked, npmReplacedPaths, restoreNpmParked, type NpmCommand, type NpmInstall } from './npm.ts';
import { recheckVersions } from './versions.ts';
import { forgetWhich } from './which.ts';
import type { ResolvedCommand } from './resolve.ts';

/** `npm install -g` of an agent's package at the version the registry named, run in place of the agent's own updater. */
export interface NpmUpdate {
  args: string[];
  /** npm's CLI under Node; `shown` stays the agent's program, whose install the updater environment points npm at. */
  command: ResolvedCommand;
  label: string;
  /** The install it replaces. */
  install: NpmInstall;
  /** The release it installs. */
  version: string;
}

/** The version npm's registry tags latest for that package. */
export async function npmLatest(name: string, timeoutMs: number): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${name.replaceAll('/', '%2F')}/latest`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`the npm registry answered ${response.status} for ${name}`);
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== 'string') throw new Error(`the npm registry named no version for ${name}`);
  return body.version;
}

/**
 * The npm command that installs the release the registry named, when the
 * copy that runs is a global npm install of the very package the descriptor
 * reads that release from. Boite already knows the version, so it does not
 * ask the agent's updater to find it again: `claude update` gives its own
 * `npm view` five seconds, and a cold npm on a slow laptop takes longer, so
 * every first update failed there (2026-10-15). Null leaves the update to
 * the agent's own updater.
 */
export function npmUpdate(program: string, pkg: string | undefined, latest: string | null, cli: NpmCommand | null): NpmUpdate | null {
  if (pkg === undefined || latest === null) return null;
  const install = npmInstallOf(program);
  if (install === null || install.name !== pkg || cli === null) return null;
  const spec = `${pkg}@${latest}`;
  // The agent's program names the install, so the updater environment points npm at its prefix.
  // npm 12 skips install scripts unless allowed, and Claude's copies its native binary over a stub;
  // an older npm warns about the flag and goes on.
  return { args: ['install', '-g', `--allow-scripts=${pkg}`, spec], command: { executable: cli.executable, prefix: [cli.script], shown: program, updateEnv: {} }, label: `npm install -g ${spec}`, install, version: latest };
}

/**
 * Runs npm's install (`run`), and puts back what it parked when it did not
 * finish. npm moves the package and its command links aside before it unpacks
 * the new release, and moves them back itself on an error; the update's time
 * limit ends in a kill, which lands in the middle of an unpacking. OpenCode 2
 * ships four Linux binaries of 200 MB each: on 2026-11-13 the limit cut its
 * install while the fourth was being written, which left the old copy parked,
 * a stub that only says its postinstall did not run, and no command on PATH.
 * A failed update must leave the copy that ran before. `exited` resolves once
 * npm's processes are gone, a child of its group deaf to SIGTERM included,
 * and rejects while one still runs.
 */
export async function runNpmUpdate(npm: NpmUpdate, run: () => Promise<string>, exited: () => Promise<void>): Promise<string> {
  const paths = npmReplacedPaths(npm.install);
  const before = npmParked(paths);
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      // The kill goes on to SIGKILL: nothing may write there any more when the old copy moves back.
      await exited();
    } catch {
      throw new Error(`${message}; npm is still running, so what it moved aside under ${npm.install.prefix} was left as it is`);
    }
    let restored: string[];
    try {
      restored = restoreNpmParked(paths, before);
    } catch (cause) {
      throw new Error(`${message}; putting back the copy npm moved aside failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (restored.length === 0) throw error;
    throw new Error(`${message}; npm stopped halfway, and the copy that ran before was put back`);
  }
}

/** What {@link installKeepingStart} asks of the updater. */
export interface PutBack {
  /** Resolves once the agent prints its version, and throws when it does not start. */
  starts: () => Promise<unknown>;
  install: (npm: NpmUpdate) => Promise<string>;
  /** The new release is known broken: skip it, so neither automatic updates nor Update all install it again. */
  broken: () => unknown;
  /** Called after a confirmed break, put back or not. */
  settled: () => Promise<void>;
}

/** Reads of the version after an install before the release counts as broken: the first start of a fresh program can be slow. */
const START_TRIES = 2;

/**
 * Runs npm's install and returns what it printed, or puts back the release
 * that ran before when the new one no longer starts, and throws why. The
 * version to put back is read from the installed package's manifest, and
 * `fallback`, the last reading, only when it has none. npm exits with zero
 * when an optional package is missing from the registry, and an agent that
 * ships its program in one package per platform is then left with nothing to
 * run: Codex 0.169.1 was published on 2026-11-17 without its Windows x64
 * package. The program npm installed must still be there: another copy that
 * answers on PATH is not the one updated.
 */
export async function installKeepingStart(npm: NpmUpdate, fallback: string | null, name: string, io: PutBack): Promise<string> {
  const previous = npmManifestVersion(npm.install) ?? fallback;
  // A program that was not executable before (a script run by Node) is only required to be there.
  const there = runnable(npm.command.shown) ? runnable : (path: string): boolean => existsSync(path);
  const said = await io.install(npm);
  const fails = async (): Promise<string | null> => {
    let reason = '';
    for (let tries = 0; tries < START_TRIES; tries++) {
      // The install may have moved or removed what PATH and the version cache knew.
      forgetWhich();
      recheckVersions();
      // Another copy on PATH may answer for it: the one npm installed must still be a program.
      if (!there(npm.command.shown)) return `${npm.command.shown} is gone or no longer executable`;
      try {
        await io.starts();
        return null;
      } catch (error) {
        reason = messageOf(error);
      }
    }
    return reason;
  };
  const reason = await fails();
  if (reason === null) return said;
  const broken = `\`${npm.label}\` left ${name} unable to start (${reason})`;
  const skipped = `Boite skips ${npm.version} until a newer release`;
  io.broken();
  try {
    if (previous === null) throw new AgentGone(`${broken}, and Boite did not know the version to put back; ${skipped}`);
    const spec = `${npm.install.name}@${previous}`;
    try {
      await io.install({ ...npm, args: [...npm.args.slice(0, -1), spec], label: `npm install -g ${spec}`, version: previous });
    } catch (error) {
      throw new AgentGone(`${broken}, and putting back ${previous} failed: ${messageOf(error)}; ${skipped}`);
    }
    const still = await fails();
    if (still !== null) throw new AgentGone(`${broken}, and ${previous} put back does not start either (${still}); ${skipped}`);
    throw new Error(`${broken}; Boite put back ${previous} and skips ${npm.version} until a newer release`);
  } finally {
    await io.settled();
  }
}

/** An update that left the agent with no version that starts: its row no longer names one. */
export class AgentGone extends Error {}

/** The version in the installed package's own manifest, read without starting it. */
function npmManifestVersion(install: NpmInstall): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(install.packageDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function runnable(program: string): boolean {
  try {
    accessSync(program, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
