/**
 * What every core build defines: the kind of build the version says and one
 * flag per tagged feature (`packages/contracts/src/experiments.ts`), as
 * `bun build --define` arguments. `build.ts` (the bundle Windows and the
 * server archives ship) and `compile.ts` (the Linux and macOS sidecar) both
 * pass them, so each drops the code of the features above its kind
 * (docs/internals/experiments.md#out-of-the-build).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { featureDefines } from '../../contracts/src/experiments.ts';

/** The version the core's package.json carries, which the nightly build stamps before building. */
export function stampedVersion(): string {
  return (JSON.parse(readFileSync(resolve(import.meta.dir, '..', 'package.json'), 'utf8')) as { version: string }).version;
}

export function defineFlags(version: string = stampedVersion()): string[] {
  return Object.entries(featureDefines(version)).flatMap(([name, value]) => ['--define', `${name}=${value}`]);
}
