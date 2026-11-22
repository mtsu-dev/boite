import { experimentOn } from './experiments.svelte';

type BackdropFeature = typeof import('./backdrop/feature');

/**
 * The one way to the new thread background's code, a chunk of its own. The
 * flag is written in full so a build below the feature's tag folds the branch
 * and ships none of it (`packages/contracts/src/experiments.ts`).
 */
function importBackdrop(): Promise<BackdropFeature> | null {
  if (typeof __BOITE_HAS_DRAFT_BACKDROP__ === 'undefined' || __BOITE_HAS_DRAFT_BACKDROP__) return import('./backdrop/feature');
  return null;
}

class BackdropEntry {
  /** The canvas and the picker, once fetched. */
  feature = $state.raw<BackdropFeature>();
  #asked = false;

  /**
   * Fetches the feature the first time its experiment is found on. A scene
   * only decorates, so a failed fetch says nothing and the next call asks again.
   */
  need(): void {
    if (this.#asked || !experimentOn('draft-backdrop')) return;
    const loading = importBackdrop();
    if (loading === null) return;
    this.#asked = true;
    void loading.then((feature) => { this.feature = feature; }, () => { this.#asked = false; });
  }
}

export const backdropEntry = new BackdropEntry();
