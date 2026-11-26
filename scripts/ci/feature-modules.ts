/**
 * The modules of each cut feature, by bundle: everything its lazy entry
 * loads and nothing else imports. Each calls `markFeature` with its marker at
 * its top level (docs/internals/experiments.md#the-proof), and
 * `feature-cut.test.ts` checks that and fails on a file of a feature's
 * directory that is neither here nor in `STAYS`.
 */
import type { ExperimentId } from '../../packages/contracts/src/experiments.ts';

export const FEATURE_MODULES: Partial<Record<ExperimentId, { ui: string[]; core: string[] }>> = {
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
  contacts: ['packages/ui/src/components/home', 'packages/ui/src/components/shared'],
  'draft-backdrop': ['packages/ui/src/components/backdrop', 'packages/ui/src/lib/backdrop'],
};

/** Files of those directories that every build holds. */
export const STAYS: Record<string, string> = {
  'packages/ui/src/components/shared/SharedProjectThreadsLoader.svelte': 'renders local threads even when the shared rows are absent',
};
