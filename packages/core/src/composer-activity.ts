import { composerActivity as parse, type Settings } from '@boite/contracts';
import { autoGoalCode } from './auto-goal-entry.ts';
import { invalidParams } from './errors.ts';
export { isComposerActivity } from '@boite/contracts';

export function composerActivity(text: string) {
  try { return parse(text); }
  catch (error) { throw invalidParams(error instanceof Error ? error.message : String(error)); }
}

/**
 * Whether a prompt that starts a turn also starts an automatic reviewed goal
 * (`auto-goal.ts`, through its lazy entry), with the machine's settings.
 */
export function startsAutoGoal(text: string, settings: Pick<Settings, 'autoGoals' | 'autoGoalMinChars'>): boolean {
  return autoGoalCode()?.startsAutoGoal(text, settings) ?? false;
}
