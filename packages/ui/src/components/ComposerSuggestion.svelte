<script lang="ts">
  import { X } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * The agent's suggested next message on a phone, which has no Tab: a chip
   * above the empty box, its text cut to one line. A tap writes it in as a
   * draft to edit; the x dismisses it for this turn. A desktop shows the
   * same suggestion as ghost text in the field instead (ComposerField).
   */
  let { text, ontake, ondismiss }: { text: string; ontake: () => void; ondismiss: () => void } = $props();
</script>

<div class="suggestion-chip" data-testid="composer-suggestion-chip">
  <button type="button" class="use" data-testid="composer-suggestion-use" aria-label={fill(strings.composer.suggestion.use, { text })} onclick={ontake}><span class="text">{text}</span></button>
  <button type="button" class="dismiss" data-testid="composer-suggestion-dismiss" aria-label={strings.composer.suggestion.dismiss} title={strings.composer.suggestion.dismiss} onclick={ondismiss}><X size={14} strokeWidth={2.25} /></button>
</div>

<style>
  .suggestion-chip {
    display: none;
    align-items: center;
    gap: var(--space-1);
    max-width: calc(100% - 2 * var(--space-3));
    margin: var(--space-2) var(--space-3) 0;
    padding: 0 0 0 var(--space-3);
    min-height: var(--control-touch);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    transition: background-color var(--dur-1) var(--ease-out-quint);
  }
  .suggestion-chip:hover { background: var(--color-hover); }
  .use {
    flex: 1 1 auto;
    display: block;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  /* A button centres what overflows it: the text cuts itself short at its end instead. */
  .text { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dismiss {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--control-touch);
    height: var(--control-touch);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: none;
    color: inherit;
  }
  /* A phone, or any touch screen, has no Tab: the chip stands for the field's ghost text. */
  @media (max-width: 720px), (pointer: coarse) { .suggestion-chip { display: inline-flex; } }
</style>
