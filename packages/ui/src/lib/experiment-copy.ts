import type { ExperimentId } from './experiments';
import { strings } from './strings';

/**
 * The title and hint of every experiment that has a switch, in the language
 * the app speaks when this is called. A finished feature has no switch and no
 * entry (`EXPERIMENT_STAGES` in contracts); `experiment-copy.test.ts` fails
 * when an experimental id lands without its words. The Settings nav lists the
 * same rows as the page.
 */
export function experimentCopy(): Partial<Record<ExperimentId, { title: string; hint: string }>> {
  return {
    whip: strings.experiments.whip,
    contacts: strings.experiments.contacts,
    'auto-goal': strings.experiments.autoGoal,
    teams: strings.experiments.teams,
    debates: strings.experiments.debates
  };
}
