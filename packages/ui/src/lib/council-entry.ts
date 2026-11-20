/**
 * The way to the Council's salon, a chunk fetched when it is first drawn, in
 * the panel or as a thread. Its card in a thread is among the deferred parts
 * (`lib/deferred-parts.ts`, which the salon's own modules import, so the
 * card's import cannot sit here without a cycle).
 */
export function loadCouncilSalon(): Promise<typeof import('../components/council/CouncilSalon.svelte')> {
  return import('../components/council/CouncilSalon.svelte');
}
