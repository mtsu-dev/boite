<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ThreadState } from '../lib/thread-state';
  import { holdSpin, ringsStill } from '../lib/ring-budget.svelte';

  /**
   * A thread's state drawn around its picture, the same mark in every list:
   * an amber ring and dot when it needs the user, a turning accent arc while it
   * works, a dashed accent ring while work it left runs in the background, a
   * dashed grey ring while it waits for a slot, a red ring and a "!" mark when
   * it failed, a green dot when it finished something unread. At rest the
   * picture dims and wears nothing. Each state has its own shape, so it reads
   * without colour too: the failed mark carries a glyph, the waiting dot none.
   * `asking`: a question came in while the turn still runs, so the arc keeps
   * turning and a small amber dot says it needs the user too. Past
   * `RING_SPIN_LIMIT` working rings on screen the arcs hold still.
   *
   * The ring is decoration: the state's words stay with the row's time
   * (`ThreadState`), which carries them in its title and label. `stale`: the
   * thread's machine is away, so its last known state is not shown as live.
   * `ground` is the colour behind the picture, cut around the dots.
   */
  let { kind, size = 16, stale = false, asking = false, ground = 'var(--color-frame)', children }: { kind: ThreadState | null; size?: number; stale?: boolean; asking?: boolean; ground?: string; children: Snippet } = $props();

  type Ring = 'waiting' | 'working' | 'background' | 'queued' | 'error' | 'done' | 'rest';
  let ring = $derived.by((): Ring => {
    if (stale || kind === null) return 'rest';
    if (asking) return 'working';
    if (kind === 'waiting') return 'waiting';
    if (kind === 'error' || kind === 'interrupted') return 'error';
    if (kind === 'queued') return 'queued';
    if (kind === 'monitoring' || kind === 'background') return 'background';
    if (kind === 'done') return 'done';
    return 'working';
  });
  let asks = $derived(asking && ring === 'working');
  $effect(() => { if (ring === 'working') return holdSpin(); });
  let still = $derived(ring === 'working' && ringsStill());
</script>

<span class="ring {ring}" class:asks class:still style:--ring-size="{size}px" style:--ring-ground={ground} data-testid="state-ring" data-ring={ring} data-asking={asks || undefined} data-still={still || undefined} aria-hidden="true">
  <span class="picture">{@render children()}</span>
  {#if ring === 'working'}<span class="arc"></span>{/if}
  {#if ring === 'waiting' || ring === 'done' || asks}<span class="dot"></span>{/if}
  {#if ring === 'error'}<span class="dot mark">!</span>{/if}
</span>

<style>
  .ring {
    --ring-width: 1.5px;
    --ring-air: 2px;
    --ring-dot: max(6px, calc(var(--ring-size) * 0.32));
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: calc(var(--ring-size) + 2 * (var(--ring-width) + var(--ring-air)));
    height: calc(var(--ring-size) + 2 * (var(--ring-width) + var(--ring-air)));
    border-radius: 50%;
  }
  .ring::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: var(--ring-width) solid transparent;
    transition: border-color var(--dur-2) var(--ease-out-quint);
  }
  .picture {
    display: inline-grid;
    place-items: center;
    width: var(--ring-size);
    height: var(--ring-size);
    border-radius: 50%;
    overflow: hidden;
    transition: opacity var(--dur-2) var(--ease-out-quint);
  }
  .rest .picture { opacity: 0.72; }

  .waiting::before { border-color: var(--color-live-fill); }
  .error::before { border-color: var(--color-danger); }
  .queued::before { border-color: var(--color-muted-foreground); border-style: dashed; }
  /* The work it left running: a dashed accent ring turning slowly. */
  .background::before {
    border-color: var(--color-accent);
    border-style: dashed;
    animation: spin 6s linear infinite var(--loops);
  }
  /* At work: a faint full track, a quarter arc turning on it. */
  .working::before { border-color: color-mix(in oklch, var(--color-accent) 26%, transparent); }
  .arc {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: var(--ring-width) solid transparent;
    border-top-color: var(--color-accent);
    border-right-color: var(--color-accent);
    rotate: -45deg;
    animation: spin 1.1s linear infinite var(--loops);
  }

  .dot {
    position: absolute;
    width: var(--ring-dot);
    height: var(--ring-dot);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--ring-ground);
  }
  .waiting .dot { top: 0; right: 0; background: var(--color-live-fill); }
  /* The failed mark is a touch larger and carries "!", so it never reads as the waiting dot in greyscale. */
  .error .mark {
    top: -1px; right: -1px; display: grid; place-items: center;
    width: max(9px, calc(var(--ring-size) * 0.4)); height: max(9px, calc(var(--ring-size) * 0.4));
    background: var(--color-danger); color: var(--color-accent-ink);
    font-size: max(7px, calc(var(--ring-size) * 0.32)); font-weight: 800; line-height: 1;
  }
  /* Asked mid-turn: the arc keeps turning, a smaller amber dot sits on it. */
  .asks .dot { top: 0; right: 0; width: max(5px, calc(var(--ring-size) * 0.26)); height: max(5px, calc(var(--ring-size) * 0.26)); background: var(--color-live-fill); }
  .still .arc { animation: none; }
  .done .dot { right: 0; bottom: 0; background: var(--color-success); }

  /* An endless loop stops under reduced motion; the ring keeps its shape. */
  @media (prefers-reduced-motion: reduce) { .arc, .background::before { animation: none; } }
  :global(html[data-motion='reduced']) .arc,
  :global(html[data-motion='reduced']) .background::before { animation: none; }
</style>
