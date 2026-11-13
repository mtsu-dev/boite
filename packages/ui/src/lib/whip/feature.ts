import { markFeature } from '@boite/contracts';
/**
 * The Whip, as its lazy entry loads it (`lib/whip-entry.svelte.ts`). Nothing
 * else imports this file or what it names: a build below the Whip's tag
 * drops the entry's import, and with it every module here
 * (docs/internals/experiments.md#out-of-the-build). The control carries the
 * marker `scripts/ci/feature-cut.ts` looks for (`components/WhipButton.svelte`).
 */
export { default as WhipButton } from '../../components/WhipButton.svelte';
export { installWhipEscape } from '../whip.svelte';

/** The rope, its physics and its sounds: heavier than the control, so fetched after it. */
export const loadWhipOverlay = () => import('../../components/WhipOverlay.svelte');

// Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
markFeature('boite-feature:whip');
