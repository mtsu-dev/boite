import { experimentOn } from './experiments.svelte';

type PresenceFeature = typeof import('./presence/feature');

/**
 * The one way to the rich presence's code, a chunk of its own. The flag is
 * written in full so a build below the feature's tag folds the branch and
 * ships none of it (`packages/contracts/src/experiments.ts`).
 */
function importPresence(): Promise<PresenceFeature> | null {
  if (typeof __BOITE_HAS_DISCORD_PRESENCE__ === 'undefined' || __BOITE_HAS_DISCORD_PRESENCE__) return import('./presence/feature');
  return null;
}

class PresenceEntry {
  /** The publisher and the Settings block, once fetched. */
  feature = $state.raw<PresenceFeature>();
  #asked = false;

  /**
   * Fetches the feature the first time its experiment is found on and starts
   * the publisher, which then follows the switch itself, clearing the
   * presence when it goes off. A failed fetch says nothing: the next call asks again.
   */
  need(): void {
    if (this.#asked || !experimentOn('discord-presence')) return;
    const loading = importPresence();
    if (loading === null) return;
    this.#asked = true;
    void loading.then((feature) => { feature.presence.start(); this.feature = feature; }, () => { this.#asked = false; });
  }
}

export const presenceEntry = new PresenceEntry();
