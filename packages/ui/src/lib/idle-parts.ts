import { whenIdle } from './idle';
import { LazyComponent } from './lazy-component.svelte';

/**
 * Chunks outside `deferred-parts.ts` because they draw its parts through
 * `Deferred` themselves: the card of decisions at the end of a timeline, the
 * permission card a run draws for its call, and the context meter's details,
 * which a hover opens, never the first screen. The composer fetches them at
 * idle, on a link that can spare the bytes (the rule of `prefetch.ts`, which
 * this file cannot import without a cycle through the pages it warms), so the
 * first ask draws at once.
 */
export const threadDecision = new LazyComponent(() => import('../components/ThreadDecision.svelte'));
export const permissionCard = new LazyComponent(() => import('../components/PermissionCard.svelte'));
export const contextPopup = new LazyComponent(() => import('../components/ContextPopup.svelte'));

/** The idle fetch of these chunks; returns its cancel for an effect. */
export function prefetchIdleParts(): () => void {
  const link = (globalThis.navigator as (Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }) | undefined)?.connection;
  if (link?.saveData || ['slow-2g', '2g', '3g'].includes(link?.effectiveType ?? '')) return () => undefined;
  return whenIdle(() => { for (const part of [threadDecision, permissionCard, contextPopup]) void part.load().catch(() => undefined); });
}
