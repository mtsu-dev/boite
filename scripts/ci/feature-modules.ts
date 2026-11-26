/**
 * The modules of each cut feature, by bundle: everything its lazy entry
 * loads and nothing else imports. Each calls `markFeature` with its marker at
 * its top level (docs/internals/experiments.md#the-proof), and
 * `feature-cut.test.ts` checks that and fails on a file of a feature's
 * directory that is neither here nor in `STAYS`.
 *
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
  teams: {
    ui: [
      'packages/ui/src/components/TeamCard.svelte',
      'packages/ui/src/components/teams/TeamChat.svelte',
      'packages/ui/src/components/teams/TeamComposer.svelte',
      'packages/ui/src/components/teams/TeamDialog.svelte',
      'packages/ui/src/components/teams/TeamHeader.svelte',
      'packages/ui/src/lib/team-draft.ts',
    ],
    core: [
      'packages/core/src/teams/mirror.ts',
      'packages/core/src/teams/peers.ts',
      'packages/core/src/teams/prompt.ts',
      'packages/core/src/teams/rpc.ts',
      'packages/core/src/teams/snapshots.ts',
      'packages/core/src/teams/store.ts',
      'packages/core/src/team-cli.ts',
    ],
  },
};

/** The directories that belong to one feature: a new file there must be listed above, or below with its reason. */
export const FEATURE_DIRECTORIES: Partial<Record<ExperimentId, string[]>> = {
  'draft-backdrop': ['packages/ui/src/components/backdrop', 'packages/ui/src/lib/backdrop'],
  teams: ['packages/ui/src/components/teams', 'packages/core/src/teams'],
};

/** Files of those directories that every build holds. */
export const STAYS: Record<string, string> = {
  'packages/core/src/teams/journal.ts': 'the tables, created in every build by journal/schema.ts',
  'packages/core/src/teams/records.ts': 'existing records can be read and removed in a Release',
  'packages/core/src/teams/record-peers.ts': 'authenticated group reads and removals of existing records',
};
