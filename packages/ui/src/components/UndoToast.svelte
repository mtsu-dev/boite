<script lang="ts" module>
  /** How many strips hold the toast: while one does, the app's own stays away. */
  let held = $state(0);
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Archive, X } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { notifyCorner } from '../lib/notify-corner';
  import { strings } from '../lib/strings';
  import { typing, undo } from '../lib/undo.svelte';

  /**
   * The toast that carries the last archive's way back. `onerror` hears a
   * restore that failed. In a thread it sits `inline` in the strip above the
   * composer, clear of every title; elsewhere it takes the shared bottom-right corner.
   */
  let { onerror, inline = false }: { onerror: (error: unknown) => void; inline?: boolean } = $props();
  $effect(() => {
    if (!inline) return;
    untrack(() => held++);
    return () => untrack(() => { held--; });
  });
  let active = $derived(inline || held === 0);

  const toast = new Closing();
  let text = $state('');

  $effect(() => {
    const offer = undo.current;
    if (!offer) {
      toast.hide();
      return;
    }
    text = offer.message;
    toast.show();
  });

  function onkeydown(event: KeyboardEvent): void {
    if (!active || !undo.current || event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
    if (typing(event.target)) return;
    event.preventDefault();
    void undo.take(onerror);
  }
</script>

<svelte:window {onkeydown} />

{#snippet body()}
  <div class="undo-toast" class:inline class:closing={toast.closing} role="status" use:toast.attach onanimationend={toast.end} data-testid="undo-toast">
    {#if inline}<Archive size={14} strokeWidth={1.75} />{/if}
    <span class="text ui-label">{text}</span>
    <button type="button" class="small undo" data-testid="undo-action" title={strings.sidebar.undoHint} onclick={() => void undo.take(onerror)}><span class="ui-label">{strings.sidebar.undo}</span></button>
    <button type="button" class="ghost small icon" aria-label={strings.common.dismiss} title={strings.common.dismiss} onclick={() => undo.dismiss()}><X size={14} /></button>
  </div>
{/snippet}

{#if toast.shown && active}
  {#if inline}{@render body()}{:else}<div class="notify-corner" use:notifyCorner>{@render body()}</div>{/if}
{/if}

<style>
  /* Outside a thread: a card in the shared bottom-right corner, never over a title. */
  .undo-toast {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    width: 100%;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    box-shadow: var(--shadow-e3);
    font-size: var(--text-sm);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

  /* In the strip: one 30 px row among the others, in the flow. */
  .undo-toast.inline {
    position: static;
    flex: 0 1 auto;
    width: auto;
    min-width: 0;
    height: 30px;
    gap: 6px;
    padding: 0 4px 0 10px;
    border-color: var(--color-edge);
    box-shadow: none;
    animation: rise var(--dur-2) var(--ease-out-quint);
  }
  .undo-toast.inline :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .undo-toast.inline .undo { height: 22px; padding: 0 8px; background: var(--color-hover); }

  .undo-toast.closing {
    animation: fade-out var(--dur-2) var(--ease-out-quint);
    pointer-events: none;
  }

  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .undo {
    flex: none;
    color: var(--color-foreground);
    font-weight: 600;
  }
</style>
