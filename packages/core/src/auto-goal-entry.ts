/**
 * The one way to the automatic goals' code (`auto-goal.ts`). The flag is
 * written in full because a bundler folds nothing less direct
 * (`packages/contracts/src/experiments.ts`): in a build below the
 * experiment's tag it is `false`, the `require` is dropped and the bundle
 * does not hold the module. From source and in tests it is not defined.
 * `require` and not `import()`: a prompt is admitted in one synchronous step.
 *
 * Null in a build without them: no prompt starts a goal by itself there, and
 * `boite goal track` is refused with the tag and the build
 * (docs/internals/experiments.md#out-of-the-build).
 */
export function autoGoalCode(): typeof import('./auto-goal.ts') | null {
  if (typeof __BOITE_HAS_AUTO_GOAL__ === 'undefined' || __BOITE_HAS_AUTO_GOAL__) return require('./auto-goal.ts') as typeof import('./auto-goal.ts');
  return null;
}
