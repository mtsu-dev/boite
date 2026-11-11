<script lang="ts">
  // The way back to the end of the timeline while the reader is scrolled up
  // (`lib/latest.svelte.ts`): a round arrow at the right of the slot above the
  // composer's foot, its name (or what arrived meanwhile) in its tooltip.
  import { ArrowDown } from '@lucide/svelte';
  import { latest } from '../lib/latest.svelte';
  import { fill, strings } from '../lib/strings';

  let label = $derived(latest.unseen > 0 ? fill(latest.unseen === 1 ? strings.chat.newMessage : strings.chat.newMessages, { count: String(latest.unseen) }) : strings.chat.jumpToLatest);
</script>

{#if latest.behind && latest.jump}
  <button type="button" class="jump" data-testid="jump-to-latest" title={label} aria-label={label} onclick={() => latest.jump?.()}>
    <ArrowDown size={16} aria-hidden="true" />
    <span class="visually-hidden">{label}</span>
  </button>
{/if}

<style>
  /* A raised disc of the composer's surface; a finger gets the platform's 44 px around it. */
  .jump {
    position: relative;
    flex: none;
    width: var(--control-lg);
    height: var(--control-lg);
    padding: 0;
    border: 1px solid var(--color-composer-edge);
    border-radius: var(--radius-full);
    background: var(--color-composer-surface);
    box-shadow: var(--shadow-composer);
    color: var(--color-foreground);
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  @media (max-width: 720px) { .jump { width: var(--control-touch); height: var(--control-touch); } }
  .jump::after { content: ''; position: absolute; inset: min(-1px, calc((100% - var(--touch-target)) / 2 - 1px)); border-radius: var(--radius-full); }
  @media (hover: hover) { .jump:hover { background: var(--color-surface-3); } }
</style>
