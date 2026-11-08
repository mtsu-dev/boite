<script lang="ts">
  import { untrack } from 'svelte';
  import { RotateCcw, X } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { toastSlot } from '../lib/notify-corner';
  import { collapseMs } from '../lib/row-collapse';
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
    // The archived row closes first (row-collapse.ts): the toast arrives as the list settles, not over a moving row.
    const wait = collapseMs();
    if (wait === 0 || untrack(() => toast.shown)) return void toast.show();
    const timer = setTimeout(() => toast.show(), wait);
    return () => clearTimeout(timer);
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
    <!-- The one notice card (notify-corner.css): its mark, its line, one way to act, the one dismiss. -->
    <div class="notify-card undo-toast" data-tone="quiet" class:closing={toast.closing} role="status" use:toast.attach onanimationend={toast.end} data-testid="undo-toast">
      <span class="notify-mark" aria-hidden="true"><RotateCcw size={16} strokeWidth={1.75} /></span>
      <span class="notify-lines"><span class="notify-title text">{text}</span></span>
      <button type="button" class="small undo" data-testid="undo-action" title={strings.sidebar.undoHint} onclick={() => void undo.take(onerror)}><span class="ui-label">{strings.sidebar.undo}</span></button>
      <button type="button" class="ghost icon notify-dismiss" aria-label={strings.common.dismiss} title={strings.common.dismiss} onclick={() => undo.dismiss()}><X size={14} /></button>
    </div>
  </div>
{/if}

<style>
  /* The card's look is the shared one; a toast only arrives and leaves. */
  .undo-toast { align-items: center; animation: rise var(--motion-duration) var(--motion-curve); }
  .undo-toast .notify-mark { margin-top: 0; }
  .undo-toast .notify-dismiss { margin: 0; }

  .undo-toast.closing {
    animation: fade-out var(--motion-duration) var(--motion-curve);
    pointer-events: none;
  }

  /* Two lines before an ellipsis: a long title still reads on a phone. */
  .text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.35;
  }

  .undo { flex: none; font-weight: 600; }
</style>
