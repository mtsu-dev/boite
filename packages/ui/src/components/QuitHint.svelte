<script lang="ts">
  import type { Closing } from '../lib/closing.svelte';
  import { QUIT_HOLD_MS } from '../lib/quit-hold';
  import { strings } from '../lib/strings';

  let { quitHint }: { quitHint: Closing } = $props();
</script>

{#if quitHint.shown}
  <div
    class="quit-hint"
    class:closing={quitHint.closing}
    role="status"
    style="--quit-hold: {QUIT_HOLD_MS}ms"
    use:quitHint.attach
    onanimationend={quitHint.end}
    data-testid="quit-hint"
  >
    <span class="text">{strings.titlebar.quitHold}</span>
    <span class="sub">{strings.titlebar.quitHoldHint}</span>
    <span class="bar" class:filling={quitHint.open}></span>
  </div>
{/if}

<style>
  /* The quit hint: a card at the top centre with a bar that fills over the
     hold, so the eye reads how long is left before the window goes. */
  .quit-hint {
    position: absolute;
    top: calc(var(--titlebar, 0px) + 12px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    display: grid;
    grid-template-columns: auto auto;
    align-items: baseline;
    gap: 6px 8px;
    padding: 8px 12px 10px;
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    animation: pop var(--dur-2) var(--ease-out-quint);
    pointer-events: none;
  }

  .quit-hint.closing {
    animation: pop-out var(--dur-2) var(--ease-out-quint);
  }

  .quit-hint .text {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .quit-hint .sub {
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }

  .quit-hint .bar {
    grid-column: 1 / -1;
    height: 2px;
    border-radius: 1px;
    background: var(--color-foreground);
    transform: scaleX(0);
    transform-origin: left;
  }

  .quit-hint .bar.filling {
    animation: quit-fill var(--quit-hold) linear forwards;
  }

  @keyframes quit-fill {
    to {
      transform: scaleX(1);
    }
  }
</style>
