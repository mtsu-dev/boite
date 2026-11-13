/**
 * `bun run build` of the core: the bundle `dist/` holds, compiled for the
 * kind of build its version says (`packages/contracts/src/experiments.ts`).
 * The version is the one `package.json` carries, which the nightly build
 * stamps first; `defineFlags` (`bin/defines.ts`) turns it into `__BOITE_BUILD_KIND__` and one
 * flag per tagged feature, so a Release bundle drops the code of a nightly or
 * dev feature behind its lazy entry (docs/internals/experiments.md#out-of-the-build).
 *
 * `--version <version>` and `--outdir <directory>` build another kind beside
 * the real one: `scripts/ci/feature-cut.ts` reads those bundles.
 */
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildKindOf } from '../../contracts/src/experiments.ts';
import { defineFlags, stampedVersion } from './defines.ts';

const root = resolve(import.meta.dir, '..');
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const version = option('--version') ?? stampedVersion();
const outdir = resolve(root, option('--outdir') ?? 'dist');

if (existsSync(outdir)) {
  if (lstatSync(outdir).isSymbolicLink()) throw new Error(`refusing linked build output: ${outdir}`);
  rmSync(outdir, { recursive: true });
}

const defines = defineFlags(version);
const minify = ['--minify-whitespace', '--minify-syntax', '--minify-identifiers'];
// The CLI, not Bun.build: `--env=BOITE_RELEASE_*` inlines what the process started with (src/telemetry.ts).
const steps = [
  ['build', 'src/main.ts', 'src/artifact-retention-worker.ts', 'src/platform/windows/jobs-worker.ts', 'src/platform/windows/guard-worker.ts', '--target', 'bun', '--env=BOITE_RELEASE_*',
    '--outdir', outdir, '--splitting', '--sourcemap=none', '--entry-naming', '[name].[ext]', ...minify, ...defines],
  ['build', 'src/platform/linux-tcp-worker.ts', '--target', 'bun', '--outfile', resolve(outdir, 'linux-tcp-worker.js'), ...minify, ...defines],
];
for (const step of steps) {
  const child = Bun.spawn([process.execPath, ...step], { cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'ignore', windowsHide: true });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
console.log(`core bundle: ${buildKindOf(version)} build (${version})`);
