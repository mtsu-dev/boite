/**
 * The one way to the automatic goals' code (`auto-goal.ts`), loaded on first
 * use so nothing of it runs at core startup. `require` and not `import()`: a
 * prompt is admitted in one synchronous step.
 */
export function autoGoalCode(): typeof import('./auto-goal.ts') {
  return require('./auto-goal.ts') as typeof import('./auto-goal.ts');
}
