import { npmInstallOf, npmParked, npmReplacedPaths, restoreNpmParked, type NpmCommand, type NpmInstall } from './npm.ts';
import type { ResolvedCommand } from './resolve.ts';

/** `npm install -g` of an agent's package at the version the registry named, run in place of the agent's own updater. */
export interface NpmUpdate {
  args: string[];
  /** npm's CLI under Node; `shown` stays the agent's program, whose install the updater environment points npm at. */
  command: ResolvedCommand;
  label: string;
  /** The install it replaces. */
  install: NpmInstall;
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
  return { args: ['install', '-g', `--allow-scripts=${pkg}`, spec], command: { executable: cli.executable, prefix: [cli.script], shown: program, updateEnv: {} }, label: `npm install -g ${spec}`, install };
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
