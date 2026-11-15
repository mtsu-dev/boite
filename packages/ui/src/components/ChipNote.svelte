<script lang="ts">
  import type { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';

  /**
   * Why a composer chip opens nothing on this device (a bot's setting only
   * its owner's app changes): its click shows this sentence beside it, a
   * phone as a sheet. Escape or a press elsewhere puts it away. The chip owns
   * `note` and draws this while `note.shown`.
   */
  let { note, anchor, text, testid }: { note: Closing; anchor: () => HTMLElement | null; text: string; testid: string } = $props();
  let bubble = $state<HTMLElement>();

  $effect(() => {
    if (!note.open) return;
    const onkey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      note.hide();
    };
    const onpress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (anchor()?.contains(target) || bubble?.contains(target))) return;
      note.hide();
    };
    window.addEventListener('keydown', onkey, true);
    document.addEventListener('pointerdown', onpress, true);
    return () => {
      window.removeEventListener('keydown', onkey, true);
      document.removeEventListener('pointerdown', onpress, true);
    };
  });
</script>

<span
  class="chip-note"
  class:closing={note.closing}
  role="status"
  data-testid={testid}
  bind:this={bubble}
  use:note.attach
  use:floating={{ anchor, placement: 'top', dismiss: () => note.hide() }}
  onanimationend={note.end}
>{text}</span>

<style>
  /* InfoTip's bubble: the overlay card every menu and popover wears (app.css). */
  .chip-note {
    position: fixed;
    z-index: 60;
    display: block;
    max-width: min(340px, calc(100vw - 24px));
    padding: 8px 10px;
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    background: var(--overlay-surface);
    box-shadow: var(--shadow-overlay);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.5;
    white-space: normal;
    animation: pop var(--motion-duration) var(--motion-curve);
  }
  .chip-note.closing { animation: pop-out var(--motion-duration) var(--motion-curve); }
  .chip-note:global([data-mobile-sheet='true']) { max-width: none; padding: 14px 16px; font-size: var(--text-md); }
</style>
