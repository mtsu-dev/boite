import type { QuestionRequest } from '@boite/contracts';
import { whenIdle } from './idle';
import { LazyComponent } from './lazy-component.svelte';
import { repliesOf } from './question-reply.svelte';
import type { Store } from './store.svelte';

/**
 * What docks at the top of the composer. The permission card is a chunk of
 * its own, outside `deferred-parts.ts` because it draws a diff through
 * `Deferred` itself; the composer fetches it at idle, on a link that can
 * spare the bytes (the rule of `prefetch.ts`, which this file cannot import
 * without a cycle through the pages it warms), so the first ask draws at once.
 * The context meter's details ride along: a hover opens them, never the first screen.
 */
export const permissionCard = new LazyComponent(() => import('../components/PermissionCard.svelte'));
export const contextPopup = new LazyComponent(() => import('../components/ContextPopup.svelte'));

/** The idle fetch of the permission card's and the context details' chunks; returns its cancel for an effect. */
export function prefetchPermissionCard(): () => void {
  const link = (globalThis.navigator as (Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }) | undefined)?.connection;
  if (link?.saveData || ['slow-2g', '2g', '3g'].includes(link?.effectiveType ?? '')) return () => undefined;
  return whenIdle(() => { for (const part of [permissionCard, contextPopup]) void part.load().catch(() => undefined); });
}

/**
 * Key 1 to 9 picks that option of the docked question, or drops it when it
 * was picked; a question with several answers keeps the others. False for a
 * key that names no option.
 */
export function pickOption(store: Store, question: QuestionRequest, key: string): boolean {
  if (!/^[1-9]$/.test(key) || Number(key) > question.options.length) return false;
  const id = question.options[Number(key) - 1]!.id;
  const held = repliesOf(store).picks[question.id] ?? [];
  repliesOf(store).picks[question.id] = question.multiple ? (held.includes(id) ? held.filter((one) => one !== id) : [...held, id]) : held[0] === id ? [] : [id];
  return true;
}
