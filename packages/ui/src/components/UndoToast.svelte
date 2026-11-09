<script lang="ts">
  import { untrack } from 'svelte';
  import { RotateCcw } from '@lucide/svelte';
  import Notice from './Notice.svelte';
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
    <!-- The one notice (Notice.svelte), floating: its mark, its line, one way to act, the dismiss. -->
    <div class="toast" class:closing={toast.closing} use:toast.attach onanimationend={toast.end}>
      <Notice icon={RotateCcw} floating testid="undo-toast" detail={text} ondismiss={() => undo.dismiss()}>
        {#snippet actions()}
          <button type="button" class="small" data-testid="undo-action" title={strings.sidebar.undoHint} onclick={() => void undo.take(onerror)}><span class="ui-label">{strings.sidebar.undo}</span></button>
        {/snippet}
      </Notice>
    </div>
  </div>
{/if}

<style>
  /* The look is the notice's; a toast only arrives and leaves. */
  .toast { animation: rise var(--motion-duration) var(--motion-curve); }
  .toast.closing {
    animation: fade-out var(--motion-duration) var(--motion-curve);
    pointer-events: none;
  }
</style>
