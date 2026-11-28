/*
 * What the rest of the app may take of the rich presence, through
 * `lib/presence-entry.svelte.ts` alone: the publisher that keeps it true and
 * the block under its switch in Settings, Experiments. A build below the
 * feature's tag holds none of this (docs/internals/experiments.md#out-of-the-build).
 */

import { markFeature } from '@boite/contracts';
import PresenceSettings from '../../components/presence/PresenceSettings.svelte';
import { presence } from './publisher.svelte';

markFeature('boite-feature:discord-presence');

export { presence, PresenceSettings };
