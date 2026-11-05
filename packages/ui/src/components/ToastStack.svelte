<script lang="ts">
  import type { Snippet } from 'svelte';
  import { toastAnchor } from '../lib/toast-anchor';

  /** The column every toast shows in, over the chat and above its composer (lib/toast-anchor). */
  let { children }: { children: Snippet } = $props();
</script>

<div class="toast-stack" use:toastAnchor>{@render children()}</div>

<style>
  /* Bottom centre over the chat, 12 px above the composer, never higher than
     the title bar. On a phone list it takes the tab bar's place and width
     while it shows, and the bar steps aside until it goes. Empty, it takes no
     clicks. */
  .toast-stack {
    position: fixed;
    left: var(--toast-x, 50%);
    bottom: var(--toast-bottom, 12px);
    z-index: 80;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: var(--toast-width, min(480px, calc(100vw - 32px)));
    max-height: calc(100dvh - var(--titlebar, 0px) - var(--toast-bottom, 12px) - 12px);
    translate: -50% 0;
    pointer-events: none;
  }
  .toast-stack > :global(*) { pointer-events: auto; }
  /* Over the tab bar, a toast is the bar's capsule: its width, its height, its round ends. */
  :global(html[data-toast-cover='tabs']) .toast-stack > :global(*) { width: 100%; }
  :global(html[data-toast-cover='tabs']) .toast-stack > :global(.undo-toast) {
    min-height: var(--toast-cover-height, auto);
    padding-left: 20px;
    border-radius: var(--radius-full);
  }
  :global(html[data-toast-cover='tabs'] [data-testid='mobile-tabs']) {
    visibility: hidden;
    opacity: 0;
  }
</style>
