/*
 * The reactive face of `experiments.ts`: one `$state` mirror of the enabled
 * ids, kept in step by the subscription, so a component or a derived list can
 * ask `experimentOn(id)` and follow the switch on the Experiments page without
 * a reload. `experiments.ts` stays rune-free so the theme module and the tests
 * can import it from anywhere.
 */

import { experimentsAvailable, listedSwitches, readExperiments, subscribeExperiments, type ExperimentId } from './experiments';

const mirror = $state<{ enabled: ExperimentId[]; listed: ExperimentId[]; available: boolean }>({ enabled: readExperiments(), listed: listedSwitches(), available: experimentsAvailable() });

subscribeExperiments((enabled) => {
  mirror.enabled = enabled;
  mirror.listed = listedSwitches();
  mirror.available = experimentsAvailable();
});

/** Whether Settings has an Experiments page: false where the primary machine runs a Release. */
export function experimentsShown(): boolean {
  return mirror.available;
}

/** The switches the Experiments page lists, tracked by whoever reads them inside a rune. */
export function experimentsListed(): ExperimentId[] {
  return mirror.listed;
}

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
