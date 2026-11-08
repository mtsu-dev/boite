<script lang="ts">
  import { Clock, Paperclip, X } from '@lucide/svelte';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The prompts waiting behind the running turn, one quiet chip each inside
   * the composer, over its field: a clock, then its text cut to the line. A
   * click on the text takes it back into the box; Send now sends them all.
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
    <div class="chip" class:failed={failed !== undefined} data-testid="composer-queued-item">
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
      {#if failed !== undefined && onretry}
        <button type="button" class="ghost small" data-testid="composer-outbox-retry" disabled={sending} onclick={() => onretry(at)}><span class="ui-label">{strings.composer.outboxRetry}</span></button>
      {/if}
      {#if onremove}
        <button type="button" class="ghost icon remove" data-testid="composer-queued-remove"
          title={strings.composer.removeQueued} aria-label={strings.composer.removeQueued}
          disabled={at < outgoing || !!entry.request?.start} onclick={() => onremove(at)}><X size={12} /></button>
      {/if}
    </div>
  {/each}
  {#if sendNow}
    <button type="button" class="ghost send-now" data-testid="composer-send-now"
      title={sendNow === 'steer' ? strings.composer.sendNowHint : strings.composer.retryQueuedHint}
      onclick={onsendnow}><span class="ui-label">{strings.composer.sendNow}</span></button>
  {/if}
</div>

<style>
  /* Quiet chips inside the box, over its field: each held prompt cut to one
     line, its state a muted clock before it, edit on its text and remove at
     its end; Send now closes the row. They wrap rather than scroll sideways. */
  .queued {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    max-height: 30vh;
    overflow-y: auto;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    height: 28px;
    padding: 0 2px 0 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-hover);
    font-size: var(--text-sm);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }

  .state.error { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; color: var(--color-danger); }

  .text {
    display: block;
    flex: 0 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
    color: var(--color-foreground);
    font-weight: 400;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text:hover:not(:disabled) { background: none; text-decoration: underline; text-decoration-color: var(--color-subtle); }
  /* Still waiting to go while the box holds other text: the chip stays legible. */
  .text:disabled { opacity: 1; }

  .extra { display: inline-flex; align-items: center; gap: 3px; flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .chip :global(.info-tip) { flex: none; margin: 0; }
  .remove { flex: none; width: 22px; height: 22px; border-radius: var(--radius-full); }
  .chip .ghost.small { flex: none; height: 22px; font-size: var(--text-xs); }

  .send-now { height: 28px; padding: 0 8px; border-radius: var(--radius-full); font-size: var(--text-sm); font-weight: 550; }
  @media (max-width: 720px) {
    /* A phone gives the prompt up to two lines rather than cutting it on the first. */
    .chip { height: auto; min-height: 36px; padding-block: 2px; border-radius: var(--radius-lg); }
    .text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; height: auto; padding-block: 4px; line-height: 1.3; white-space: normal; overflow-wrap: anywhere; }
    .remove { width: 32px; height: 32px; }
    .send-now { height: 36px; }
  }
  /* A 360 px phone keeps the chip for the prompt: the outbox's word goes, the "i" still says why. */
  @media (max-width: 400px) { .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
</style>
