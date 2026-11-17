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

/**
 * Puts back the release that ran before (`previous`) when npm installed the
 * new one and the agent no longer starts. npm exits with zero when an
 * optional package is missing from the registry, and an agent that ships its
 * program in one package per platform is then left with nothing to run:
 * Codex 0.169.1 was published on 2026-11-17 without its Windows x64 package.
 * Returns null when the agent starts, the reason once `previous` is back, and
 * throws when it cannot be put back.
 */
export async function putBackUnlessStarting(npm: NpmUpdate, previous: string | null, name: string, starts: () => Promise<unknown>, install: (npm: NpmUpdate) => Promise<unknown>): Promise<string | null> {
  const reread = async (): Promise<void> => {
    // The install may have moved or removed what PATH and the version cache knew.
    forgetWhich();
    recheckVersions();
    await starts();
  };
  let broken: string;
  try {
    await reread();
    return null;
  } catch (error) {
    broken = `\`${npm.label}\` left ${name} unable to start (${messageOf(error)})`;
  }
  if (previous === null) throw new Error(`${broken}, and Boite did not know the version to put back`);
  try {
    const spec = `${npm.install.name}@${previous}`;
    await install({ ...npm, args: [...npm.args.slice(0, -1), spec], label: `npm install -g ${spec}`, version: previous });
    await reread();
  } catch (error) {
    throw new Error(`${broken}, and putting back ${previous} failed: ${messageOf(error)}`);
  }
  return `${broken}; Boite put back ${previous}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
