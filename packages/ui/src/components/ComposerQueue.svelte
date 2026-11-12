<script lang="ts">
  import { Clock, Paperclip, Pencil, SendHorizontal, Trash2 } from '@lucide/svelte';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';
  import { wordFit } from '../lib/word-fit';

  /**
   * The prompts waiting behind the running turn, one row each in the foot
   * above the composer card (`ComposerFoot`): "Queued", its text cut at a
   * word (one line, two on a phone), then its actions as icons: Send now (on
   * the last row, it sends them all), Edit, which takes it back into the box,
   * and Delete. The text itself is Edit too, a phone's 40 px targets. One written
   * while the machine was away says so in place of "Queued", or says why the
   * core refused it, with Send again.
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
</script>

<div class="queued" data-testid="composer-queued">
  {#each queued as entry, at (entry)}
    {@const failed = entry.request?.failed}
    {@const start = !!entry.request?.start}
    <div class="foot-row line" class:failed={failed !== undefined} data-testid="composer-queued-item">
      {#if failed !== undefined}
        <span class="state error" data-testid="composer-outbox-failed" title={fill(strings.composer.outboxFailed, { reason: failed })}>{fill(strings.composer.outboxFailed, { reason: failed })}</span>
      {:else if entry.request}
        <span class="state" data-testid="composer-outbox-pending" title={at === 0 ? why : undefined}><Clock size={14} /><span class="word">{at < outgoing ? strings.composer.outboxSending
          : connected ? strings.composer.outboxNext : fill(strings.composer.outboxWaiting, { machine })}</span></span>
      {:else}
        <span class="state" title={at === 0 ? why : undefined}><Clock size={14} /><span data-testid="composer-queued-state">{strings.composer.queuedLabel}</span></span>
      {/if}
      <!-- The user's own words, cut at a word (`wordFit`); a title names the whole. Their own rows take them back into the box on a press. -->
      {#if onremove}
        <button type="button" class="queued-title edit-text" data-testid="composer-queued-text" title={entry.text || undefined} aria-label={`${strings.composer.queuedEdit}: ${entry.text || strings.composer.attachAlt}`}
          disabled={disabled || start} onclick={() => onrestore(at)}><span class="words" use:wordFit={entry.text || strings.composer.attachAlt}></span></button>
      {:else}
        <span class="queued-title" title={entry.text || undefined}><span class="words" use:wordFit={entry.text || strings.composer.attachAlt}></span></span>
      {/if}
      {#if entry.attachments.length}<span class="extra"><Paperclip size={12} />{entry.attachments.length}</span>{/if}
      {#if entry.previewReferences?.length}<span class="extra">@{entry.previewReferences.length}</span>{/if}
      <span class="tools">
        {#if failed !== undefined && onretry}
          <button type="button" class="ghost small retry" data-testid="composer-outbox-retry" disabled={sending} onclick={() => onretry(at)}><span class="ui-label">{strings.composer.outboxRetry}</span></button>
        {/if}
        {#if sendNow && at === queued.length - 1}
          <button type="button" class="icon-button tool" data-testid="composer-send-now" title={sendHint} aria-label={strings.composer.sendNow} onclick={onsendnow}><SendHorizontal size={15} /></button>
        {/if}
        <!-- Answers already given have no actions: they are not the user's to edit; the "i" says why they wait. -->
        {#if onremove}
          <button type="button" class="icon-button tool" data-testid="composer-queued-edit" title={strings.composer.editQueued} aria-label={strings.composer.queuedEdit}
            disabled={disabled || start} onclick={() => onrestore(at)}><Pencil size={15} /></button>
          <button type="button" class="icon-button tool remove" data-testid="composer-queued-remove" title={strings.composer.removeQueued} aria-label={strings.composer.queuedRemove}
            disabled={at < outgoing || start} onclick={() => onremove(at)}><Trash2 size={15} /></button>
        {:else if at === 0}<InfoTip text={why} topic={strings.composer.queuedLabel} testid="composer-queued-why" />{/if}
      </span>
    </div>
  {/each}
</div>

<style>
  /* One foot row per held prompt (`ComposerFoot` draws the row and the
     hairlines), the newest last, right above the box it will be sent from.
     More than a few scroll, so the conversation keeps its share. */
  .queued { display: flex; flex-direction: column; min-width: 0; max-height: calc(3 * var(--foot-row) + 2px); overflow-y: auto; }

  .line { color: var(--color-muted-foreground); }

  .state { display: inline-flex; align-items: center; gap: 6px; flex: none; white-space: nowrap; }
  /* The mark sits in the 16 px box every foot row gives its icon, so the words line up from row to row. */
  .state > :global(svg) { flex: none; width: 16px; }
  .state.error { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; color: var(--color-danger); }

  /* Its lines (one, two on a phone) end on the last whole word that fits (`wordFit` reads the clamp). */
  .queued-title { display: flex; flex: 1 1 auto; min-width: 0; color: var(--color-foreground); }
  .words { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; flex: 1 1 auto; min-width: 0; overflow: hidden; overflow-wrap: break-word; white-space: normal; line-height: 1.4; text-align: left; }
  /* The text as Edit: the row's own words, no frame, the pointer's lift. */
  .edit-text { justify-content: flex-start; height: calc(var(--foot-row) - 6px); margin: 0 0 0 -6px; padding: 0 6px; border: none; border-radius: var(--radius-sm); font: inherit; }
  .edit-text:disabled { opacity: 1; }

  .extra { display: inline-flex; align-items: center; gap: 3px; flex: none; font-size: var(--text-xs); }
  .tools { display: flex; align-items: center; gap: 0; flex: none; margin-left: auto; }
  .tools :global(.info-tip) { flex: none; }
  /* The row is the button's target: one drawn past it (app.css's 32 px) overflows the list into a scrollbar. */
  .tool { --icon-button: 28px; --icon-button-target: 28px; }
  @media (hover: hover) { .tool.remove:hover:not(:disabled) { color: var(--color-danger); } }
  .retry { flex: none; height: 26px; padding: 0 8px; font-size: var(--text-xs); }

  /* A phone: two lines of the prompt, the row as tall as they need, Edit and Delete at the end on 40 px targets. */
  @media (max-width: 720px) {
    .queued { max-height: calc(3 * (var(--foot-row) + 12px)); }
    /* Scoped under the list, so it outweighs ComposerFoot's fixed row height whatever order the styles load in. */
    .queued :global(.foot-row).line { height: auto; min-height: var(--foot-row); padding-block: 2px; }
    .words { -webkit-line-clamp: 2; line-clamp: 2; }
    .edit-text { height: auto; min-height: calc(var(--foot-row) - 6px); padding-block: 3px; }
    .tool { --icon-button: 40px; --icon-button-target: var(--touch-target); }
  }
  /* A 360 px phone keeps the row for the prompt: the outbox's word goes, the clock's tooltip still says why. */
  @media (max-width: 400px) { .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
</style>
