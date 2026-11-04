<script lang="ts">
  import { ArrowDown } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * Back to the newest message once the reader scrolled up: a round button
   * in the right gutter above the composer, with the count of messages that
   * arrived meanwhile. It never covers a line of text on a wide window.
   */
  let { unseen, onjump }: { unseen: number; onjump: () => void } = $props();
  const label = $derived(unseen > 0 ? fill(unseen === 1 ? strings.chat.newMessage : strings.chat.newMessages, { count: String(unseen) }) : strings.chat.jumpToLatest);
</script>

<button type="button" class="jump" onclick={onjump} data-testid="jump-to-latest" title={label} aria-label={label}>
  <ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
  {#if unseen > 0}<span class="unseen" aria-hidden="true">{unseen > 99 ? '99+' : unseen}</span>{/if}
</button>

<style>
  /* 32 px round, bottom right, just above the composer. On a wide window it sits
     in the gutter beside the column (the scrollbar's room excluded), so it never
     covers text; a narrow one keeps it at the edge. */
  .jump {
    position: absolute;
    right: max(12px, calc((100% - var(--content)) / 2 - 52px));
    bottom: calc(var(--dock-clearance, 0px) + 12px);
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--color-surface-2);
    color: var(--color-foreground);
    box-shadow: inset 0 0 0 1px var(--color-border), var(--shadow-e2);
    cursor: pointer;
    animation: rise var(--dur-2) var(--ease-out-quint);
    transition: background var(--dur-1);
  }
  .jump:hover, .jump:focus-visible { background: var(--color-surface-3); }
  .unseen {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--color-accent);
    color: var(--color-accent-ink);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 720px) {
    /* A finger needs 44 px: the target grows past the round button. */
    .jump::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; }
  }
</style>
