<script lang="ts">
  /**
   * The one working mark of the stream, the bots and their desk: a ring whose
   * live arc turns. `paused` holds it while the page is hidden or the turn waits.
   * `stale` is work last seen running on a machine out of reach: a still grey
   * ring, since nothing says it still turns.
   */
  let { size = 12, paused = false, stale = false, label }: { size?: number; paused?: boolean; stale?: boolean; label?: string } = $props();
</script>

<span class="spinner" class:paused class:stale style:--spinner-size="{size}px" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    box-sizing: border-box;
    width: var(--spinner-size);
    height: var(--spinner-size);
    border-radius: var(--radius-full);
    border: 1.5px solid var(--color-edge);
    /* Working is the accent; amber says only that something needs you. */
    border-top-color: var(--color-accent);
    animation: spin 0.9s steps(54) infinite var(--loops);
  }

  .paused { animation-play-state: paused; }
  .stale { animation: none; border-top-color: var(--color-edge); }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  :global(html[data-motion='reduced']) .spinner { animation: none; }
</style>
