<script lang="ts">
  // The strip's way back to the end of the timeline, at its right edge while
  // the reader is scrolled up (`lib/latest.svelte.ts`). A phone keeps the arrow.
  import { ArrowDown } from '@lucide/svelte';
  import { latest } from '../lib/latest.svelte';
  import { fill, strings } from '../lib/strings';

  let label = $derived(latest.unseen > 0 ? fill(latest.unseen === 1 ? strings.chat.newMessage : strings.chat.newMessages, { count: String(latest.unseen) }) : strings.chat.jumpToLatest);
</script>

{#if latest.behind && latest.jump}
  <button type="button" class="jump" data-testid="jump-to-latest" aria-label={label} onclick={() => latest.jump?.()}>
    <ArrowDown size={14} strokeWidth={2} />
    <span class="ui-label">{label}</span>
  </button>
{/if}

<style>
  .jump {
    flex: none;
    height: 30px;
    gap: 6px;
    padding: 0 10px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 550;
    animation: rise var(--motion-duration) var(--motion-curve);
  }

  .jump:hover { background: var(--color-surface-3); }

  @media (max-width: 720px) {
    /* The 30 px disc stays; a finger gets the platform's 44 px around it. */
    .jump { position: relative; z-index: 1; width: 30px; padding: 0; justify-content: center; }
    .jump::after { content: ''; position: absolute; inset: calc((30px - var(--touch-target)) / 2 - 2px); }
    .jump .ui-label { display: none; }
  }
</style>
