import { isExperimentEnabled } from './experiments';

type WhipFeature = typeof import('./whip/feature');
type WhipOverlay = Awaited<ReturnType<WhipFeature['loadWhipOverlay']>>['default'];

/**
 * The one way to the Whip's code. The flag is written here in full because a
 * bundler folds nothing less direct (`packages/contracts/src/experiments.ts`):
 * in a build below the Whip's tag it is `false`, the import below is dropped
 * and no chunk holds the Whip. From source and in tests it is not defined.
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
    if (this.#asked || !isExperimentEnabled('whip')) return;
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
