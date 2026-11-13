/**
 * The modules of each cut feature, by bundle: everything its lazy entry
 * loads and nothing else imports. Each calls `markFeature` with its marker at
 * its top level (docs/internals/experiments.md#the-proof), and
 * `feature-cut.test.ts` checks that, bundles one of each for real, and fails
 * on a file of a feature's directory that is neither here nor in `STAYS`.
 */
import type { ExperimentId } from '../../packages/contracts/src/experiments.ts';

export const FEATURE_MODULES: Partial<Record<ExperimentId, { ui: string[]; core: string[] }>> = {
  whip: {
    ui: [
      'packages/ui/src/components/WhipButton.svelte',
      'packages/ui/src/components/WhipOverlay.svelte',
      'packages/ui/src/lib/whip.svelte.ts',
      'packages/ui/src/lib/whip/crack.ts',
      'packages/ui/src/lib/whip/feature.ts',
      'packages/ui/src/lib/whip/physics.ts',
      'packages/ui/src/lib/whip/shake.ts',
    ],
    core: [],
  },
  debates: {
    ui: [
      'packages/ui/src/components/council/CouncilAvatar.svelte',
      'packages/ui/src/components/council/CouncilCard.svelte',
      'packages/ui/src/components/council/CouncilSalon.svelte',
      'packages/ui/src/lib/council.svelte.ts',
    ],
    core: [
      'packages/core/src/council/cli.ts',
      'packages/core/src/council/prompt.ts',
      'packages/core/src/council/rpc.ts',
      'packages/core/src/council/store.ts',
    ],
  },
  contacts: {
    ui: [
      'packages/ui/src/components/home/AddContact.svelte',
      'packages/ui/src/components/home/ContactInboxRows.svelte',
      'packages/ui/src/components/home/ContactPage.svelte',
      'packages/ui/src/components/home/ContactRequestNotice.svelte',
      'packages/ui/src/components/home/ContactRows.svelte',
      'packages/ui/src/components/home/ContactSettings.svelte',
      'packages/ui/src/components/home/ContactsRail.svelte',
      'packages/ui/src/components/home/FingerprintWords.svelte',
      'packages/ui/src/components/home/HomePage.svelte',
      'packages/ui/src/components/home/MailCard.svelte',
      'packages/ui/src/components/home/OperatorCard.svelte',
      'packages/ui/src/components/home/RequestCard.svelte',
      'packages/ui/src/components/home/SidebarContacts.svelte',
      'packages/ui/src/components/home/ThreadChoice.svelte',
      'packages/ui/src/components/shared/SharedAssociations.svelte',
      'packages/ui/src/components/shared/SharedCompute.svelte',
      'packages/ui/src/components/shared/SharedDialog.svelte',
      'packages/ui/src/components/shared/SharedHostSettings.svelte',
      'packages/ui/src/components/shared/SharedProjectDialog.svelte',
      'packages/ui/src/components/shared/SharedProjectThreads.svelte',
      'packages/ui/src/components/shared/SharedProtection.svelte',
      'packages/ui/src/components/shared/SharedThreadDialog.svelte',
      'packages/ui/src/lib/contact-accept.ts',
      'packages/ui/src/lib/contact-inbox.ts',
      'packages/ui/src/lib/contacts.svelte.ts',
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
  'auto-goal': {
    ui: [
      'packages/ui/src/components/AutoGoalSetting.svelte',
    ],
    core: [
      'packages/core/src/auto-goal.ts',
    ],
  },
};

/** The directories that belong to one feature: a new file there must be listed above, or below with its reason. */
export const FEATURE_DIRECTORIES: Partial<Record<ExperimentId, string[]>> = {
  debates: ['packages/ui/src/components/council', 'packages/core/src/council'],
  contacts: ['packages/ui/src/components/home', 'packages/ui/src/components/shared'],
  teams: ['packages/ui/src/components/teams', 'packages/core/src/teams'],
};

/** Files of those directories that every build holds. */
export const STAYS: Record<string, string> = {
  'packages/core/src/council/journal.ts': 'the tables, created in every build by journal/schema.ts',
  'packages/core/src/teams/journal.ts': 'the tables, created in every build by journal/schema.ts',
  'packages/ui/src/components/shared/SharedProjectThreadsLoader.svelte': 'the loader the list draws: it holds the gate, not the rows',
};
