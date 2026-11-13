import type { Settings } from './settings.ts';

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

/** The switches this build knows, in the order Settings lists them. */
export const EXPERIMENT_IDS = ['theme-grain', 'session-import', 'prompt-cache', 'resident-agents', 'whip', 'recording-indicators', 'contacts', 'pinned-quotas', 'auto-goal', 'teams', 'debates'] as const;
export type ExperimentId = (typeof EXPERIMENT_IDS)[number];

export function isExperimentId(id: unknown): id is ExperimentId {
  return typeof id === 'string' && (EXPERIMENT_IDS as readonly string[]).includes(id);
}

/** The three kinds of build, lowest first. A feature's tag is the lowest kind it exists in. */
export const BUILD_KINDS = ['release', 'nightly', 'dev'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export type FeatureStage = BuildKind;

export const EXPERIMENT_STAGES: Record<ExperimentId, FeatureStage> = {
  'theme-grain': 'release',
  'session-import': 'release',
  'prompt-cache': 'release',
  'resident-agents': 'release',
  whip: 'nightly',
  'recording-indicators': 'release',
  contacts: 'nightly',
  'pinned-quotas': 'release',
  'auto-goal': 'nightly',
  teams: 'nightly',
  debates: 'nightly',
};

/** The tag of the three core settings that are experiments (`EXPERIMENTAL_SETTINGS`). */
export const EXPERIMENTAL_SETTINGS_STAGE: FeatureStage = 'nightly';

/** Core settings that are experiments, with the value each reads as in a build below their tag. */
export const EXPERIMENTAL_SETTINGS = { cacheKeepalive: null, backgroundCompaction: false, deviceStream: false } as const satisfies Partial<Settings>;
export type ExperimentalSetting = keyof typeof EXPERIMENTAL_SETTINGS;

export function isExperimentalSetting(key: string): key is ExperimentalSetting {
  return Object.hasOwn(EXPERIMENTAL_SETTINGS, key);
}

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
  const way = stage === 'nightly' ? 'switch the update channel to Nightly in Settings > Updates to try it' : 'it is still being built and no published build has it';
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
 *   if (typeof __BOITE_HAS_WHIP__ === 'undefined' || __BOITE_HAS_WHIP__) await import('./whip')
 *
 * With the flag defined as `false` the branch and its dynamic import go, and
 * the feature's modules are in no chunk.
 */
declare global {
  const __BOITE_BUILD_KIND__: BuildKind | undefined;
  const __BOITE_HAS_WHIP__: boolean | undefined;
  const __BOITE_HAS_DEBATES__: boolean | undefined;
  const __BOITE_HAS_AUTO_GOAL__: boolean | undefined;
  const __BOITE_HAS_TEAMS__: boolean | undefined;
  const __BOITE_HAS_CONTACTS__: boolean | undefined;
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
 * and one that lost the marker of a feature it must hold.
 */
export const FEATURE_CUTS: Partial<Record<ExperimentId, { ui: boolean; core: boolean }>> = {
  // The Whip has no core side.
  whip: { ui: true, core: false },
  // Council: the card and the salon in the UI; in the core the `boite delegate council` command only (the store and the RPC methods stay).
  debates: { ui: true, core: true },
  // Contacts: the page, the column, the rows and the shared project screens in the UI. The core keeps it whole: a Release still reads and revokes what a Nightly left.
  contacts: { ui: true, core: false },
  // Teams: the chat, the dialog, the header and the request card in the UI; in the core the store, its peers and snapshots, the RPC methods and `boite team` (the tables and the letters' team fields stay).
  teams: { ui: true, core: true },
};

/** The marker of a feature's code in a bundle. Built here from two parts, so this file never carries one. */
export function featureMarker(id: ExperimentId): string {
  return ['boite-feature', id].join(':');
}

/** Whether the build with this version is a Release. */
export function isReleaseVersion(version: string | null | undefined): boolean {
  return buildKindOf(version) === 'release';
}

/** Whether the build with this version has a feature tagged `stage` (default: the nightly tag, which every experiment today carries). */
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

/** Why a settings patch is refused in the build with this version: it turns on a setting that is an experiment. */
export function experimentalSettingRefusal(patch: Partial<Settings>, version: string | null | undefined): { key: ExperimentalSetting; message: string } | null {
  if (experimentsRun(version, EXPERIMENTAL_SETTINGS_STAGE)) return null;
  const refuse = (key: ExperimentalSetting) => ({ key, message: `${key} is an experiment: it ${refusalTail(EXPERIMENTAL_SETTINGS_STAGE, version).split(': ')[0]}` });
  if (patch.cacheKeepalive !== undefined && patch.cacheKeepalive !== null) return refuse('cacheKeepalive');
  if (patch.backgroundCompaction === true) return refuse('backgroundCompaction');
  if (patch.deviceStream === true) return refuse('deviceStream');
  if (Object.values(patch.compactionByType ?? {}).some(policy => policy?.backgroundCompaction === true)) return refuse('backgroundCompaction');
  return null;
}

/**
 * The settings in force in the build with this version: where experiments do
 * not run, the ones that are experiments read as off. The stored choice is
 * left alone, so a machine that goes back to a Nightly finds it again.
 */
export function holdExperimentalSettings<T extends Partial<Settings>>(settings: T, version: string | null | undefined): T {
  if (experimentsRun(version, EXPERIMENTAL_SETTINGS_STAGE)) return settings;
  const held: T = { ...settings };
  if (settings.cacheKeepalive !== undefined) held.cacheKeepalive = EXPERIMENTAL_SETTINGS.cacheKeepalive;
  if (settings.backgroundCompaction !== undefined) held.backgroundCompaction = EXPERIMENTAL_SETTINGS.backgroundCompaction;
  if (settings.deviceStream !== undefined) held.deviceStream = EXPERIMENTAL_SETTINGS.deviceStream;
  if (settings.compactionByType !== undefined) {
    held.compactionByType = Object.fromEntries(Object.entries(settings.compactionByType).map(([target, policy]) => [target, policy === undefined ? policy : { ...policy, backgroundCompaction: false }])) as NonNullable<Settings['compactionByType']>;
  }
  return held;
}

/**
 * The patch a save stores in the build with this version. Where experiments
 * do not run, the app only knows the values `holdExperimentalSettings` reads
 * as off, and a save hands them back: the settings that are experiments stay
 * as `stored` has them, so no Release writes "off" over a Nightly's choice. A
 * type customized for the first time takes the common stored choice, the one
 * it followed until then.
 */
export function keepStoredExperimentalSettings(stored: Partial<Settings>, patch: Partial<Settings>, version: string | null | undefined): Partial<Settings> {
  if (experimentsRun(version, EXPERIMENTAL_SETTINGS_STAGE)) return patch;
  const kept = { ...patch };
  for (const key of Object.keys(EXPERIMENTAL_SETTINGS) as ExperimentalSetting[]) Reflect.deleteProperty(kept, key);
  if (patch.compactionByType !== undefined) {
    kept.compactionByType = Object.fromEntries(Object.entries(patch.compactionByType).map(([target, policy]) => [target, policy === undefined ? policy
      : { ...policy, backgroundCompaction: stored.compactionByType?.[target as keyof NonNullable<Settings['compactionByType']>]?.backgroundCompaction ?? stored.backgroundCompaction === true }])) as NonNullable<Settings['compactionByType']>;
  }
  return kept;
}

/** Why the build with this version starts nothing new in the experiment `id`, or null where experiments run. What exists can still be read and removed. */
export function experimentStartRefusal(id: ExperimentId, version: string | null | undefined, stages: Record<ExperimentId, FeatureStage> = EXPERIMENT_STAGES): string | null {
  return stages[id] === 'release' ? null : experimentRefusal(id, version, stages);
}
