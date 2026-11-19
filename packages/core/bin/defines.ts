/**
 * Both core builds derive the kind and feature flags from the stamped version.
 * `compile.ts` passes them as `bun build --define` arguments and `build.ts`
 * passes the same `featureDefines` record directly to `Bun.build`.
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
