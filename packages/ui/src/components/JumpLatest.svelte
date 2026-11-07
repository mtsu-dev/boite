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
    animation: rise var(--dur-2) var(--ease-out-quint);
  }

  .jump:hover { background: var(--color-surface-3); }

  @media (max-width: 720px) {
    .jump { width: 30px; padding: 0; justify-content: center; }
    .jump .ui-label { display: none; }
  }
</style>
