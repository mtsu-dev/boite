import { isFeatureEnabled } from './features';

type WhipFeature = typeof import('./whip/feature');
type WhipOverlay = Awaited<ReturnType<WhipFeature['loadWhipOverlay']>>['default'];

/**
 * The one way to the Whip's code, a chunk of its own fetched once its switch
 * in Appearance is found on (`lib/features.ts`). The flag is the one a build
 * would define to cut the Whip out (`packages/contracts/src/experiments.ts`):
 * the Whip is finished, so no build defines it and the import always runs.
 */
function importWhip(): Promise<WhipFeature> | null {
  if (typeof __BOITE_HAS_WHIP__ === 'undefined' || __BOITE_HAS_WHIP__) return import('./whip/feature');
  return null;
}

class WhipEntry {
  /** The control and its Escape key, once fetched. */
  feature = $state.raw<WhipFeature>();
  /** The rope, fetched after the control. */
  overlay = $state.raw<WhipOverlay>();
  #asked = false;

  /** Fetches the Whip the first time its switch is found on. A failure is told and the next call asks again. */
  need(onerror: (error: unknown) => void): void {
    if (this.#asked || !isFeatureEnabled('whip')) return;
    const loading = importWhip();
    if (loading === null) return;
    this.#asked = true;
    void loading.then(async (feature) => {
      feature.installWhipEscape();
      this.feature = feature;
      this.overlay = (await feature.loadWhipOverlay()).default;
    }).catch((error) => { this.#asked = false; onerror(error); });
  }
}

export const whipEntry = new WhipEntry();
