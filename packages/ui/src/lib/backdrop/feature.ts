/*
 * What the rest of the app may take of the new thread background, through
 * `lib/backdrop-entry.svelte.ts` alone: the canvas the empty screen draws and
 * the row Settings, Appearance picks a scene on. A build below the feature's
 * tag holds none of this (docs/internals/experiments.md#out-of-the-build).
 */

import { markFeature } from '@boite/contracts';
import BackdropPicker from '../../components/backdrop/BackdropPicker.svelte';
import DraftBackdrop from '../../components/backdrop/DraftBackdrop.svelte';

markFeature('boite-feature:draft-backdrop');

export { BackdropPicker, DraftBackdrop };
