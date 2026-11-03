/*
 * The reactive face of `experiments.ts`: one `$state` mirror of the enabled
 * ids, kept in step by the subscription, so a component or a derived list can
 * ask `experimentOn(id)` and follow the switch on the Experiments page without
 * a reload. `experiments.ts` stays rune-free so the theme module and the tests
 * can import it from anywhere.
 */

import { readExperiments, subscribeExperiments, type ExperimentId } from './experiments';

const mirror = $state<{ enabled: ExperimentId[] }>({ enabled: readExperiments() });

subscribeExperiments((enabled) => {
  mirror.enabled = enabled;
});

/** Whether an experiment is on, tracked by whoever reads it inside a rune. */
export function experimentOn(id: ExperimentId): boolean {
  return mirror.enabled.includes(id);
}

/**
 * Whether a thread opens on the Bots page: a bot's own thread, and a team's
 * chat while Teams is on. With Bots off, every thread opens in the chat.
 */
export function onBotsPage(thread: { agentSessionId?: string; teamId?: string } | null | undefined): boolean {
  return !!thread && experimentOn('resident-agents') && (!!thread.agentSessionId || (!!thread.teamId && experimentOn('teams')));
}
