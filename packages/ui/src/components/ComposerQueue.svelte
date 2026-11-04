<script lang="ts">
  import { ChevronUp, Clock, Paperclip, X } from '@lucide/svelte';
  import { slide } from 'svelte/transition';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import { fill, strings } from '../lib/strings';
  import { glides } from '../lib/motion';

  /**
   * The prompts waiting behind the running turn, as chips on the composer's top
   * edge: `Queued: <first words>`, the rest behind an ellipsis. Opening one shows
   * the whole text with Edit, which takes it back into the box; Send now sends
   * them together. One written while the machine was away says what it waits
   * for, or why the core refused it, with Send again; any of them can be removed.
   */
  let {
    queued,
    disabled,
    paused,
    sending = false,
    outgoing = 0,
    connected = true,
    machine = '',
    starts = false,
    sendNow,
    onrestore,
    onremove,
    onretry,
    onsendnow
  }: {
    queued: { text: string; attachments: Attachment[]; previewReferences?: PreviewReference[]; request?: OutboxRequest }[];
    /** A prompt comes back only into an empty box, and never while one is going out. */
    disabled: boolean;
    /** A refusal held the queue: nothing goes until the user says so. */
    paused: boolean;
    /** The first prompt is going out now. */
    sending?: boolean;
    /** How many entries at the head are going out from the queue: they cannot be removed. */
    outgoing?: number;
    /** The machine answers: an outbox prompt waits for the thread, not for it. */
    connected?: boolean;
    machine?: string;
    /** A draft's queue: its first prompt starts the conversation once the machine is back. */
    starts?: boolean;
    /** What Send now would do: steer the turn, resume the held queue, or nothing. */
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onremove?: (at: number) => void;
    onretry?: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  type Entry = (typeof queued)[number];

  let outbox = $derived(queued.length > 0 && queued.every((entry) => entry.request));
  /** What the old caption under the bubbles said: now the chip's tooltip and the opened view's foot. */
  let caption = $derived(outbox && starts ? fill(strings.composer.outboxStarts, { machine }) : outbox ? strings.composer.outboxKept : paused ? strings.composer.queuedPaused : strings.composer.queued);
  let label = $derived(paused ? strings.composer.heldChip : strings.composer.queuedChip);
  /** The entry opened, by identity: a send ahead of it shifts the indexes, not the object.
      Raw, so the entry is kept as it is and not wrapped in a proxy that would equal no entry. */
  let opened = $state.raw<Entry | null>(null);
  $effect(() => { if (opened && !queued.includes(opened)) opened = null; });
  const uid = $props.id();

  /** The chip's words: the text on one line, cut by the chip's own width. */
  const firstWords = (text: string) => text.replace(/\s+/g, ' ').trim();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="queued" data-testid="composer-queued" onkeydown={(event) => {
  if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); opened = null; }
}}>
  {#each queued as entry, at (entry)}
    {@const open = opened === entry}
    {@const failed = entry.request?.failed !== undefined}
    <div class="queued-item" class:failed class:open data-testid="composer-queued-item">
      {#if open}
        <div class="queued-full" id="{uid}-{at}" data-testid="composer-queued-full" transition:slide={{ duration: glides() ? 160 : 0 }}>
          <p class="queued-body">{entry.text || strings.composer.attachAlt}</p>
          <div class="queued-full-foot">
            <span class="ui-label caption">{caption}</span>
            <button type="button" class="ghost small" data-testid="composer-queued-edit"
              title={strings.composer.editQueued}
              disabled={disabled || !!entry.request?.start}
              onclick={() => { opened = null; onrestore(at); }}><span class="ui-label">{strings.composer.editQueuedShort}</span></button>
          </div>
        </div>
      {/if}
      <div class="queued-row">
        <span class="chip">
          <button type="button" class="queued-bubble"
            title={caption}
            aria-expanded={open}
            aria-controls="{uid}-{at}"
            aria-label="{label}: {firstWords(entry.text || strings.composer.attachAlt)}. {open ? strings.composer.hideQueued : strings.composer.showQueued}"
            onclick={() => (opened = open ? null : entry)}>
            <span class="prefix">{label}:</span>
            <span class="queued-text">{firstWords(entry.text || strings.composer.attachAlt)}</span>
            {#if entry.attachments.length}<span class="extra"><span class="ui-label">{entry.attachments.length}</span><Paperclip size={12} /></span>{/if}
            {#if entry.previewReferences?.length}<span class="extra">@{entry.previewReferences.length}</span>{/if}
            <span class="fold" aria-hidden="true"><ChevronUp size={13} strokeWidth={2} /></span>
          </button>
          {#if onremove}
            <button type="button" class="queued-remove" data-testid="composer-queued-remove"
              title={strings.composer.removeQueued} aria-label={strings.composer.removeQueued}
              disabled={at < outgoing || !!entry.request?.start} onclick={() => onremove(at)}><X size={13} strokeWidth={2} /></button>
          {/if}
        </span>
        {#if failed}
          <span class="queued-error" data-testid="composer-outbox-failed" title={fill(strings.composer.outboxFailed, { reason: entry.request!.failed! })}>{fill(strings.composer.outboxFailed, { reason: entry.request!.failed! })}</span>
          {#if onretry}
            <button type="button" class="ghost small" data-testid="composer-outbox-retry" disabled={sending} onclick={() => onretry(at)}><span class="ui-label">{strings.composer.outboxRetry}</span></button>
          {/if}
        {:else if entry.request}
          <span class="queued-pending" data-testid="composer-outbox-pending"><Clock size={12} />{at < outgoing ? strings.composer.outboxSending
            : connected ? strings.composer.outboxNext : fill(strings.composer.outboxWaiting, { machine })}</span>
        {/if}
        {#if sendNow && at === queued.length - 1}
          <button type="button" class="ghost small send-now" data-testid="composer-send-now"
            title={sendNow === 'steer' ? strings.composer.sendNowHint : strings.composer.retryQueuedHint}
            onclick={onsendnow}><span class="ui-label">{strings.composer.sendNow}</span></button>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  /* The chips sit on the composer's top edge, in its column. */
  .queued {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    width: min(calc(100% - 40px), var(--content));
    max-height: 35vh;
    margin: 0 auto 6px;
    overflow-y: auto;
  }

  .queued-item { display: flex; flex-direction: column; gap: 4px; flex: none; min-width: 0; animation: rise var(--dur-3) var(--ease-out-quint); }

  .queued-row { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 28px; }

  /* One pill: the opener and its ×, no outline of its own beyond the surface step. */
  .chip {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    max-width: min(100%, 520px);
    height: 28px;
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-foreground);
    box-shadow: inset 0 0 0 1px var(--color-border);
  }
  .failed .chip { box-shadow: inset 0 0 0 1px var(--color-danger); }

  .queued-bubble {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    min-width: 0;
    height: 28px;
    min-height: 0;
    padding: 0 6px 0 12px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 400;
    text-align: left;
    cursor: pointer;
  }
  .queued-bubble:hover, .queued-bubble:focus-visible { background: var(--color-hover); }
  .chip:has(.queued-remove) .queued-bubble { border-top-right-radius: 0; border-bottom-right-radius: 0; }

  .prefix { flex: none; color: var(--color-muted-foreground); font-weight: 500; }
  .queued-text { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 20px; }
  .extra { display: inline-flex; flex: none; align-items: center; gap: 3px; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .fold { display: inline-flex; flex: none; color: var(--color-muted-foreground); transition: rotate var(--dur-2) var(--ease-out-quint); }
  .open .fold { rotate: 180deg; }

  .queued-remove {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0 999px 999px 0;
    background: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }
  .queued-remove:hover:not(:disabled), .queued-remove:focus-visible { background: var(--color-hover); color: var(--color-foreground); }

  .queued-pending { display: inline-flex; flex: none; align-items: center; gap: 4px; color: var(--color-muted-foreground); font-size: var(--text-xs); white-space: nowrap; }
  .queued-error { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-danger); font-size: var(--text-xs); }
  .queued-row :global(button.small) { flex: none; font-size: var(--text-xs); }
  .send-now { margin-left: auto; }

  /* Opened: the whole message above its chip, so the chip stays on the edge. */
  .queued-full {
    padding: 10px 12px 8px;
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    box-shadow: inset 0 0 0 1px var(--color-border);
  }
  .queued-body { margin: 0; max-height: 24vh; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
  .queued-full-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .queued-full-foot button { flex: none; font-size: var(--text-xs); }
  .caption { min-width: 0; }

  @media (max-width: 720px) {
    .queued { width: calc(100% - 20px); }
    /* A finger's target grows past the 28 px pill; the pill keeps its height. */
    .queued-bubble, .queued-remove { position: relative; }
    .queued-bubble::after, .queued-remove::after { content: ''; position: absolute; inset: -8px 0; }
  }
  @media (prefers-reduced-motion: reduce) { .queued-item { animation: none; } }
</style>
