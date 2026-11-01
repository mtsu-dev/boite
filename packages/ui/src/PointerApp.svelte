<script lang="ts">
  import { onMount } from 'svelte';
  import BoiteMark from './components/BoiteMark.svelte';
  import { startTheme } from './lib/theme';
  import { fill, strings } from './lib/strings';
  import { pointerRing, pointerTag, type PointerLayout } from './lib/pointer-layout';

  /**
   * The box `boite window point` shows the user, in a transparent,
   * click-through window of its own above every other (`pointer_window.rs`).
   * The shell says where the control is in this page's pixels; the page draws
   * a rounded ring around it in the user's accent and the label on a card of
   * the app's own surface, signed with the Boite mark, whose tail points at
   * the ring. One entrance, then one echo that keeps widening and fading: the
   * only motion, and none with reduced motion. Nothing here is clickable.
   */
  let layout = $state<PointerLayout | null>(null);
  /** Counts each box, so a new one plays the entrance and a move does not. */
  let shown = $state(0);
  let size = $state({ width: window.innerWidth, height: window.innerHeight });
  const ring = $derived(layout ? pointerRing(layout, size) : null);
  const tag = $derived(layout && ring ? pointerTag(ring, size, layout.below) : null);

  function place(next: PointerLayout): void {
    if (layout === null) shown += 1;
    layout = next;
  }

  onMount(() => {
    const stopTheme = startTheme();
    const resize = () => { size = { width: window.innerWidth, height: window.innerHeight }; };
    window.addEventListener('resize', resize);
    const stops: (() => void)[] = [];
    let disposed = false;
    void (async () => {
      const [{ invoke }, { getCurrentWebviewWindow }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/webviewWindow')]);
      // This window's events only: a frame and a box show at once, each in a window of its own.
      const own = getCurrentWebviewWindow();
      const moved = await own.listen<PointerLayout>('pointer://layout', (event) => place(event.payload));
      const hidden = await own.listen('pointer://hide', () => { layout = null; });
      if (disposed) { moved(); hidden(); return; }
      stops.push(moved, hidden);
      // A box placed before this page ran is read once here.
      const current = await invoke<PointerLayout | null>('pointer_layout');
      if (current && layout === null) place(current);
    })();
    return () => { disposed = true; stopTheme(); window.removeEventListener('resize', resize); for (const stop of stops) stop(); };
  });
</script>

{#if layout?.frame !== undefined}
  {#key shown}
    <!-- The frame around a whole app Boite brought to the front, and why, inside its top edge. -->
    <div class="pointer" data-testid="pointer-frame">
      <div class="frame" style:left="{Math.max(0, layout.x)}px" style:top="{Math.max(0, layout.y)}px"
        style:width="{Math.min(size.width, layout.x + layout.width) - Math.max(0, layout.x)}px" style:height="{Math.min(size.height, layout.y + layout.height) - Math.max(0, layout.y)}px">
        <div class="notice"><span class="mark"><BoiteMark size={14} /></span><span class="text">{fill(strings.windows.pointer.frame, { app: layout.frame })}</span></div>
      </div>
    </div>
  {/key}
{:else if layout && ring}
  {#key shown}
    <div class="pointer" data-testid="pointer" data-below={layout.below} data-shape={layout.look.shape}>
      <div class="ring" style:left="{ring.left}px" style:top="{ring.top}px" style:width="{ring.width}px" style:height="{ring.height}px">
        <span class="echo"></span>
      </div>
      {#if layout.label && tag}
        <div class="tag" data-testid="pointer-label" data-side={tag.side} style:left={tag.side === 'left' ? `${tag.edge}px` : 'auto'}
          style:right={tag.side === 'right' ? `${tag.edge}px` : 'auto'} style:top={tag.top === null ? 'auto' : `${tag.top}px`}
          style:bottom={tag.bottom === null ? 'auto' : `${tag.bottom}px`} style:max-width="{tag.maxWidth}px" style:--tail="{tag.tail}px"><span class="mark"><BoiteMark size={14} /></span><span class="text">{layout.label}</span></div>
      {/if}
    </div>
  {/key}
{/if}

<style>
  :global(html[data-view='pointer']), :global(html[data-view='pointer'] body) {
    background: transparent;
    overflow: hidden;
  }

  .pointer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    user-select: none;
    font-family: var(--font-sans);
  }

  /* The ring: the accent with a dark hairline outside, so it reads on a white
     settings page and on a dark editor alike, and a soft glow of the accent. */
  .ring {
    position: absolute;
    box-sizing: border-box;
    border: 2.5px solid var(--color-accent);
    border-radius: var(--radius-xl);
    box-shadow: 0 0 0 1px var(--pointer-halo), 0 0 22px 4px var(--color-accent-soft);
    transition: left var(--dur-2) var(--ease-out-quint), top var(--dur-2) var(--ease-out-quint),
      width var(--dur-2) var(--ease-out-quint), height var(--dur-2) var(--ease-out-quint);
    animation: settle var(--dur-3) var(--ease-out-quint) both;
  }

  .echo {
    position: absolute;
    inset: -2.5px;
    border: 2px solid var(--color-accent);
    border-radius: var(--radius-xl);
    opacity: 0;
    animation: echo var(--dur-flash) var(--ease-out-quint) var(--dur-3) infinite;
  }

  [data-shape='round'] .ring, [data-shape='round'] .echo {
    border-radius: var(--radius-full);
  }

  /* The label: a card of the app's surface with the Boite mark in the accent,
     as the app's own toasts look, and a tail pointing at the ring. The tail
     shares the card's edge, so both read as one shape over any app. */
  .tag {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px 7px 10px;
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.3;
    color: var(--color-foreground);
    background: var(--color-surface-2);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 1px var(--pointer-halo), var(--shadow-e3);
    transform-origin: var(--tail) 100%;
    transition: left var(--dur-2) var(--ease-out-quint), top var(--dur-2) var(--ease-out-quint), bottom var(--dur-2) var(--ease-out-quint);
    animation: pop var(--dur-3) var(--ease-out-quint) var(--dur-1) both;
  }

  .mark {
    display: flex;
    flex: none;
    color: var(--color-accent);
  }

  .text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag::after {
    content: '';
    position: absolute;
    left: calc(var(--tail) - 6px);
    bottom: -7px;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    background: var(--color-surface-2);
    border: solid var(--color-edge);
    border-width: 0 1px 1px 0;
    border-bottom-right-radius: 3px;
    transform: rotate(45deg);
  }

  [data-below='true'] .tag {
    transform-origin: var(--tail) 0;
  }

  /* Hung from its right edge: the tail is measured from there. */
  .tag[data-side='right'] {
    transform-origin: calc(100% - var(--tail)) 100%;
  }

  [data-below='true'] .tag[data-side='right'] {
    transform-origin: calc(100% - var(--tail)) 0;
  }

  .tag[data-side='right']::after {
    left: auto;
    right: calc(var(--tail) - 6px);
  }

  [data-below='true'] .tag::after {
    bottom: auto;
    top: -7px;
    border-width: 1px 0 0 1px;
    border-radius: 3px 0 0 0;
  }

  /* The frame: a quiet edge in the accent around the whole app, under any box, and the reason on
     a card of the app's surface hanging from its top edge. */
  .frame {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid var(--color-accent);
    border-radius: var(--radius-frame);
    box-shadow: 0 0 0 1px var(--pointer-halo), inset 0 0 0 1px var(--pointer-halo);
    animation: settle-frame var(--dur-3) var(--ease-out-quint) both;
  }

  .notice {
    position: absolute;
    top: 8px;
    left: 50%;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    max-width: calc(100% - 32px);
    padding: 7px 12px 7px 10px;
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.3;
    color: var(--color-foreground);
    background: var(--color-surface-2);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-lg);
    box-shadow: 0 0 0 1px var(--pointer-halo), var(--shadow-e3);
  }

  @keyframes settle-frame {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes settle {
    from { opacity: 0; transform: scale(1.14); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes echo {
    0% { opacity: 0.7; transform: scale(1); }
    70%, 100% { opacity: 0; transform: scale(1.18); }
  }

  @keyframes pop {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ring, .tag, .frame { animation: none; transition: none; }
    .echo { display: none; }
  }

  :global(html[data-motion='reduced']) .ring, :global(html[data-motion='reduced']) .tag { animation: none; transition: none; }
  :global(html[data-motion='reduced']) .echo { display: none; }
</style>
