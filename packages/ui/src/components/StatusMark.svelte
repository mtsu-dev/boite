<script lang="ts">
  import type { StatusMarkProps } from '../lib/thread-state';

  /**
   * The ring every status wears: threads, agents, workflow runs and steps.
   * `threadTone` and `workflowTone` pick its tone and label. `corner` pins it
   * to the bottom right of a picture, cut out of it by a `--ring` halo.
   */
  let { tone, label, corner = false }: StatusMarkProps & { corner?: boolean } = $props();
</script>

{#if corner}
  <span class="corner"><span class="mark {tone}" title={label} aria-label={label} data-tone={tone}></span></span>
{:else}
  <span class="mark {tone}" title={label} aria-label={label} data-tone={tone}></span>
{/if}

<style>
  .mark {
    box-sizing: border-box;
    display: inline-block;
    width: var(--mark-size, 8px);
    height: var(--mark-size, 8px);
    border-radius: 50%;
    flex: none;
    background: transparent;
    border: 1.5px solid var(--color-edge);
    transition: background var(--dur-2) var(--ease-out-quint);
  }
  .mark.unread { background: var(--color-foreground); border-color: var(--color-foreground); }
  /* One shape per state, as the thread rows draw them (ThreadState.svelte): work is a still accent arc, a spinner
     at rest, the user's turn a filled amber dot, so the two never read alike at a glance; amber is kept for asks,
     red for failures, and a queued or paused step waits in grey. */
  .mark.running, .mark.queued {
    border-color: var(--color-accent);
    border-top-color: transparent;
    transform: rotate(45deg);
  }
  .mark.queued { border-color: var(--color-muted-foreground); border-top-color: transparent; }
  .mark.waiting { background: var(--color-live); border-color: var(--color-live); }
  .mark.paused { border-color: var(--color-muted-foreground); }
  .mark.skipped { border-color: var(--color-subtle); border-style: dashed; }
  .mark.error { background: var(--color-danger); border-color: var(--color-danger); }
  .mark.done { background: var(--color-success); border-color: var(--color-success); }
  .mark.stopped { background: var(--color-muted-foreground); border-color: var(--color-muted-foreground); }

  .corner {
    position: absolute;
    right: -3px;
    bottom: -3px;
    display: grid;
    place-items: center;
    padding: 2px;
    border-radius: 50%;
    background: var(--ring, var(--color-surface));
  }

</style>
