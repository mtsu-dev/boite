<script lang="ts">
  import { Clock, Paperclip, Pencil, SendHorizontal, Trash2 } from '@lucide/svelte';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The prompts waiting behind the running turn, one row each just above the
   * composer card: a clock and "Then:", its text on one line cut at a word,
   * then its actions as icons, in reach of a tap on a phone: Send now (on the
   * last row, it sends them all), Edit, which takes it back into the box, and
   * Delete. One written while the machine was away says so in place of
   * "Then:", or says why the core refused it, with Send again.
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
  /** Why the first waits: the clock's tooltip, or the "i" of answers already given. */
  let why = $derived(outbox && starts ? fill(strings.composer.outboxStarts, { machine }) : outbox ? strings.composer.outboxKept : paused ? strings.composer.queuedPaused : strings.composer.queued);
  let sendHint = $derived(sendNow === 'steer' ? strings.composer.sendNowHint : strings.composer.retryQueuedHint);

  /** The words that fit the line show whole; when more wait below it, the line's end fades to say so. */
  function cutAtWord(node: HTMLElement): () => void {
    const measure = () => { node.classList.toggle('cut', node.scrollHeight > node.clientHeight + 1); };
    measure();
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    sized?.observe(node);
    return () => sized?.disconnect();
  }
</script>

<div class="queued" data-testid="composer-queued">
  {#each queued as entry, at (entry)}
    {@const failed = entry.request?.failed}
    {@const start = !!entry.request?.start}
    <div class="line" class:failed={failed !== undefined} data-testid="composer-queued-item">
      {#if failed !== undefined}
        <span class="state error" data-testid="composer-outbox-failed" title={fill(strings.composer.outboxFailed, { reason: failed })}>{fill(strings.composer.outboxFailed, { reason: failed })}</span>
      {:else if entry.request}
        <span class="state" data-testid="composer-outbox-pending" title={at === 0 ? why : undefined}><Clock size={14} /><span class="word">{at < outgoing ? strings.composer.outboxSending
          : connected ? strings.composer.outboxNext : fill(strings.composer.outboxWaiting, { machine })}</span></span>
      {:else}
        <!-- The clock, then "Then:": what goes next, read as the row's title. -->
        <span class="state" title={at === 0 ? why : undefined}><Clock size={14} /><span class="then">{strings.composer.queuedThen}</span></span>
      {/if}
      <!-- The user's own words, cut at a word on one line; a title names the whole. -->
      <span class="queued-title" title={entry.text || undefined} {@attach cutAtWord}>{entry.text || strings.composer.attachAlt}</span>
      {#if entry.attachments.length}<span class="extra"><Paperclip size={12} />{entry.attachments.length}</span>{/if}
      {#if entry.previewReferences?.length}<span class="extra">@{entry.previewReferences.length}</span>{/if}
      <span class="tools">
        {#if failed !== undefined && onretry}
          <button type="button" class="ghost small retry" data-testid="composer-outbox-retry" disabled={sending} onclick={() => onretry(at)}><span class="ui-label">{strings.composer.outboxRetry}</span></button>
        {/if}
        {#if sendNow && at === queued.length - 1}
          <button type="button" class="ghost icon tool" data-testid="composer-send-now" title={sendHint} aria-label={strings.composer.sendNow} onclick={onsendnow}><SendHorizontal size={15} /></button>
        {/if}
        <!-- Answers already given have no actions: they are not the user's to edit; the "i" says why they wait. -->
        {#if onremove}
          <button type="button" class="ghost icon tool" data-testid="composer-queued-edit" title={strings.composer.editQueued} aria-label={strings.composer.queuedEdit}
            disabled={disabled || start} onclick={() => onrestore(at)}><Pencil size={15} /></button>
          <button type="button" class="ghost icon tool remove" data-testid="composer-queued-remove" title={strings.composer.removeQueued} aria-label={strings.composer.queuedRemove}
            disabled={at < outgoing || start} onclick={() => onremove(at)}><Trash2 size={15} /></button>
        {:else if at === 0}<InfoTip text={why} topic={strings.composer.queuedLabel} testid="composer-queued-why" />{/if}
      </span>
    </div>
  {/each}
</div>

<style>
  /* One row per held prompt, a quiet tile on the composer's own surface, the
     newest last, right above the box it will be sent from. More than a few
     scroll, so the conversation keeps its share. */
  .queued {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    max-height: 30vh;
    overflow-y: auto;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-height: 36px;
    min-width: 0;
    padding: 0 4px 0 12px;
    border: 1px solid var(--color-composer-edge);
    border-radius: var(--radius-lg);
    background: var(--color-composer-surface);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    animation: rise var(--motion-duration) var(--motion-curve);
  }

  .state { display: inline-flex; align-items: center; gap: 6px; flex: none; white-space: nowrap; }
  .state > :global(svg) { flex: none; }
  .then { color: var(--color-muted-foreground); font-weight: 550; }
  .state.error { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; color: var(--color-danger); }

  /* One line, cut after the last whole word that fits: the next lines wrap
     out of the box, and its end fades once some are hidden. */
  .queued-title {
    flex: 1 1 auto;
    min-width: 0;
    height: 1.4em;
    overflow: hidden;
    overflow-wrap: anywhere;
    line-height: 1.4;
    color: var(--color-foreground);
  }
  .queued-title:global(.cut) { mask-image: linear-gradient(to right, black calc(100% - 28px), transparent); }

  .extra { display: inline-flex; align-items: center; gap: 3px; flex: none; font-size: var(--text-xs); }
  .tools { display: flex; align-items: center; gap: 2px; flex: none; margin-left: auto; }
  .tools :global(.info-tip) { flex: none; }
  .tool { position: relative; flex: none; width: 28px; height: 28px; padding: 0; justify-content: center; border-radius: var(--radius-full); color: var(--color-muted-foreground); }
  .tool:hover:not(:disabled) { color: var(--color-foreground); }
  .tool.remove:hover:not(:disabled) { color: var(--color-danger); }
  .retry { flex: none; height: 28px; padding: 0 8px; font-size: var(--text-xs); }

  /* A phone: every action a finger's 44 px target, always shown, never on hover. */
  @media (max-width: 720px) {
    .queued { max-height: calc(3 * 44px + 8px); }
    .line { min-height: 44px; padding-right: 0; }
    .tools { gap: 0; }
    .tool { width: var(--touch-target); height: var(--touch-target); }
    .retry { height: var(--touch-target); }
  }
  /* A 360 px phone keeps the row for the prompt: the outbox's word goes, the clock's tooltip still says why. */
  @media (max-width: 400px) { .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
</style>
