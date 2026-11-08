<script lang="ts">
  import { Clock, Paperclip, Pencil, X } from '@lucide/svelte';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The prompts waiting behind the running turn, one dimmed line each inside
   * the composer card, over its field: a clock, then its text cut to the line,
   * then edit and remove. Edit (or a click on the text) takes it back into the
   * box; Send now, at the end of the last line, sends them all.
   * One written while the machine was away says so in place of "Queued", or
   * says why the core refused it, with Send again; the x removes it. Why they
   * wait is one "i" away.
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
    /** What Send now would do: interrupt the turn, resume the held queue, or nothing. */
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onremove?: (at: number) => void;
    onretry?: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  let outbox = $derived(queued.length > 0 && queued.every((entry) => entry.request));
  let why = $derived(outbox && starts ? fill(strings.composer.outboxStarts, { machine }) : outbox ? strings.composer.outboxKept : paused ? strings.composer.queuedPaused : strings.composer.queued);
</script>

<div class="queued" data-testid="composer-queued">
  {#each queued as entry, at (entry)}
    {@const failed = entry.request?.failed}
    <div class="line" class:failed={failed !== undefined} data-testid="composer-queued-item">
      {#if failed !== undefined}
        <span class="state error" data-testid="composer-outbox-failed" title={fill(strings.composer.outboxFailed, { reason: failed })}>{fill(strings.composer.outboxFailed, { reason: failed })}</span>
      {:else if entry.request}
        <span class="state" data-testid="composer-outbox-pending"><Clock size={12} /><span class="word">{at < outgoing ? strings.composer.outboxSending
          : connected ? strings.composer.outboxNext : fill(strings.composer.outboxWaiting, { machine })}</span></span>
      {:else}
        <!-- The clock says it waits; the word stays for screen readers, the "i" says why. -->
        <span class="state"><Clock size={12} /><span class="visually-hidden">{strings.composer.queuedLabel}</span></span>
      {/if}
      <button type="button" class="text"
        title={strings.composer.editQueued}
        disabled={disabled || !!entry.request?.start}
        onclick={() => onrestore(at)}>{entry.text || strings.composer.attachAlt}</button>
      {#if entry.attachments.length}<span class="extra"><Paperclip size={12} />{entry.attachments.length}</span>{/if}
      {#if entry.previewReferences?.length}<span class="extra">@{entry.previewReferences.length}</span>{/if}
      {#if at === 0}<InfoTip text={why} topic={strings.composer.queuedLabel} testid="composer-queued-why" />{/if}
      {#if sendNow && at === queued.length - 1}
        <button type="button" class="ghost small send-now" data-testid="composer-send-now"
          title={sendNow === 'steer' ? strings.composer.sendNowHint : strings.composer.retryQueuedHint}
          onclick={onsendnow}><span class="ui-label">{strings.composer.sendNow}</span></button>
      {/if}
      {#if failed !== undefined && onretry}
        <button type="button" class="ghost small" data-testid="composer-outbox-retry" disabled={sending} onclick={() => onretry(at)}><span class="ui-label">{strings.composer.outboxRetry}</span></button>
      {/if}
      <!-- Answers already given come with no remove: they are not the user's to edit either. -->
      {#if onremove}
        <button type="button" class="ghost icon tool" data-testid="composer-queued-edit"
          title={strings.composer.editQueued} aria-label={strings.composer.editQueued}
          disabled={disabled || !!entry.request?.start} onclick={() => onrestore(at)}><Pencil size={12} /></button>
        <button type="button" class="ghost icon tool" data-testid="composer-queued-remove"
          title={strings.composer.removeQueued} aria-label={strings.composer.removeQueued}
          disabled={at < outgoing || !!entry.request?.start} onclick={() => onremove(at)}><X size={12} /></button>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* Dimmed lines inside the card, over its field: no frame and no fill, so the
     decision stays the one card above the text. Each held prompt is cut to one
     line, its clock before it, edit and remove at its end. */
  .queued {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    max-height: 30vh;
    overflow-y: auto;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: 26px;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    animation: rise var(--motion-in);
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    white-space: nowrap;
  }

  .state.error { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; color: var(--color-danger); }

  /* The text takes the line's room, so every line's controls end at the same edge. */
  .text {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    height: auto;
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
    color: inherit;
    font-weight: 400;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text:hover:not(:disabled) { background: none; color: var(--color-foreground); }
  /* Still waiting to go while the box holds other text: the line stays legible. */
  .text:disabled { opacity: 1; }

  .extra { display: inline-flex; align-items: center; gap: 3px; flex: none; font-size: var(--text-xs); }
  .line :global(.info-tip) { flex: none; margin: 0; }
  .tool { flex: none; width: 22px; height: 22px; border-radius: var(--radius-full); color: inherit; }
  .tool:hover:not(:disabled) { color: var(--color-foreground); }
  .line .ghost.small { flex: none; height: 22px; padding: 0 6px; font-size: var(--text-xs); }
  /* Send now is the line's one word in ink: it acts on the whole queue. */
  .line .send-now { color: var(--color-foreground); font-weight: 550; }

  @media (max-width: 720px) {
    .line { min-height: var(--touch-target); }
    /* A phone gives the prompt up to two lines rather than cutting it on the first, the whole line a target. */
    .text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; padding-block: 12px; line-height: 1.3; white-space: normal; overflow-wrap: anywhere; }
    .tool { width: 32px; height: 32px; }
    .line .ghost.small { height: 32px; }
  }
  /* A 360 px phone keeps the line for the prompt: the outbox's word goes, the "i" still says why. */
  @media (max-width: 400px) { .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
</style>
