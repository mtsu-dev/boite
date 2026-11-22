/*
 * Feature tags and the builds a feature exists in. Every feature has one tag,
 * written here and nowhere else:
 *
 * - `release`: finished. On in every build, with no switch on the Experiments
 *   page. An id stays listed until the checks that read it are deleted.
 * - `nightly`: may change or go away. A switch in a Nightly and in a Dev
 *   build; it does not exist in a Release, whatever a device stored.
 * - `dev`: being built. A switch in a Dev build (a build from source, the
 *   app "Boite Dev") and nowhere else.
 *
 * A build has a kind too (`buildKindOf`), and a feature exists in a build
 * whose kind is at or above its tag (`stageRuns`). Promoting a feature is one
 * line of `EXPERIMENT_STAGES`. The app and the core both read their answer
 * from here, each for the build it is: a core never trusts an app's word that
 * a feature is available (`effectiveExperiments`). A packaged build also
 * knows its kind when it is compiled and leaves the code of the features
 * above it out of its bundles (`featureDefines`, `FEATURE_CUTS`). See
 * docs/internals/experiments.md.
 */

/**
 * The switches this build knows, in the order Settings lists them. A finished
 * feature leaves this list once nothing reads its id: an app or a core that
 * hears an id it does not know drops it.
 */
export const EXPERIMENT_IDS = ['resident-agents', 'draft-backdrop'] as const;
export type ExperimentId = (typeof EXPERIMENT_IDS)[number];

/**
 * Finished features that left `EXPERIMENT_IDS`, which an app older than this
 * core still gates on. The core names them in what it tells apps of the
 * desktop app they follow (`withFinished`), as a core from before their
 * removal did, so a phone that has not updated yet keeps showing them; a
 * current app drops them as unknown ids.
 */
export const FINISHED_EXPERIMENT_IDS = ['whip', 'contacts', 'auto-goal', 'teams', 'debates', 'theme-grain', 'session-import', 'prompt-cache', 'recording-indicators', 'pinned-quotas'] as const;
export type FinishedExperimentId = (typeof FINISHED_EXPERIMENT_IDS)[number];

/** A desktop app's list as the core hands it to apps: these ids plus every finished one (`FINISHED_EXPERIMENT_IDS`). */
export function withFinished(experiments: readonly ExperimentId[]): (ExperimentId | FinishedExperimentId)[] {
  return [...experiments, ...FINISHED_EXPERIMENT_IDS];
}

export function isExperimentId(id: unknown): id is ExperimentId {
  return typeof id === 'string' && (EXPERIMENT_IDS as readonly string[]).includes(id);
}

/** The three kinds of build, lowest first. A feature's tag is the lowest kind it exists in. */
export const BUILD_KINDS = ['release', 'nightly', 'dev'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export type FeatureStage = BuildKind;

export const EXPERIMENT_STAGES: Record<ExperimentId, FeatureStage> = {
  'resident-agents': 'release',
  'draft-backdrop': 'nightly',
};

/**
 * The kind of the build with this version, the one rule both sides read:
 *
 * - a Release carries a plain version (`2.0.0`);
 * - a Nightly carries the prerelease CI stamps (`2.0.0-nightly.20261111.1`);
 * - any other prerelease is a Dev build: a build from source (`2.0.0-beta.1`),
 *   the app "Boite Dev", a test core (`2.0.0-test.0`).
 *
 * An unknown version reads as a Release: nothing unfinished shows by accident.
 */
export function buildKindOf(version: string | null | undefined): BuildKind {
  const dash = version ? version.indexOf('-') : -1;
  if (!version || dash < 0) return 'release';
  return /^nightly(?:\.|$)/.test(version.slice(dash + 1)) ? 'nightly' : 'dev';
}

/** Whether a feature tagged `stage` exists in a build of this kind: the kind is at or above the tag. */
export function stageRuns(stage: FeatureStage, kind: BuildKind): boolean {
  return BUILD_KINDS.indexOf(kind) >= BUILD_KINDS.indexOf(stage);
}

/** How a message names a kind of build. */
export const BUILD_KIND_NAMES: Record<BuildKind, string> = { release: 'Release', nightly: 'Nightly', dev: 'Dev' };

/**
 * What a refusal says after the feature's name: the builds that have it
 * ("runs in Nightly and Dev builds only", "runs in Dev builds only"), the
 * build this one is and the way to one that has it.
 */
function refusalTail(stage: FeatureStage, version: string | null | undefined): string {
  const kind = buildKindOf(version);
  const article = kind === 'release' ? 'a Release' : `a ${BUILD_KIND_NAMES[kind]}`;
  const way = stage === 'nightly' ? 'switch the update channel to Nightly in Settings > Machines and updates to try it' : 'it is still being built and no published build has it';
  const builds = BUILD_KINDS.filter((each) => stageRuns(stage, each)).map((each) => BUILD_KIND_NAMES[each]).join(' and ');
  return `runs in ${builds} builds only, and this machine runs ${article} (${version || 'unknown version'}): ${way}`;
}

/*
 * What a packaged build knows when it is compiled. The UI build (Vite) and
 * the core bundle (Bun) both receive `featureDefines(version)` for the
 * stamped version: `__BOITE_BUILD_KIND__`, the one constant, and one boolean
 * per feature derived from it and from `EXPERIMENT_STAGES`. Under `bun run`
 * from source and in tests nothing is defined and the run-time rule decides.
 *
 * A bundler only drops code behind an expression it can fold, and neither
 * Bun nor Rolldown folds a call or a constant imported from another module.
 * So the lazy entry of a feature writes its flag directly:
 *
 *   if (typeof __BOITE_HAS_SAMPLE__ === 'undefined' || __BOITE_HAS_SAMPLE__) await import('./sample')
 *
 * With the flag defined as `false` the branch and its dynamic import go, and
 * the feature's modules are in no chunk. A feature with a cut declares its
 * flag below.
 */
declare global {
  const __BOITE_BUILD_KIND__: BuildKind | undefined;
  const __BOITE_HAS_DRAFT_BACKDROP__: boolean | undefined;
}

/** The kind this bundle was compiled as, or null when it runs from source. */
export const COMPILED_BUILD_KIND: BuildKind | null = typeof __BOITE_BUILD_KIND__ === 'string' ? __BOITE_BUILD_KIND__ : null;

/** Whether this bundle was compiled with the code of `id`. Always true from source. */
export function featureCompiled(id: ExperimentId, compiled: BuildKind | null = COMPILED_BUILD_KIND): boolean {
  return compiled === null || stageRuns(EXPERIMENT_STAGES[id], compiled);
}

/** The name of the compile-time flag of a feature: `auto-goal` gives `__BOITE_HAS_AUTO_GOAL__`. */
export function featureFlag(id: ExperimentId): string {
  return `__BOITE_HAS_${id.toUpperCase().replaceAll('-', '_')}__`;
}

/** The constants a bundler defines for the build with this version (Vite `define`, `bun build --define`). */
export function featureDefines(version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): Record<string, string> {
  const kind = buildKindOf(version);
  return {
    __BOITE_BUILD_KIND__: JSON.stringify(kind),
    ...Object.fromEntries(EXPERIMENT_IDS.filter(id => stages[id] !== 'release').map(id => [featureFlag(id), String(stageRuns(stages[id], kind))])),
  };
}

/**
 * The features whose code a build below their tag leaves out, and of which
 * bundle. Each of them writes its marker, the literal `featureMarker(id)`
 * gives, in the module its lazy entry loads; `scripts/ci/feature-cut.ts`
 * fails a build whose bundle holds the marker of a feature above its kind,
 * and one that lost the marker of a feature it must hold. The new thread
 * background is drawn by the app alone, so the core has nothing of it to cut.
 */
export const FEATURE_CUTS: Partial<Record<ExperimentId, { ui: boolean; core: boolean }>> = {
  'draft-backdrop': { ui: true, core: false },
};

const MARKED: string[] = [];

/**
 * Every module of a cut feature calls this at its top level with its marker
 * written out. A call with an effect is never dropped by a bundler, unlike an
 * unused constant, so a module that reaches a bundle carries its marker there
 * however it was imported.
 */
export function markFeature(marker: string): void {
  MARKED.push(marker);
}

/** The marker of a feature's code in a bundle. Built here from two parts, so this file never carries one. */
export function featureMarker(id: ExperimentId): string {
  return ['boite-feature', id].join(':');
}

/** Whether the build with this version is a Release. */
export function isReleaseVersion(version: string | null | undefined): boolean {
  return buildKindOf(version) === 'release';
}

/** Whether the build with this version has a feature tagged `stage` (default: the nightly tag). */
export function experimentsRun(version: string | null | undefined, stage: FeatureStage = 'nightly'): boolean {
  return stageRuns(stage, buildKindOf(version));
}

/** Whether the feature `id` exists in the build with this version: its kind is at or above the feature's tag, and the bundle was compiled with it. */
export function featureRuns(id: ExperimentId, version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): boolean {
  return stageRuns(stages[id], buildKindOf(version)) && (stages !== EXPERIMENT_STAGES || featureCompiled(id));
}

/** Whether the build with this version shows a switch for `id`. */
export function experimentListed(id: ExperimentId, version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): boolean {
  return stages[id] !== 'release' && featureRuns(id, version, stages);
}

/** The switches the build with this version shows, in the listed order. */
export function listedExperiments(version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): ExperimentId[] {
  return EXPERIMENT_IDS.filter(id => experimentListed(id, version, stages));
}

/**
 * What is on in the build with this version, given the switches a device
 * turned on: every finished feature, and the chosen ones whose tag the build
 * reaches.
 */
export function effectiveExperiments(chosen: readonly string[], version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): ExperimentId[] {
  return EXPERIMENT_IDS.filter(id => stages[id] === 'release' || (chosen.includes(id) && featureRuns(id, version, stages)));
}

/** Why the build with this version has no switch for `id`, or null when it has one. */
export function experimentRefusal(id: ExperimentId, version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): string | null {
  if (stages[id] === 'release') return `experiment.${id} is no longer an experiment: it is on in every build and has no switch`;
  return featureRuns(id, version, stages) ? null : `experiment.${id} ${refusalTail(stages[id], version)}`;
}

/** Why the build with this version starts nothing new in the experiment `id`, or null where experiments run. What exists can still be read and removed. */
export function experimentStartRefusal(id: ExperimentId, version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): string | null {
  return stages[id] === 'release' ? null : experimentRefusal(id, version, stages);
}
