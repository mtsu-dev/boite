/**
 * The way to the automatic goals' setting, the threshold under their switch
 * on the Experiments page. The flag is written in full because a bundler
 * folds nothing less direct (`packages/contracts/src/experiments.ts`): in a
 * build below the experiment's tag it is `false`, the import is dropped and
 * no chunk holds the setting. From source and in tests it is not defined.
 */
export function loadAutoGoalSetting(): Promise<typeof import('../components/AutoGoalSetting.svelte')> | null {
  if (typeof __BOITE_HAS_AUTO_GOAL__ === 'undefined' || __BOITE_HAS_AUTO_GOAL__) return import('../components/AutoGoalSetting.svelte');
  return null;
}
