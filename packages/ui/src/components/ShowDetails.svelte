<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * Developer detail folded under a card's plain words: raw paths, ids,
   * protocol numbers, file names. Folded by default; the button says what it
   * does and the content mounts only once opened.
   */
  let { testid = 'show-details', children }: { testid?: string; children: Snippet } = $props();
  let open = $state(false);
  const uid = $props.id();
</script>

<div class="show-details" data-testid={testid}>
  <button type="button" class="ghost small toggle" aria-expanded={open} aria-controls="{uid}-details" data-testid="{testid}-toggle" onclick={() => { open = !open; }}>
    <span class="ui-label">{open ? strings.trace.hideDetails : strings.trace.showDetails}</span><ChevronDown size={13} strokeWidth={1.75} class={open ? 'turned' : ''} />
  </button>
  {#if open}<div class="body" id="{uid}-details">{@render children()}</div>{/if}
</div>

<style>
  .show-details { margin-top: 12px; }
  .toggle { gap: 6px; padding-inline: 6px; margin-left: -6px; color: var(--color-muted-foreground); }
  .toggle :global(svg) { transition: rotate var(--dur-2) var(--ease-out-quint); }
  .toggle :global(svg.turned) { rotate: 180deg; }
  .body { margin-top: 10px; animation: fade var(--dur-2) var(--ease-out-quint); }
  @media (max-width: 720px) { .toggle { min-height: var(--touch-target); } }
</style>
