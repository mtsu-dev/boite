<script lang="ts">
  import { X } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { strings } from '../lib/strings';
  import { typing, undo } from '../lib/undo.svelte';

  /** The toast that carries the last archive's way back, in App's toast column above the composer. `onerror` hears a restore that failed. */
  let { onerror }: { onerror: (error: unknown) => void } = $props();

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
    if (!undo.current || event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
    if (typing(event.target)) return;
    event.preventDefault();
    void undo.take(onerror);
  }
</script>

<svelte:window {onkeydown} />

{#if toast.shown}
  <div class="undo-toast" class:closing={toast.closing} role="status" use:toast.attach onanimationend={toast.end} data-testid="undo-toast">
    <span class="text ui-label">{text}</span>
    <button type="button" class="small undo" data-testid="undo-action" title={strings.sidebar.undoHint} onclick={() => void undo.take(onerror)}><span class="ui-label">{strings.sidebar.undo}</span></button>
    <button type="button" class="ghost small icon" aria-label={strings.common.dismiss} title={strings.common.dismiss} onclick={() => undo.dismiss()}><X size={14} /></button>
  </div>
{/if}

<style>
  /* In App's toast column, over the chat above the composer. */
  .undo-toast {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 6px 6px 6px 14px;
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    background: var(--color-float);
    -webkit-backdrop-filter: var(--float-blur);
    backdrop-filter: var(--float-blur);
    box-shadow: var(--shadow-float);
    font-size: var(--text-sm);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

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
    color: var(--color-accent);
    font-weight: 600;
  }
</style>
