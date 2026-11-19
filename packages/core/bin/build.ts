/**
 * `bun run build` of the core: the bundle `dist/` holds, compiled for the
 * kind of build its version says (`packages/contracts/src/experiments.ts`).
 * The version is the one `package.json` carries, which the nightly build
 * stamps first. `featureDefines` supplies `Bun.build` with `__BOITE_BUILD_KIND__`
 * and one flag per tagged feature, so a Release bundle drops the code of a
 * nightly or dev feature behind its lazy entry (docs/internals/experiments.md#out-of-the-build).
 *
 * `--version <version>` and `--outdir <directory>` build another kind beside
 * the real one: `scripts/ci/feature-cut.ts` reads those bundles.
 */
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildKindOf, featureDefines } from '../../contracts/src/experiments.ts';
import { stampedVersion } from './defines.ts';

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

const options: Omit<Bun.BuildConfig, 'entrypoints'> = {
  target: 'bun', outdir, sourcemap: 'none', minify: true,
  naming: { entry: '[name].[ext]' }, define: featureDefines(version),
};
await Bun.build({ ...options, entrypoints: [resolve(root, 'src/main.ts')], splitting: true, env: 'BOITE_RELEASE_*' });

// Desktop installers copy these workers beside the sidecar, outside core/.
// Bundle each on its own so it can load without the core's split chunks.
const workers = [
  'src/artifact-retention-worker.ts',
  'src/platform/windows/jobs-worker.ts',
  'src/platform/windows/guard-worker.ts',
  'src/platform/linux-tcp-worker.ts',
];
for (const worker of workers) await Bun.build({ ...options, entrypoints: [resolve(root, worker)] });
console.log(`core bundle: ${buildKindOf(version)} build (${version})`);
