import type { Settings } from './settings';

/*
 * Unfinished work and where it may run. Every switch has one stage, written
 * here and nowhere else:
 *
 * - `normal`: finished. On in every build, with no switch on the Experiments
 *   page. An id stays listed until the checks that read it are deleted.
 * - `experimental`: may change or go away. It has a switch in a Nightly or a
 *   source build and does not exist in a Release, whatever a device stored.
 *
 * Moving a feature to the next stage is one line of `EXPERIMENT_STAGES`. The
 * app and the core both read their answer from here, each for the build it
 * is: a core never trusts an app's word that an experiment is available
 * (`effectiveExperiments`). See docs/internals/experiments.md.
 */

/** The switches this build knows, in the order Settings lists them. */
export const EXPERIMENT_IDS = ['theme-grain', 'session-import', 'prompt-cache', 'resident-agents', 'whip', 'recording-indicators', 'contacts', 'pinned-quotas', 'auto-goal', 'teams', 'debates'] as const;
export type ExperimentId = (typeof EXPERIMENT_IDS)[number];

export function isExperimentId(id: unknown): id is ExperimentId {
  return typeof id === 'string' && (EXPERIMENT_IDS as readonly string[]).includes(id);
}

export type FeatureStage = 'normal' | 'experimental';

export const EXPERIMENT_STAGES: Record<ExperimentId, FeatureStage> = {
  'theme-grain': 'normal',
  'session-import': 'normal',
  'prompt-cache': 'normal',
  'resident-agents': 'normal',
  whip: 'experimental',
  'recording-indicators': 'normal',
  contacts: 'experimental',
  'pinned-quotas': 'normal',
  'auto-goal': 'experimental',
  teams: 'experimental',
  debates: 'experimental',
};

/** Core settings that are experiments, with the value each reads as where experiments do not run. */
export const EXPERIMENTAL_SETTINGS = { cacheKeepalive: null, backgroundCompaction: false, deviceStream: false } as const satisfies Partial<Settings>;
export type ExperimentalSetting = keyof typeof EXPERIMENTAL_SETTINGS;

export function isExperimentalSetting(key: string): key is ExperimentalSetting {
  return Object.hasOwn(EXPERIMENTAL_SETTINGS, key);
}

/**
 * A Release carries a plain version (`2.0.0`). A Nightly (`2.0.0-nightly.20261111.1`)
 * and a build from source (`2.0.0-beta.1`) carry a prerelease part. An unknown
 * version reads as a Release: nothing unfinished shows by accident.
 */
export function isReleaseVersion(version: string | null | undefined): boolean {
  return !version?.includes('-');
}

/** Whether experiments run in the build with this version. */
export function experimentsRun(version: string | null | undefined): boolean {
  return !isReleaseVersion(version);
}

/** Whether the build with this version shows a switch for `id`. */
export function experimentListed(id: ExperimentId, version: string | null | undefined): boolean {
  return EXPERIMENT_STAGES[id] === 'experimental' && experimentsRun(version);
}

/** The switches the build with this version shows, in the listed order. */
export function listedExperiments(version: string | null | undefined): ExperimentId[] {
  return EXPERIMENT_IDS.filter(id => experimentListed(id, version));
}

/**
 * What is on in the build with this version, given the switches a device
 * turned on: every finished feature, and the experiments it chose where
 * experiments run.
 */
export function effectiveExperiments(chosen: readonly string[], version: string | null | undefined): ExperimentId[] {
  const run = experimentsRun(version);
  return EXPERIMENT_IDS.filter(id => EXPERIMENT_STAGES[id] === 'normal' || (run && chosen.includes(id)));
}

/** Why the build with this version has no switch for `id`, or null when it has one. */
export function experimentRefusal(id: ExperimentId, version: string | null | undefined): string | null {
  if (EXPERIMENT_STAGES[id] === 'normal') return `experiment.${id} is no longer an experiment: it is on in every build and has no switch`;
  return experimentsRun(version) ? null : `experiment.${id} runs in Nightly builds only, and this machine runs a Release (${version || 'unknown version'}): switch the update channel to Nightly in Settings > Updates to try it`;
}

/** Why a settings patch is refused in the build with this version: it turns on a setting that is an experiment. */
export function experimentalSettingRefusal(patch: Partial<Settings>, version: string | null | undefined): { key: ExperimentalSetting; message: string } | null {
  if (experimentsRun(version)) return null;
  const refuse = (key: ExperimentalSetting) => ({ key, message: `${key} is an experiment: it runs in Nightly builds only, and this machine runs a Release (${version || 'unknown version'})` });
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
  if (experimentsRun(version)) return settings;
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
  if (experimentsRun(version)) return patch;
  const kept = { ...patch };
  for (const key of Object.keys(EXPERIMENTAL_SETTINGS) as ExperimentalSetting[]) Reflect.deleteProperty(kept, key);
  if (patch.compactionByType !== undefined) {
    kept.compactionByType = Object.fromEntries(Object.entries(patch.compactionByType).map(([target, policy]) => [target, policy === undefined ? policy
      : { ...policy, backgroundCompaction: stored.compactionByType?.[target as keyof NonNullable<Settings['compactionByType']>]?.backgroundCompaction ?? stored.backgroundCompaction === true }])) as NonNullable<Settings['compactionByType']>;
  }
  return kept;
}

/** Why the build with this version starts nothing new in the experiment `id`, or null where experiments run. What exists can still be read and removed. */
export function experimentStartRefusal(id: ExperimentId, version: string | null | undefined): string | null {
  return EXPERIMENT_STAGES[id] === 'normal' ? null : experimentRefusal(id, version);
}
