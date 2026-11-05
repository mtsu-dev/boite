<script lang="ts" module>
  /** How long "Saved" stays before it fades: long enough to read after the click. */
  export const SAVED_SHOWN_MS = 2600;
  /** The fade itself; past it the mark is gone even where no animation ran (reduced motion, jsdom). */
  const FADE_MS = 400;
</script>

<script lang="ts">
  import { Check } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The proof that a setting stored: a check and "Saved" beside what saved it,
   * fading after a few seconds. A form with its own Save button passes `stamp`,
   * a number it raises after each save that succeeded (0 shows nothing); a
   * status that mounts it only once saved (`SaveStatus`) leaves `stamp` out and
   * the mark shows from its mount. A failed save raises nothing, so its own
   * error stands alone.
   */
  let { stamp, testid = 'saved-mark', announce = true }: { stamp?: number; testid?: string; /** False inside a status that already announces. */ announce?: boolean } = $props();
  let phase = $state<'hidden' | 'shown' | 'leaving'>('hidden');

  $effect(() => {
    if (stamp === 0) return;
    void stamp;
    phase = 'shown';
    const leave = setTimeout(() => { phase = 'leaving'; }, SAVED_SHOWN_MS);
    const gone = setTimeout(() => { phase = 'hidden'; }, SAVED_SHOWN_MS + FADE_MS);
    return () => { clearTimeout(leave); clearTimeout(gone); };
  });
</script>

{#if phase !== 'hidden'}
  <span class="saved-mark" class:leaving={phase === 'leaving'} role={announce ? 'status' : undefined} data-testid={testid}><Check size={12} strokeWidth={2.25} aria-hidden="true" /><span class="ui-label">{strings.settings.autosave.saved}</span></span>
{/if}

<style>
  .saved-mark {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 400;
    white-space: nowrap;
    animation: fade var(--dur-2) var(--ease-out-quint);
  }
  .saved-mark :global(svg) {
    color: var(--color-success);
  }
  .saved-mark.leaving {
    animation: fade-out var(--dur-3) var(--ease-out-quint) forwards;
  }
</style>
