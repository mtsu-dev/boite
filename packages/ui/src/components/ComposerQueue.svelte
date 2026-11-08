<script lang="ts">
  import { Clock, Paperclip, X } from '@lucide/svelte';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The prompts waiting behind the running turn, one line each in the strip
   * above the composer: what it waits for, then its text cut to the line. A
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
    <div class="line" class:failed={failed !== undefined} data-testid="composer-queued-item">
      {#if failed !== undefined}
        <span class="state error" data-testid="composer-outbox-failed" title={fill(strings.composer.outboxFailed, { reason: failed })}>{fill(strings.composer.outboxFailed, { reason: failed })}</span>
      {:else if entry.request}
        <span class="state" data-testid="composer-outbox-pending"><Clock size={13} /><span class="word">{at < outgoing ? strings.composer.outboxSending
          : connected ? strings.composer.outboxNext : fill(strings.composer.outboxWaiting, { machine })}</span></span>
      {:else}
        <span class="state"><Clock size={13} /><span class="word">{strings.composer.queuedLabel}</span></span>
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
          disabled={at < outgoing || !!entry.request?.start} onclick={() => onremove(at)}><X size={13} /></button>
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
  /* Quiet lines at the head of the box: each held prompt on its own line, its
     state muted before it, edit and remove at its end; Send now closes the run. */
  .queued {
    display: flex;
    flex-direction: column;
    gap: 0;
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
    max-width: 100%;
    height: 28px;
    padding: 0 2px 0 0;
    font-size: var(--text-sm);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    color: var(--color-muted-foreground);
    font-weight: 500;
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
    color: var(--color-muted-foreground);
    font-weight: 400;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text:hover:not(:disabled) { background: none; color: var(--color-foreground); text-decoration: underline; text-decoration-color: var(--color-subtle); }
  /* Still waiting to go while the box holds other text: the line stays legible. */
  .text:disabled { opacity: 1; }

  .extra { display: inline-flex; align-items: center; gap: 3px; flex: none; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .line :global(.info-tip) { flex: none; margin: 0; }
  .remove { flex: none; width: 22px; height: 22px; margin-left: auto; }
  .line .ghost.small { flex: none; height: 22px; font-size: var(--text-xs); }

  .send-now { align-self: flex-start; height: 26px; padding: 0 8px; margin-left: -8px; border-radius: var(--radius-md); font-size: var(--text-sm); font-weight: 550; }
  @media (max-width: 720px) { .line { height: 36px; } .remove { width: 36px; height: 36px; } }
  /* A 360 px phone keeps the line for the prompt: the clock says it waits, the
     word stays for screen readers, the "i" says why. */
  @media (max-width: 400px) { .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
</style>
