<script lang="ts">
  // The strip's way back to what waits on the user, at its left edge while the
  // card at the timeline's end is out of view (`lib/decision-tail.svelte.ts`).
  // It only leads there: the card keeps the form.
  import { decisionTail, showDecision } from '../lib/decision-tail.svelte';
  import { fill, strings } from '../lib/strings';

  let label = $derived(decisionTail.count === 1 ? strings.chat.decisionWaiting : fill(strings.chat.decisionsWaiting, { count: String(decisionTail.count) }));
</script>

{#if decisionTail.away && decisionTail.count > 0 && decisionTail.card}
  <button type="button" class="pill" data-testid="decision-pill" title={label} aria-label={label} onclick={() => showDecision()}>
    <span class="dot" aria-hidden="true"></span>
    <span class="ui-label">{decisionTail.count === 1 ? label : decisionTail.count}</span>
  </button>
{/if}

<style>
  .pill {
    flex: none;
    position: relative;
    height: 30px;
    gap: 8px;
    margin-right: auto;
    padding: 0 12px 0 10px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 550;
    font-variant-numeric: tabular-nums;
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  .pill:hover { background: var(--color-surface-3); }
  /* Amber says "needs you", as on the card's head. */
  .dot { flex: none; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--color-live); }
  /* A finger gets the platform's 44 px around it. */
  @media (max-width: 720px) { .pill::after { content: ''; position: absolute; inset: calc((30px - var(--touch-target)) / 2 - 2px) -2px; } }
</style>
