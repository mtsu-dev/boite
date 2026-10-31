<script lang="ts">
  import { onMount } from 'svelte';
  import { startTheme } from './lib/theme';
  import { pointerRing, pointerTag, type PointerLayout } from './lib/pointer-layout';

  /**
   * The box `boite window point` shows the user, in a transparent,
   * click-through window of its own above every other (`pointer_window.rs`).
   * The shell says where the control is in this page's pixels; the page draws
   * a rounded ring around it in the user's accent and the label in a bubble
   * whose tail points at the ring. One entrance, then one echo that keeps widening and fading: the
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
      const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
      const moved = await listen<PointerLayout>('pointer://layout', (event) => place(event.payload));
      const hidden = await listen('pointer://hide', () => { layout = null; });
      if (disposed) { moved(); hidden(); return; }
      stops.push(moved, hidden);
      // A box placed before this page ran is read once here.
      const current = await invoke<PointerLayout | null>('pointer_layout');
      if (current && layout === null) place(current);
    })();
    return () => { disposed = true; stopTheme(); window.removeEventListener('resize', resize); for (const stop of stops) stop(); };
  });
</script>

{#if layout && ring}
  {#key shown}
    <div class="pointer" data-testid="pointer" data-below={layout.below} data-shape={layout.look.shape}>
      <div class="ring" style:left="{ring.left}px" style:top="{ring.top}px" style:width="{ring.width}px" style:height="{ring.height}px">
        <span class="echo"></span>
      </div>
      {#if layout.label && tag}
        <div class="tag" data-testid="pointer-label" style:left="{tag.left}px" style:top={tag.top === null ? 'auto' : `${tag.top}px`}
          style:bottom={tag.bottom === null ? 'auto' : `${tag.bottom}px`} style:max-width="{tag.maxWidth}px" style:--tail="{tag.tail}px"><span>{layout.label}</span></div>
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

  /* The label: a pill in the accent whose tail points at the ring. The
     drop-shadows follow the tail too, so the bubble reads as one shape. */
  .tag {
    position: absolute;
    box-sizing: border-box;
    padding: 7px 14px 8px;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.005em;
    color: var(--color-accent-ink);
    background: var(--color-accent);
    border-radius: var(--radius-full);
    filter: drop-shadow(0 0 0.5px var(--pointer-halo)) drop-shadow(0 6px 14px var(--pointer-shade));
    transform-origin: var(--tail) 100%;
    transition: left var(--dur-2) var(--ease-out-quint), top var(--dur-2) var(--ease-out-quint), bottom var(--dur-2) var(--ease-out-quint);
    animation: pop var(--dur-3) var(--ease-out-quint) var(--dur-1) both;
  }

  .tag span {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag::after {
    content: '';
    position: absolute;
    left: calc(var(--tail) - 6px);
    bottom: -5px;
    width: 12px;
    height: 12px;
    background: inherit;
    border-radius: 0 0 3px 0;
    transform: rotate(45deg);
  }

  [data-below='true'] .tag {
    transform-origin: var(--tail) 0;
  }

  [data-below='true'] .tag::after {
    bottom: auto;
    top: -5px;
    border-radius: 3px 0 0 0;
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
    .ring, .tag { animation: none; transition: none; }
    .echo { display: none; }
  }

  :global(html[data-motion='reduced']) .ring, :global(html[data-motion='reduced']) .tag { animation: none; transition: none; }
  :global(html[data-motion='reduced']) .echo { display: none; }
</style>
