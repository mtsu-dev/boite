/**
 * The compiled core: the Linux and macOS sidecar, and `dist/boite-core.exe` on
 * Windows, where the installer ships the signed runtime instead (stage-sidecar.ts).
 * `build:linux` runs it with `--target=bun-linux-x64-baseline` and its own
 * `--outfile`, from any machine.
 *
 * On x64 it embeds Bun's baseline runtime, which runs on CPUs without AVX2; the
 * default build stops with an illegal instruction there. `--bytecode` needs ESM
 * output because the core has top-level awaits. Identifiers stay readable in
 * logged stacks: only whitespace and syntax are minified.
 */
import { bunTarget, shellTarget } from '../../../apps/shell/scripts/targets.ts';
import { requirePinnedBun } from '../../../scripts/ci/bun-version.ts';
import { bunRuntime } from './bun-runtime.ts';
import { defineFlags } from './defines.ts';
import { dirname, join, resolve } from 'node:path';
import { buildLauncher } from './build-launcher.ts';
import { LAUNCHER_NAME } from '../src/platform/linux-launcher.ts';

/** A compile takes seconds; one past this is stuck, and says so before the job's own limit. */
const COMPILE_TIMEOUT_MS = 10 * 60_000;

// `bun build --compile` embeds the Bun it runs under, so it runs under this
// one, just checked, and not whichever `bun` comes first on PATH. A cross
// build (`BOITE_TARGET`, Intel macOS from Apple Silicon) embeds that same
// version's runtime for the other architecture.
requirePinnedBun('the compiled core');
const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const suffix = process.platform === 'win32' ? '.exe' : '';
const shell = shellTarget();
// A native build names a target only where it must pick the baseline runtime.
const target = option('target') ?? (shell.cross || (shell.arch === 'x64' && process.platform !== 'darwin') ? bunTarget(process.platform, shell.arch) : undefined);
// That runtime is fetched here, with deadlines and its checksum, and not by
// `bun build`, whose own download from npm has no deadline (bun-runtime.ts).
const runtime = target ? await bunRuntime(target).catch((error: unknown) => {
  console.error(`compile: the Bun runtime for ${target}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}) : undefined;
const result = Bun.spawnSync([
  process.execPath, 'build', '--compile', ...(target ? [`--target=${target}`, `--compile-executable-path=${runtime}`] : []),
  '--minify-whitespace', '--minify-syntax', '--bytecode', '--format=esm', '--env=BOITE_RELEASE_*',
  // The build's kind and its features' flags: `--version=<version>` compiles another kind (scripts/ci/feature-cut.ts).
  ...defineFlags(option('version')),
  'src/compiled-main.ts', 'src/artifact-retention-worker.ts', 'src/platform/linux-tcp-worker.ts', '--outfile', option('outfile') ?? `dist/boite-core${suffix}`,
], {
  stdout: 'inherit', stderr: 'inherit', windowsHide: true, timeout: COMPILE_TIMEOUT_MS,
});
if (result.exitedDueToTimeout) console.error(`compile: bun build did not finish within ${COMPILE_TIMEOUT_MS / 60_000} minutes and was stopped`);
if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
// A Linux core ties each agent's group before the agent runs through its launcher, found next to it
// (src/platform/linux-launcher.ts): the build fails without one rather than ship a core that falls back.
const linuxTarget = target === undefined ? process.platform === 'linux' : target.startsWith('bun-linux-');
if (linuxTarget) {
  const outfile = option('outfile') ?? `dist/boite-core${suffix}`;
  if (target !== undefined && !target.startsWith(`bun-linux-${process.arch}`)) {
    console.error(`compile: ${LAUNCHER_NAME} for ${target} must be built on that architecture, not ${process.arch}`);
    process.exit(1);
  }
  try { buildLauncher(join(dirname(resolve(outfile)), LAUNCHER_NAME)); } catch (error) {
    console.error(`compile: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
process.exit(0);
