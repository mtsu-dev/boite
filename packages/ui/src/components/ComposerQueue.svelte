<script lang="ts">
  import { Clock, Ellipsis, Paperclip } from '@lucide/svelte';
  import type { Attachment, PreviewReference } from '@boite/contracts';
  import type { OutboxRequest } from '../lib/store/composer.svelte';
  import type { MenuItem } from '../lib/menu';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';
  import Menu from './Menu.svelte';

  /**
   * The prompts waiting behind the running turn, one dimmed line each inside
   * the composer card, over its field: a clock, then its text cut to one line
   * on every width (an ellipsis, never half a word), then one menu that says
   * why it waits and holds edit and remove. A click on the text also takes it
   * back into the box; Send now, at the end of the last line, sends them all.
   * One written while the machine was away says so in place of "Queued", or
   * says why the core refused it, with Send again.
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
  /** The line's one menu: why the first waits, then edit and remove, each keeping the test id of the button it replaced. */
  function actions(at: number, start: boolean): MenuItem[] {
    return [
      ...at === 0 ? [{ id: 'why', label: why, separator: true }] : [],
      { id: 'edit', label: strings.composer.queuedEdit, title: strings.composer.editQueued, testid: 'composer-queued-edit', disabled: disabled || start },
      { id: 'remove', label: strings.composer.queuedRemove, title: strings.composer.removeQueued, testid: 'composer-queued-remove', danger: true, disabled: at < outgoing || start }
    ];
  }
  let why = $derived(outbox && starts ? fill(strings.composer.outboxStarts, { machine }) : outbox ? strings.composer.outboxKept : paused ? strings.composer.queuedPaused : strings.composer.queued);
</script>

<div class="queued" data-testid="composer-queued">
  {#each queued as entry, at (entry)}
    {@const failed = entry.request?.failed}
    <div class="line" class:failed={failed !== undefined} data-testid="composer-queued-item">
      <!-- One line per held prompt: its state, its text (a tap brings it back) and its menu. -->
      <span class="pill">
      {#if failed !== undefined}
        <span class="state error" data-testid="composer-outbox-failed" title={fill(strings.composer.outboxFailed, { reason: failed })}>{fill(strings.composer.outboxFailed, { reason: failed })}</span>
      {:else if entry.request}
        <span class="state" data-testid="composer-outbox-pending"><Clock size={12} /><span class="word">{at < outgoing ? strings.composer.outboxSending
          : connected ? strings.composer.outboxNext : fill(strings.composer.outboxWaiting, { machine })}</span></span>
      {:else}
        <!-- The clock in the dock's icon box, then "Then:": what goes next, read as the line's title. -->
        <span class="state icon"><Clock size={12} /></span><span class="then">{strings.composer.queuedThen}</span>
      {/if}
      <button type="button" class="text"
        title={strings.composer.editQueued}
        disabled={disabled || !!entry.request?.start}
        onclick={() => onrestore(at)}>{entry.text || strings.composer.attachAlt}</button>
      {#if entry.attachments.length}<span class="extra"><Paperclip size={12} />{entry.attachments.length}</span>{/if}
      {#if entry.previewReferences?.length}<span class="extra">@{entry.previewReferences.length}</span>{/if}
      <!-- Answers already given come with no menu: they are not the user's to edit either, only the "i" says why they wait. -->
      {#if onremove}
        <span class="tool"><Menu items={actions(at, !!entry.request?.start)} variant="ghost" align="end" label={strings.composer.queuedActions} heading={entry.text || strings.composer.attachAlt} testid="composer-queued-menu"
          onpick={(id) => { if (id === 'edit') onrestore(at); else if (id === 'remove') onremove(at); }}><Ellipsis size={14} /></Menu></span>
      {:else if at === 0}<InfoTip text={why} topic={strings.composer.queuedLabel} testid="composer-queued-why" />{/if}
      </span>
      {#if sendNow && at === queued.length - 1}
        <button type="button" class="ghost small send-now" data-testid="composer-send-now"
          title={sendNow === 'steer' ? strings.composer.sendNowHint : strings.composer.retryQueuedHint}
          onclick={onsendnow}><span class="ui-label">{strings.composer.sendNow}</span></button>
      {/if}
      {#if failed !== undefined && onretry}
        <button type="button" class="ghost small" data-testid="composer-outbox-retry" disabled={sending} onclick={() => onretry(at)}><span class="ui-label">{strings.composer.outboxRetry}</span></button>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* One dimmed line per held prompt over the field, no fill and no edge: the
     decision stays the card's one head. Each line is cut to one line, its
     clock before the text, its menu at its end. */
  .queued {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    max-height: 30vh;
    overflow-y: auto;
  }

  /* The dock's row form (AgentDock): the icon box, the title cut first, the menu at the row's end. */
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--dock-row, var(--control-sm));
    min-width: 0;
    max-width: 100%;
    /* One step under the decision, like the subagents' entries: the tertiary ink. */
    color: var(--color-subtle);
    font-size: var(--text-meta);
    animation: rise var(--motion-duration) var(--motion-curve);
  }

  /* No chip: the clock, the text and its menu on the card's surface. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
    height: var(--dock-row, var(--control-sm));
  }
  .icon { justify-content: center; width: var(--dock-icon, 12px); }
  .then { flex: none; color: var(--color-muted-foreground); font-weight: 550; }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    white-space: nowrap;
  }

  .state.error { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; color: var(--color-danger); }

  /* The text takes the line's width, then ends in an ellipsis. */
  .text {
    display: block;
    flex: 0 1 auto;
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
  /* Its menu or its "i", round controls closing the line. */
  .pill :global(.info-tip) { flex: none; }
  .tool { display: flex; flex: none; margin-left: auto; }
  /* A row-high target around a small glyph, the ink quiet. */
  .tool :global(.trigger) { position: relative; width: var(--dock-row, 28px); height: var(--dock-row, 28px); padding: 0; justify-content: center; border-radius: var(--radius-full); color: inherit; }
  .tool :global(.trigger:hover), .tool :global(.trigger[aria-expanded='true']) { color: var(--color-foreground); }
  .line .ghost.small { flex: none; height: 22px; padding: 0 6px; font-size: var(--text-xs); }
  /* Send now is the line's one word in ink: it acts on the whole queue. */
  .line .send-now { color: var(--color-foreground); font-weight: 550; }

  /* A phone keeps the same single quiet line: its text and its menu each a
     finger's target through a hit area wider than their ink. Two lines
     show, more scroll, so the card stays under its share of the screen. */
  @media (max-width: 720px) {
    /* The scroller reaches 6 px past the lines, so the menu's hit area is not clipped at its edge. */
    .queued { gap: 0; max-height: calc(2 * var(--dock-row, 30px) + 12px); margin: -6px; padding: 6px; }
    .text { height: var(--dock-row, 30px); }
    .tool :global(.trigger::after) { content: ''; position: absolute; inset: -7px; }
    .line .ghost.small { height: var(--dock-row, 30px); }
  }
  /* A 360 px phone keeps the line for the prompt: the outbox's word goes, the "i" still says why. */
  @media (max-width: 400px) { .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
</style>
