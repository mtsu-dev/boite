/**
 * The way to the Council's code: its salon here, and its card in a thread
 * among the deferred parts (`lib/deferred-parts.ts`, which the salon's own
 * modules import, so the card's import cannot sit here without a cycle).
 * Each flag is written in full because a bundler folds nothing less direct
 * (`packages/contracts/src/experiments.ts`): in a build below the Council's
 * tag it is `false`, the imports below are dropped and no chunk holds the
 * Council. From source and in tests it is not defined.
 */

/** Whether this bundle holds the Council. */
export function councilBuilt(): boolean {
  return typeof __BOITE_HAS_DEBATES__ === 'undefined' || __BOITE_HAS_DEBATES__;
}

/** The salon, in the panel or as a thread, or null in a build without the Council. */
export function loadCouncilSalon(): Promise<typeof import('../components/council/CouncilSalon.svelte')> | null {
  if (typeof __BOITE_HAS_DEBATES__ === 'undefined' || __BOITE_HAS_DEBATES__) return import('../components/council/CouncilSalon.svelte');
  return null;
}
