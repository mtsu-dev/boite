/**
 * Builds the Linux launcher (native/launch.c) that ties each agent's group to
 * the core before the agent runs. Static, so the one file runs on any Linux of
 * its architecture. `compile.ts` ships it next to the compiled core, where the
 * core looks for it (src/platform/linux-launcher.ts); the test runner builds it
 * into native/build first. Elsewhere than on Linux there is nothing to build.
 *
 * `bun run bin/build-launcher.ts [--outfile=<path>]`
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { LAUNCHER_NAME } from '../src/platform/linux-launcher.ts';

const core = resolve(import.meta.dir, '..');
export const DEV_LAUNCHER = join(core, 'native', 'build', LAUNCHER_NAME);

/** Builds it at `outfile`; throws with the compiler's output when it cannot. */
export function buildLauncher(outfile = DEV_LAUNCHER): string {
  mkdirSync(dirname(outfile), { recursive: true });
  const cc = process.env.CC || 'cc';
  const result = Bun.spawnSync([cc, '-static', '-O2', '-Wall', '-Wextra', '-Werror', '-o', outfile, join(core, 'native', 'launch.c')], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${cc} could not build ${LAUNCHER_NAME}: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);
  return outfile;
}

if (import.meta.main) {
  if (process.platform !== 'linux') process.exit(0);
  const option = process.argv.find(arg => arg.startsWith('--outfile='))?.slice('--outfile='.length);
  try { console.log(buildLauncher(option === undefined ? undefined : resolve(option))); } catch (error) {
    console.error(`build-launcher: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
