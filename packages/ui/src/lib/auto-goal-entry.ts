/** The threshold control, loaded only in builds that include automatic goals. */
export function loadAutoGoalSetting(): Promise<typeof import('../components/AutoGoalSetting.svelte')> | null {
  if (typeof __BOITE_HAS_AUTO_GOAL__ === 'undefined' || __BOITE_HAS_AUTO_GOAL__) return import('../components/AutoGoalSetting.svelte');
  return null;
}
