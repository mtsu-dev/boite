<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import type { Closing } from '../lib/closing.svelte';
  import { focusedElement, restoreFocus } from '../lib/focus';

  let { overlay, onclose, sheet = false, children }: {
    overlay: Closing;
    onclose: () => void;
    sheet?: boolean;
    children: Snippet;
  } = $props();
  let frame = $state<HTMLDivElement>();
  let previous: HTMLElement | null = null;
  let wasOpen = false;

  $effect(() => {
    if (overlay.open) {
      if (!wasOpen) previous = focusedElement();
      wasOpen = true;
    } else giveBack();
  });

  function giveBack() {
    if (!wasOpen) return;
    wasOpen = false;
    const active = focusedElement();
    if (!active || frame?.contains(active)) restoreFocus(previous);
    previous = null;
  }

  onDestroy(giveBack);
</script>

<div class="scrim" class:sheet class:closing={overlay.closing} role="presentation" bind:this={frame}
  use:overlay.attach onanimationend={overlay.end}
  onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  {@render children()}
</div>

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 60;
    display: flex; align-items: center; justify-content: center;
    padding: var(--modal-inset, 0);
    background: var(--color-scrim);
    animation: fade var(--motion-duration) var(--motion-curve);
  }
  .scrim.sheet { align-items: flex-start; padding-top: var(--modal-top, min(8vh, 72px)); }
  .scrim.closing { animation-name: fade-out; pointer-events: none; }
  @media (max-width: 720px) {
    .scrim.sheet { align-items: flex-end; padding-top: 0; }
  }
</style>
