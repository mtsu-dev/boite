/**
 * The one way to the automatic goals' code (`auto-goal.ts`), loaded on first
 * use. The direct flag lets the bundler drop the require in Release builds.
 * A prompt is admitted synchronously, so this uses require.
 */
export function autoGoalCode(): typeof import('./auto-goal.ts') | null {
  if (typeof __BOITE_HAS_AUTO_GOAL__ === 'undefined' || __BOITE_HAS_AUTO_GOAL__) {
    return require('./auto-goal.ts') as typeof import('./auto-goal.ts');
  }
  return null;
}
