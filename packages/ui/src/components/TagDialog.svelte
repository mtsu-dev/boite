<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Plus, Tag, X } from '@lucide/svelte';
  import { PROJECT_TAG_MAX, PROJECT_TAGS_MAX } from '@boite/contracts';
  import { Closing } from '../lib/closing.svelte';
  import { mobileOverlay } from '../lib/mobile-history';
  import { tagEditor, type TagRequest } from '../lib/tag-editor.svelte';
  import { focusInitial, focusedElement, restoreFocus } from '../lib/focus';
  import { fill, strings } from '../lib/strings';

  /**
   * One project's tags: the ones it carries as chips, a field for a new one,
   * and the tags other projects already carry, one tap each. Nothing is sent
   * before Save; Escape, Cancel and the scrim leave the project as it was.
   */
  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';
  const overlay = new Closing();
  /** The request is nulled the moment it is answered, so the exit plays on a copy. */
  let held = $state<TagRequest | null>(null);
  let card = $state<HTMLDivElement>();
  let field = $state<HTMLInputElement>();
  let asking = false;
  let previous: HTMLElement | null = null;
  const uid = $props.id();

  $effect(() => {
    const current = tagEditor.current;
    if (!current) {
      overlay.hide();
      if (asking) untrack(giveBack);
      asking = false;
      return;
    }
    if (!asking) previous = untrack(focusedElement);
    asking = true;
    held = current;
    overlay.show();
    void tick().then(() => focusInitial(field, card));
  });
  $effect(() => { if (overlay.open) return mobileOverlay(() => tagEditor.cancel()); });

  function giveBack() {
    const active = document.activeElement;
    if (!active || active === document.body || card?.contains(active)) restoreFocus(previous);
    previous = null;
  }

  function onkeydown(event: KeyboardEvent) {
    if (!tagEditor.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      tagEditor.cancel();
      return;
    }
    if (event.key === 'Tab') trap(event);
  }

  /** Enter adds what is typed, or saves an empty field; Backspace in an empty field takes the last tag off. */
  function fieldKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (tagEditor.typed.trim()) tagEditor.add();
      else tagEditor.save();
    } else if (event.key === 'Backspace' && tagEditor.typed === '' && tagEditor.tags.length > 0) {
      tagEditor.remove(tagEditor.tags.at(-1)!);
    }
  }

  function trap(event: KeyboardEvent) {
    const stops = Array.from(card?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = active instanceof Node && !!card?.contains(active);
    if (active !== card && (event.shiftKey ? inside && active !== first : inside && active !== last)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }

  /** Removing a chip keeps the keyboard in the dialog: on the field, where the next tag goes. */
  function remove(tag: string) {
    tagEditor.remove(tag);
    field?.focus({ preventScroll: true });
  }

  function pick(tag: string) {
    tagEditor.add(tag);
    field?.focus({ preventScroll: true });
  }

  const note = $derived(tagEditor.tooLong ? fill(strings.sidebar.tags.tooLong, { length: String(PROJECT_TAG_MAX) })
    : tagEditor.full ? fill(strings.sidebar.tags.full, { count: String(PROJECT_TAGS_MAX) })
    : fill(strings.sidebar.tags.limits, { count: String(PROJECT_TAGS_MAX), length: String(PROJECT_TAG_MAX) }));
  const warn = $derived(tagEditor.tooLong || tagEditor.full);
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if overlay.shown && held}
  {@const request = held}
  <div class="scrim" class:closing={overlay.closing} role="presentation" use:overlay.attach onanimationend={overlay.end}
    onclick={(event) => { if (event.target === event.currentTarget) tagEditor.cancel(); }}>
    <div class="dialog" class:closing={overlay.closing} role="dialog" aria-modal="true" aria-labelledby="{uid}-title" tabindex="-1" bind:this={card} data-testid="tag-dialog">
      <h2 id="{uid}-title">{fill(strings.sidebar.tags.title, { project: request.project })}</h2>

      <ul class="held" aria-label={strings.sidebar.tags.current} data-testid="tag-dialog-tags">
        {#each tagEditor.tags as tag (tag)}
          <li class="chip">
            <Tag size={12} aria-hidden="true" /><span>{tag}</span>
            <button type="button" class="ghost icon unchip" aria-label={fill(strings.sidebar.tags.remove, { tag })} title={fill(strings.sidebar.tags.remove, { tag })}
              data-testid="tag-dialog-remove" onclick={() => remove(tag)}><X size={12} /></button>
          </li>
        {:else}
          <li class="none">{strings.sidebar.tags.none}</li>
        {/each}
      </ul>

      <label class="field-label" for="{uid}-field">{strings.sidebar.tags.inputLabel}</label>
      <div class="entry">
        <input id="{uid}-field" bind:this={field} bind:value={tagEditor.typed} placeholder={strings.sidebar.tags.placeholder}
          autocomplete="off" autocapitalize="off" spellcheck="false" aria-invalid={tagEditor.tooLong} aria-describedby="{uid}-note"
          disabled={tagEditor.full} data-testid="tag-dialog-input" onkeydown={fieldKey} />
        <button type="button" data-testid="tag-dialog-add" disabled={!tagEditor.typed.trim() || tagEditor.tooLong || tagEditor.full} onclick={() => { tagEditor.add(); field?.focus(); }}>
          <Plus size={14} /><span class="ui-label">{strings.sidebar.tags.add}</span>
        </button>
      </div>
      <p id="{uid}-note" class="note" class:warn>{note}</p>

      {#if tagEditor.suggestions.length > 0 && !tagEditor.full}
        <div class="known">
          <h3 class="ui-label" id="{uid}-known">{strings.sidebar.tags.known}</h3>
          <div class="offers" role="group" aria-labelledby="{uid}-known" data-testid="tag-dialog-known">
            {#each tagEditor.suggestions as tag (tag)}
              <button type="button" class="ghost offer" onclick={() => pick(tag)}><Plus size={12} aria-hidden="true" /><span>{tag}</span></button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="actions">
        <button type="button" class="ghost" data-testid="tag-dialog-cancel" onclick={() => tagEditor.cancel()}><span class="ui-label">{strings.common.cancel}</span></button>
        <button type="button" class="primary" data-testid="tag-dialog-save" disabled={tagEditor.tooLong} onclick={() => tagEditor.save()}><span class="ui-label">{strings.common.save}</span></button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-scrim);
    animation: fade var(--dur-2) var(--ease-out-quint);
  }
  .scrim.closing { animation-name: fade-out; pointer-events: none; }
  .dialog {
    width: min(400px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 18px 18px 14px;
    background: var(--color-surface);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-e3);
    animation: pop var(--dur-2) var(--ease-out-quint);
  }
  .dialog.closing { animation-name: pop-out; }
  h2 { font-size: var(--text-md); margin-bottom: 12px; overflow-wrap: anywhere; }

  /* The tags the project carries: labels you can hold, each with its own way off. */
  .held { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; padding: 0; list-style: none; min-height: 28px; align-items: center; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    height: 28px;
    padding: 0 2px 0 9px;
    border-radius: var(--radius-full);
    background: var(--color-accent-soft);
    color: var(--color-foreground);
    font-size: var(--text-sm);
  }
  .chip > :global(svg) { flex: none; color: var(--color-accent); }
  .chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unchip { width: 24px; height: 24px; min-height: 0; border-radius: var(--radius-full); color: var(--color-muted-foreground); }
  .unchip:hover { color: var(--color-foreground); background: var(--color-hover); }
  .none { color: var(--color-muted-foreground); font-size: var(--text-sm); }

  .field-label { display: block; margin-bottom: 6px; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .entry { display: flex; align-items: center; gap: 6px; }
  .entry input { flex: 1; min-width: 0; }
  /* The field's height, not a button's: the two sit side by side as one control. */
  .entry button { flex: none; gap: 4px; height: var(--input); }
  .note { margin: 6px 0 0; font-size: var(--text-xs); color: var(--color-subtle); }
  .note.warn { color: var(--color-danger); }

  .known { margin-top: 14px; }
  .known h3 { margin: 0 0 6px; font-size: var(--text-xs); font-weight: 500; color: var(--color-subtle); }
  .offers { display: flex; flex-wrap: wrap; gap: 4px; }
  /* An offer is drawn as an outline of a chip: the same shape, not held yet. */
  .offer {
    height: 26px;
    min-height: 0;
    gap: 4px;
    max-width: 100%;
    padding: 0 9px 0 7px;
    border: 1px dashed var(--color-edge);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    transition: color var(--dur-1) var(--ease-out-quint), border-color var(--dur-1) var(--ease-out-quint), background var(--dur-1) var(--ease-out-quint);
  }
  .offer span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .offer:hover { color: var(--color-foreground); border-color: var(--color-accent); border-style: solid; background: var(--color-hover); }

  .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 18px; }

  @media (max-width: 720px) {
    .chip { height: 32px; }
    .unchip { width: 28px; height: 28px; }
    .offer { height: var(--control-touch); }
    .entry input, .entry button, .actions button { min-height: var(--touch-target); }
  }
  @media (prefers-reduced-motion: reduce) { .offer { transition: none; } }
</style>
