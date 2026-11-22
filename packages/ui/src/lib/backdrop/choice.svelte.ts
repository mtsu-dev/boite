/*
 * The animated scene behind the empty new thread screen, per device: one of
 * four, a fresh draw among them each time the screen opens, or none. It rides
 * behind the `draft-backdrop` experiment, so `shown` answers `off` until that
 * switch is on, and a device that switched it on without picking gets the draw.
 *
 * Only the choice lives here. The renderer (`engine.ts`) is loaded by the
 * component that shows a scene, so a device with none never fetches it.
 */

import { markFeature } from '@boite/contracts';
import { experimentOn } from '../experiments.svelte';
import type { SceneId } from './scenes';

markFeature('boite-feature:draft-backdrop');

export type BackdropChoice = 'off' | 'random' | SceneId;

export const BACKDROP_SCENES: readonly SceneId[] = ['tunnel', 'glyphs', 'relief', 'crates'];
export const BACKDROP_CHOICES: readonly BackdropChoice[] = ['off', 'random', ...BACKDROP_SCENES];
export const BACKDROP_DEFAULT: BackdropChoice = 'random';
export const BACKDROP_STORAGE_KEY = 'boite.backdrop';

/** The stored choice, the default when nothing is stored, storage is refused or the id is unknown. */
export function readBackdrop(): BackdropChoice {
  try {
    const raw = window.localStorage.getItem(BACKDROP_STORAGE_KEY);
    return BACKDROP_CHOICES.includes(raw as BackdropChoice) ? (raw as BackdropChoice) : BACKDROP_DEFAULT;
  } catch {
    return BACKDROP_DEFAULT;
  }
}

class Backdrop {
  choice = $state<BackdropChoice>(readBackdrop());

  /** What the empty screen draws: the choice while the experiment is on, nothing otherwise. */
  get shown(): BackdropChoice {
    return experimentOn('draft-backdrop') ? this.choice : 'off';
  }

  /** Stores the choice; the default leaves no key behind. */
  set(next: BackdropChoice): void {
    this.choice = next;
    try {
      if (next === BACKDROP_DEFAULT) window.localStorage.removeItem(BACKDROP_STORAGE_KEY);
      else window.localStorage.setItem(BACKDROP_STORAGE_KEY, next);
    } catch {
      /* a browser that refuses storage keeps the choice for this session */
    }
  }

  /** Reads storage again, after another window wrote it. */
  load(): void {
    this.choice = readBackdrop();
  }
}

export const backdrop = new Backdrop();

// Picked in another window of this device: the picker and the screen both follow, mounted or not.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === BACKDROP_STORAGE_KEY || event.key === null) backdrop.load();
  });
}
