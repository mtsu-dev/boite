import { composerActivity as parse } from '@boite/contracts';
import { autoGoalCode } from './auto-goal-entry.ts';
import { invalidParams } from './errors.ts';
export { isComposerActivity } from '@boite/contracts';

export function composerActivity(text: string) {
  try { return parse(text); }
  catch (error) { throw invalidParams(error instanceof Error ? error.message : String(error)); }
}

/**
 * Whether a prompt that starts a turn also starts an automatic reviewed goal
 * (`auto-goal.ts`, behind its experiment's build flag). Never in a build
 * without automatic goals.
 */
export function startsAutoGoal(text: string, experiments: readonly string[] | null | undefined, minChars?: number): boolean {
  return autoGoalCode()?.startsAutoGoal(text, experiments, minChars) ?? false;
}
