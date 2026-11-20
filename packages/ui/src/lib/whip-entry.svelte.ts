import { isFeatureEnabled } from './features';

type WhipFeature = typeof import('./whip/feature');
type WhipOverlay = Awaited<ReturnType<WhipFeature['loadWhipOverlay']>>['default'];

/** The one way to the Whip's code, a chunk of its own fetched once its switch in Appearance is found on (`lib/features.ts`). */
function importWhip(): Promise<WhipFeature> {
  return import('./whip/feature');
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
    this.#asked = true;
    void importWhip().then(async (feature) => {
      feature.installWhipEscape();
      this.feature = feature;
      this.overlay = (await feature.loadWhipOverlay()).default;
    }).catch((error) => { this.#asked = false; onerror(error); });
  }
}

export const whipEntry = new WhipEntry();
