<script lang="ts">
  import { Network, PencilLine, Pin } from '@lucide/svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { strings } from '../lib/strings';
  import MachineIcon from './MachineIcon.svelte';
  import ThreadPicture from './ThreadPicture.svelte';
  import ThreadState from './ThreadState.svelte';
  import StateRing from './StateRing.svelte';
  import { asksMidTurn, delegatedChip, threadState } from '../lib/thread-state';

  /**
   * A thread row's first line, in the sidebar and in a phone's list: who runs
   * it (the agent it belongs or was entrusted to, else the
   * provider's logo, whose tooltip names the provider and the model), the
   * title, an unsent draft, the pin, then the state or the time.
   */
  let {
    owner,
    thread,
    now,
    machine,
    open = false,
    wrap = false,
    picture = true,
    ring = false
  }: {
    owner: Store;
    thread: ThreadSummary;
    /** Without it the row draws the state itself, elsewhere. */
    now?: number;
    /** The machine's icon before the picture, once there are two machines. */
    machine?: Machine;
    /** The open thread shows its box: its row marks no draft. */
    open?: boolean;
    /** A phone's list: the title wraps over several lines instead of ending in an ellipsis. */
    wrap?: boolean;
    /** A phone's row draws the picture itself, in a tile beside the lines. */
    picture?: boolean;
    /** The sidebar's row: the state rings the picture, and the right end keeps only the time. */
    ring?: boolean;
  } = $props();
  let draft = $derived(!open && hasUnsentDraft(owner.composerStates[thread.id]));
  let subagents = $derived(owner.subagents(thread.id));
  let away = $derived(owner.connection !== 'ready');
  /** The sidebar's row: its delegated agents as a glyph and a number before the time, so the row keeps one line. */
  let agents = $derived(ring ? delegatedChip(subagents) : null);
</script>

<span class="headline" class:wrap class:ring class:unread={thread.unread && !wrap}>
  {#if machine}
    <span class="machine" class:offline={owner.connection !== 'ready'}
      title={`${machine.label} · ${strings.connection[owner.connection]}`} aria-label={machine.label}>
      <MachineIcon icon={machine.icon} os={owner.core?.os} />
    </span>
  {/if}
  {#if picture && ring}
    <StateRing kind={threadState(thread, subagents)} asking={asksMidTurn(thread, subagents)} stale={away} ground="var(--ring-ground, var(--color-frame))"><ThreadPicture {owner} {thread} size={16} logo={13} /></StateRing>
  {:else if picture}<ThreadPicture {owner} {thread} size={wrap ? 13 : 12} />{/if}
  <span class="title" class:ui-label={!wrap}>{thread.title}</span>
  {#if draft}<span class="draft" data-testid="thread-draft" title={strings.sidebar.unsentDraft} aria-label={strings.sidebar.unsentDraft}><PencilLine size={12} /></span>{/if}
  {#if thread.pinned}<span class="pin" data-testid="thread-pinned"><Pin size={12} /></span>{/if}
  {#if agents}<span class="agents" class:asking={agents.asking} data-testid="thread-subagents" data-count={agents.shown} role="img" title={agents.label} aria-label={agents.label}><Network size={11} aria-hidden="true" /><span class="ui-label">{agents.shown}</span></span>{/if}
  {#if now !== undefined}<ThreadState {thread} {now} {subagents} {away} compact={ring} />{/if}
</span>

<style>
  .headline {
    display: flex;
    align-items: center;
    min-height: 1lh; /* Keep the row stable when machine glyphs appear. */
    gap: 8px;
    min-width: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-foreground);
    font-weight: 400;
  }
  .unread .title {
    font-weight: 600;
  }
  /* The ringed row: a tighter gap and 13 px give the title its 30 characters at 288 px, and unread reads at 500. */
  .ring { gap: 6px; }
  .ring .pin { color: var(--color-muted-foreground); }
  .agents { display: inline-flex; align-items: center; gap: 2px; flex: none; font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--color-accent); }
  .agents.asking { color: var(--color-live); }
  /* The time sits in a narrow column of its own: tabular, right-aligned, so the titles end on one edge. */
  .ring :global(.when) { min-width: 3.2ch; text-align: right; justify-content: flex-end; }
  .ring .title { font-size: var(--text-sm); }
  .ring.unread .title { font-weight: 500; }
  .machine,
  .draft,
  .pin {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .machine {
    color: var(--color-muted-foreground);
  }
  .machine.offline {
    color: var(--color-danger);
  }
  /* A draft left in the box: the accent, so it reads as the user's own work waiting. */
  .draft {
    color: var(--color-accent);
  }
  /* On a phone the line is text: the marks flow with the title and it wraps. */
  .wrap {
    display: block;
    font-size: var(--text-base);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .wrap .title {
    display: inline;
    overflow: visible;
    white-space: normal;
    font-weight: inherit;
  }
  .wrap :global(.picture) {
    margin-right: 6px;
    vertical-align: -2px;
  }
  .wrap .draft {
    margin-left: 6px;
    vertical-align: -1px;
  }
  .wrap .pin {
    margin-left: 4px;
    vertical-align: -1px;
    color: var(--color-muted-foreground);
  }
</style>
