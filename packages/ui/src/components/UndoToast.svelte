<script lang="ts">
  import { X } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { toastSlot } from '../lib/notify-corner';
  import { strings } from '../lib/strings';
  import { typing, undo } from '../lib/undo.svelte';

  /**
   * The toast that carries the last archive's way back, in the toasts' one
   * home (`toastSlot`), as wide as its text: in room the page keeps for it,
   * right above the composer or the tab bar on every width, so it never
   * covers a line, a row or a title. `onerror` hears a restore that failed.
   */
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
  <div class="toast-slot" use:toastSlot>
    <div class="undo-toast" class:closing={toast.closing} role="status" use:toast.attach onanimationend={toast.end} data-testid="undo-toast">
      <span class="text">{text}</span>
      <button type="button" class="small undo" data-testid="undo-action" title={strings.sidebar.undoHint} onclick={() => void undo.take(onerror)}><span class="ui-label">{strings.sidebar.undo}</span></button>
      <button type="button" class="ghost small icon" aria-label={strings.common.dismiss} title={strings.common.dismiss} onclick={() => undo.dismiss()}><X size={14} /></button>
    </div>
  </div>
{/if}

<style>
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
    animation: rise var(--motion-in);
  }

  .undo-toast.closing {
    animation: fade-out var(--motion-out);
    pointer-events: none;
  }

  /* Two lines before an ellipsis: a long title still reads on a phone. */
  .text {
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .undo {
    flex: none;
    color: var(--color-foreground);
    font-weight: 600;
  }
</style>
