<script lang="ts">
  import ModalScrim from './ModalScrim.svelte';
  import PrivateText from './PrivateText.svelte';
  import { tick } from 'svelte';
  import { Closing } from '../lib/closing.svelte';
  import { mobileOverlay } from '../lib/mobile-history';
  import { confirm, type ConfirmRequest } from '../lib/confirm.svelte';
  import { focusInitial, trapModalTab } from '../lib/focus';
  import { count } from '../lib/format';
  import { fill } from '../lib/strings';

  const overlay = new Closing();
  /** The request is nulled the moment it is answered, so the exit plays on a copy. */
  let held = $state<ConfirmRequest | null>(null);
  let card = $state<HTMLDivElement | undefined>(undefined);
  // A dangerous action opens on Cancel; a plain one opens on Confirm.
  $effect(() => {
    const current = confirm.current;
    if (!current) {
      overlay.hide();
      return;
    }
    held = current;
    overlay.show();
    void tick().then(() => {
      const target = card?.querySelector<HTMLElement>(current.requiredText !== undefined || current.initialText !== undefined ? '[data-testid=confirm-name]' : current.note ? '[data-testid=confirm-note]' : current.danger ? '[data-cancel]' : '[data-confirm]');
      focusInitial(target, card);
      if (current.initialText !== undefined && target instanceof HTMLInputElement) target.select();
    });
  });

  $effect(() => { if (overlay.open) return mobileOverlay(() => confirm.answer(false)); });

  function onkeydown(event: KeyboardEvent) {
    if (!confirm.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      confirm.answer(false);
      return;
    }
    trapModalTab(event, card);
    if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement && card?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      confirm.answer(true);
    }
  }

</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if overlay.shown && held}
  {@const request = held}
  <ModalScrim {overlay} onclose={() => confirm.answer(false)}>
    <div
      class="dialog"
      class:closing={overlay.closing}
      role={request.initialText !== undefined || request.note ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby={request.body ? 'confirm-body' : undefined}
      tabindex="-1"
      bind:this={card}
      data-testid="confirm-dialog"
    >
      <h2 id="confirm-title"><PrivateText text={request.title} /></h2>
      {#if request.body}
        <p id="confirm-body" class="muted">{request.body}</p>
      {/if}
      {#if request.requiredText !== undefined || request.initialText !== undefined}
        <label class="name-field" for="confirm-name">{request.inputLabel}
          <input id="confirm-name" data-testid="confirm-name" bind:value={confirm.typed} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
        </label>
        {#if request.requiredText !== undefined}<p class="required-name">{request.requiredText}</p>{/if}
      {/if}
      {#if request.note}
        {@const note = request.note}
        <label class="note-field" for="confirm-note">{note.label}
          <textarea id="confirm-note" data-testid="confirm-note" rows="4" maxlength={note.max} placeholder={note.placeholder} bind:value={confirm.typed} aria-describedby="confirm-note-hint"></textarea>
        </label>
        <!-- The help and the count share a line with room between them, and wrap apart on a narrow screen. -->
        <div class="note-foot">
          <span id="confirm-note-hint">{note.hint}</span>
          <span class="note-count" data-testid="confirm-note-count">{fill(note.count, { count: count(confirm.typed.length), max: count(note.max) })}</span>
        </div>
      {/if}
      <div class="actions">
        <button type="button" class="ghost" data-cancel data-testid="confirm-cancel" onclick={() => confirm.answer(false)}>
          <span class="ui-label">{request.cancelLabel}</span>
        </button>
        {#if request.altLabel}
          <button type="button" data-testid="confirm-alt" disabled={request.requiredText !== undefined && confirm.typed !== request.requiredText} onclick={() => confirm.answer('alt')}><span class="ui-label">{request.altLabel}</span></button>
        {/if}
        <button
          type="button"
          class:primary={!request.danger}
          class:destructive={request.danger}
          data-confirm
          data-testid="confirm-ok"
          disabled={(request.requiredText !== undefined && confirm.typed !== request.requiredText) || (request.initialText !== undefined && !confirm.typed.trim())}
          onclick={() => confirm.answer(true)}
        >
          <span class="ui-label">{request.confirmLabel}</span>
        </button>
      </div>
    </div>
  </ModalScrim>
{/if}

<style>
  .dialog {
    width: min(380px, calc(100vw - 32px));
    padding: var(--space-5) var(--space-5) var(--space-4);
    /* The overlay card every menu and sheet wears (app.css). */
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    animation: pop var(--motion-duration) var(--motion-curve);
  }

  .dialog.closing {
    animation: pop-out var(--motion-duration) var(--motion-curve);
  }

  h2 {
    font-size: var(--text-md);
    font-weight: 600;
    margin-bottom: var(--space-2);
    overflow-wrap: anywhere;
  }

  p {
    margin-bottom: 4px;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .name-field { display: grid; gap: 6px; margin-top: 12px; }
  .name-field input { width: 100%; min-width: 0; }
  .required-name { margin-top: var(--space-2); font-weight: 600; }
  .note-field { display: grid; gap: 6px; margin-top: var(--space-3); }
  .note-field textarea { width: 100%; min-width: 0; resize: vertical; }
  .note-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px var(--space-3);
    margin-top: 6px;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .note-count { margin-left: auto; font-variant-numeric: tabular-nums; }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .destructive {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-on-danger);
  }

  @media (hover: hover) {
    .destructive:hover:not(:disabled) {
      background: var(--color-danger-hover);
    }
  }
</style>
