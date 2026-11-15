<script lang="ts">
  // The way back to the end of the timeline while the reader is scrolled up
  // (`lib/latest.svelte.ts`): a pill centred over the last lines of the
  // timeline, an arrow and its name, or what arrived meanwhile. It floats, so
  // it takes no room between the last message and the composer.
  import { ArrowDown } from '@lucide/svelte';
  import { latest } from '../lib/latest.svelte';
  import { fill, strings } from '../lib/strings';

  let label = $derived(latest.unseen > 0 ? fill(latest.unseen === 1 ? strings.chat.newMessage : strings.chat.newMessages, { count: String(latest.unseen) }) : strings.chat.jumpToLatest);
</script>

{#if latest.behind && latest.jump}
  <button type="button" class="small jump" data-testid="jump-to-latest" onclick={() => latest.jump?.()}>
    <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
    <span class="ui-label">{label}</span>
  </button>
{/if}

<style>
  .jump {
    position: absolute;
    left: 50%;
    bottom: 12px;
    z-index: 2;
    /* The entrance animates transform; centering must survive every frame. */
    translate: -50% 0;
    max-width: calc(100% - 24px);
    padding: 0 12px 0 9px;
    gap: 6px;
    border: 1px solid var(--color-composer-edge);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    box-shadow: var(--shadow-e2);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    white-space: nowrap;
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  /* A finger gets the platform's 44 px around it. */
  .jump::after { content: ''; position: absolute; inset: min(-1px, calc((100% - var(--touch-target)) / 2 - 1px)) -4px; border-radius: var(--radius-full); }
  @media (max-width: 720px) { .jump { height: 36px; } }
  @media (hover: hover) { .jump:hover { background: var(--color-surface-3); } }
</style>
