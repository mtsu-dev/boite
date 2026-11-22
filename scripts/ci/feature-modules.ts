/**
 * The modules of each cut feature, by bundle: everything its lazy entry
 * loads and nothing else imports. Each calls `markFeature` with its marker at
 * its top level (docs/internals/experiments.md#the-proof), and
 * `feature-cut.test.ts` checks that and fails on a file of a feature's
 * directory that is neither here nor in `STAYS`.
 *
 * The five features cut before this one (the Whip, the Council, Contacts,
 * Teams and Automatic goals) are finished and left the list.
 */
import type { ExperimentId } from '../../packages/contracts/src/experiments.ts';

export const FEATURE_MODULES: Partial<Record<ExperimentId, { ui: string[]; core: string[] }>> = {
  'draft-backdrop': {
    ui: [
      'packages/ui/src/components/backdrop/BackdropPicker.svelte',
      'packages/ui/src/components/backdrop/DraftBackdrop.svelte',
      'packages/ui/src/lib/backdrop/batch.ts',
      'packages/ui/src/lib/backdrop/choice.svelte.ts',
      'packages/ui/src/lib/backdrop/engine.ts',
      'packages/ui/src/lib/backdrop/feature.ts',
      'packages/ui/src/lib/backdrop/math.ts',
      'packages/ui/src/lib/backdrop/scenes.ts',
    ],
    core: [],
  },
};

/** The directories that belong to one feature: a new file there must be listed above, or below with its reason. */
export const FEATURE_DIRECTORIES: Partial<Record<ExperimentId, string[]>> = {
  'draft-backdrop': ['packages/ui/src/components/backdrop', 'packages/ui/src/lib/backdrop'],
};

/** Files of those directories that every build holds. */
export const STAYS: Record<string, string> = {};
