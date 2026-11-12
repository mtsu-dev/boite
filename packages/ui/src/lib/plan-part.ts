import { LazyComponent } from './lazy-component.svelte';

/**
 * The plan card (`AssistantMessage`), its own chunk out of the entry. It lives
 * apart from `deferred-parts.ts` because the card draws Prose, which imports
 * that registry: listing it there would make a chunk import the registry that
 * loads it. Its text shows as plain Prose until the card arrives.
 */
export const planPart = new LazyComponent(() => import('../components/PlanCard.svelte'));
