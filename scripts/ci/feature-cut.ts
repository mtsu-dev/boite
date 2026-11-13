/**
 * Proves that a build holds no code of a feature above its kind
 * (docs/internals/experiments.md#out-of-the-build).
 *
 * Each feature of `FEATURE_CUTS` (`packages/contracts/src/experiments.ts`)
 * writes its marker in the modules its lazy entry loads. For a bundle of a
 * given kind this script fails when:
 *
 * - it holds the marker of a feature tagged above that kind (a leak: some
 *   module reached the feature's code outside its lazy entry), or
 * - it lacks the marker of a feature it must hold (the marker was removed or
 *   minified away, and the first check would pass on anything).
 *
 * Run:
 *   bun scripts/ci/feature-cut.ts
 *     reads packages/ui/dist and packages/core/dist as the kind the root
 *     package.json says, which is what `build:shell` just built.
 *   bun scripts/ci/feature-cut.ts --build
 *     builds the UI and the core for each of the three kinds in a temporary
 *     directory and reads them all. About a minute.
 *   --ui <dir>, --core <dir>, --version <version> name other bundles.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { BUILD_KINDS, EXPERIMENT_STAGES, FEATURE_CUTS, buildKindOf, featureMarker, stageRuns, type BuildKind, type ExperimentId, type FeatureStage } from '../../packages/contracts/src/experiments.ts';

export type Side = 'ui' | 'core';
export type Cuts = Partial<Record<ExperimentId, { ui: boolean; core: boolean }>>;
export type Finding = { side: Side; kind: BuildKind; feature: ExperimentId; problem: 'leak' | 'lost'; files: string[] };

/**
 * The files a marker can sit in: scripts, pages and styles, and the compiled
 * core (`boite-core`, the Linux and macOS sidecar, which embeds its scripts).
 * Not the compressed copies nor the other binary assets.
 */
const TEXT = /\.(?:js|mjs|html|css|json)$|^boite-core(?:-[a-z0-9-]+)?(?:\.exe)?$/;

function textFiles(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const full = join(directory, name);
    return statSync(full).isDirectory() ? textFiles(full) : TEXT.test(name) ? [full] : [];
  });
}

/** What is wrong with the bundle in `directory`, built as `kind`. Empty when it holds exactly the features of its kind. */
export function scanBundle(directory: string, side: Side, kind: BuildKind, cuts: Cuts = FEATURE_CUTS, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): Finding[] {
  const files = textFiles(directory);
  if (files.length === 0) throw new Error(`${directory} holds no bundle: build it first (bun run build:ui, bun run build:core)`);
  const sources = files.map((file) => ({ file: relative(directory, file), text: readFileSync(file, 'latin1') }));
  const findings: Finding[] = [];
  for (const [feature, cut] of Object.entries(cuts) as [ExperimentId, { ui: boolean; core: boolean }][]) {
    if (!cut[side]) continue;
    const marker = featureMarker(feature);
    const holding = sources.filter((source) => source.text.includes(marker)).map((source) => source.file);
    const expected = stageRuns(stages[feature], kind);
    if (!expected && holding.length > 0) findings.push({ side, kind, feature, problem: 'leak', files: holding });
    if (expected && holding.length === 0) findings.push({ side, kind, feature, problem: 'lost', files: [] });
  }
  return findings;
}

/** One line per finding, with what to do about it. */
export function describe(finding: Finding, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): string {
  const marker = featureMarker(finding.feature);
  return finding.problem === 'leak'
    ? `${finding.side} bundle (${finding.kind}): holds "${marker}" in ${finding.files.join(', ')}, but ${finding.feature} is tagged ${stages[finding.feature]}. Something imports its code outside its lazy entry (docs/internals/experiments.md#out-of-the-build)`
    : `${finding.side} bundle (${finding.kind}): "${marker}" is nowhere, but a ${finding.kind} build has ${finding.feature}. Its marker left the module its lazy entry loads, so a leak would go unseen`;
}

/** The cut features a bundle of this kind and side leaves out, for the report. */
function left(side: Side, kind: BuildKind): string {
  const ids = (Object.keys(FEATURE_CUTS) as ExperimentId[]).filter((id) => FEATURE_CUTS[id]?.[side]);
  const out = ids.filter((id) => !stageRuns(EXPERIMENT_STAGES[id], kind));
  const kept = ids.filter((id) => stageRuns(EXPERIMENT_STAGES[id], kind));
  return `without ${out.join(', ') || 'nothing'}; with ${kept.join(', ') || 'nothing'}`;
}

const bytes = (directory: string): number => textFiles(directory).reduce((sum, file) => sum + statSync(file).size, 0);

function check(directory: string, side: Side, kind: BuildKind): Finding[] {
  const findings = scanBundle(directory, side, kind);
  console.log(`${findings.length ? 'FAIL' : 'ok'}  ${side.padEnd(4)} ${kind.padEnd(7)} ${String(bytes(directory)).padStart(9)} bytes read  ${left(side, kind)}`);
  for (const finding of findings) console.error(`  ${describe(finding)}`);
  return findings;
}

/** A version of each kind, for `--build`: only the kind is read from it. */
const SAMPLE: Record<BuildKind, string> = { release: '0.0.0', nightly: '0.0.0-nightly.20260101.1', dev: '0.0.0-dev.0' };

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdout: 'ignore', stderr: 'inherit', stdin: 'ignore', windowsHide: true });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(' ')} exited with ${code}`);
}

async function main(args: string[]): Promise<number> {
  const root = resolve(import.meta.dir, '..', '..');
  const option = (name: string): string | undefined => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const findings: Finding[] = [];
  if (args.includes('--build')) {
    const out = mkdtempSync(join(tmpdir(), 'boite-feature-cut-'));
    try {
      for (const kind of BUILD_KINDS) {
        await run([process.execPath, 'x', 'vite', 'build', '--outDir', join(out, `ui-${kind}`), '--logLevel', 'error'], join(root, 'packages', 'ui'), { BOITE_BUILD_VERSION: SAMPLE[kind] });
        await run([process.execPath, 'run', 'bin/build.ts', '--version', SAMPLE[kind], '--outdir', join(out, `core-${kind}`)], join(root, 'packages', 'core'));
        findings.push(...check(join(out, `ui-${kind}`), 'ui', kind), ...check(join(out, `core-${kind}`), 'core', kind));
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  } else {
    const version = option('--version') ?? (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const kind = buildKindOf(version);
    console.log(`feature cut: ${version} is a ${kind} build`);
    findings.push(...check(resolve(option('--ui') ?? join(root, 'packages', 'ui', 'dist')), 'ui', kind), ...check(resolve(option('--core') ?? join(root, 'packages', 'core', 'dist')), 'core', kind));
  }
  if (findings.length) console.error(`feature cut: ${findings.length} problem(s)`);
  return findings.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
