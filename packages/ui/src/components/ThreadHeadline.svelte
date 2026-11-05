<script lang="ts">
  import type { Snippet } from 'svelte';
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
  import { rowSubagents } from '../lib/delegated-work';
  import { threadLiveKind, waitingSince } from '../lib/inbox';
  import { lastLine } from '../lib/last-line';

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
    ring = false,
    pin = true,
    facts
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
    /** Off under Recent's band labels, the Pinned one already saying it. */
    pin?: boolean;
    /**
     * A two-line sidebar row: the title line keeps the ring and the title alone, and
     * a second line under it draws these facts (the project, the machine), then the
     * sub-agents chip and the time at its right end.
     */
    facts?: Snippet;
  } = $props();
  let stacked = $derived(facts !== undefined);
  let draft = $derived(!open && hasUnsentDraft(owner.composerStates[thread.id]));
  /** The open thread's row counts what its strip and panel tab count (`rowSubagents`). */
  let subagents = $derived(rowSubagents(owner, thread.id));
  let away = $derived(owner.connection !== 'ready');
  let kind = $derived(threadState(thread, subagents));
  /**
   * Nothing live on it and not pinned, Recent's Earlier band: the provider's mark
   * takes the muted tier, so the brand's hues stay on the rows that need a look.
   */
  let quiet = $derived(!thread.pinned && threadLiveKind(thread, kind) === null);
  /**
   * A row that needs the user, wherever it is listed (Recent's band, its Needs you
   * filter, a project's rows), pinned or not: the rows to read before opening one,
   * so a long title takes a second line before its ellipsis. Every other row keeps one line.
   */
  let clamp = $derived(!wrap && threadLiveKind(thread, kind) === 'needs');
  /**
   * Such a title with no second line under it: the right cluster (draft, pin, subagents,
   * time) ends the title's last line, as a two-line row's ends its subline (`lastLine`), so
   * a wrapped title has its first line to itself and the ages of a group share one line.
   */
  let low = $derived(clamp && !stacked);
  /** A two-line row's pin sits on the second line, before the time, so it never takes the title's room. */
  let pinned = $derived(thread.pinned && pin);
  /** A failure says so in words on the second line, so the red mark is not the only cue beside a row that asks. */
  let failed = $derived(away ? null : kind === 'error' ? strings.sidebar.state.error : kind === 'interrupted' ? strings.sidebar.state.interrupted : null);
  /** The sidebar's row: its delegated agents as a glyph and a number before the time, so the row keeps one line. */
  let agents = $derived(ring ? delegatedChip(subagents) : null);
  /** A row that needs the user counts from the home card's `since`, so both read one age. */
  let waited = $derived(now === undefined ? null : waitingSince(owner, thread));
</script>

{#snippet pinMark()}<span class="pin" data-testid="thread-pinned"><Pin size={12} /></span>{/snippet}
{#snippet trail()}
  {#if agents}<span class="agents" class:asking={agents.asking} data-testid="thread-subagents" data-count={agents.shown} role="img" title={agents.label} aria-label={agents.label}><Network size={11} aria-hidden="true" /><span class="ui-label">{agents.shown}</span></span>{/if}
  {#if now !== undefined}<ThreadState {thread} {now} {subagents} {away} {waited} compact={ring} />{/if}
{/snippet}

<span class="headline" class:wrap class:ring class:stacked class:quiet class:clamp class:low class:unread={thread.unread && !wrap} data-lines={clamp ? 2 : undefined}>
  {#if machine}
    <span class="machine" class:offline={owner.connection !== 'ready'}
      title={`${machine.label} · ${strings.connection[owner.connection]}`} aria-label={machine.label}>
      <MachineIcon icon={machine.icon} os={owner.core?.os} />
    </span>
  {/if}
  {#if picture && ring}
    <StateRing {kind} asking={asksMidTurn(thread, subagents)} stale={away} ground="var(--ring-ground, var(--color-frame))"><ThreadPicture {owner} {thread} size={16} logo={13} mono={quiet} /></StateRing>
  {:else if picture}<ThreadPicture {owner} {thread} size={wrap ? 13 : 12} mono={quiet} />{/if}
  <span class="line" use:lastLine={low ? thread.title : null}>
    <span class="title" class:ui-label={!wrap && !clamp} data-last-line="title">{thread.title}{#if low}<span class="room" data-last-line="room" aria-hidden="true"></span>{/if}</span>
    <span class="cluster" data-last-line="cluster">
      {#if draft}<span class="draft" data-testid="thread-draft" title={strings.sidebar.unsentDraft} aria-label={strings.sidebar.unsentDraft}><PencilLine size={12} /></span>{/if}
      {#if pinned && !stacked}{@render pinMark()}{/if}
      {#if !stacked}{@render trail()}{/if}
    </span>
  </span>
</span>
{#if stacked}<span class="facts" class:ring><span class="known">{@render facts?.()}{#if failed}<span class="failed" data-testid="thread-failed"><span aria-hidden="true">·</span><span class="ui-label">{failed}</span></span>{/if}</span><span class="trail" data-testid="thread-trail">{#if pinned}{@render pinMark()}{/if}{@render trail()}</span></span>{/if}

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
  /* A row's title and its right cluster are the headline's own items: the boxes holding them
     take no layout of their own until the title may wrap (`.low`). */
  .line, .cluster { display: contents; }
  /* Needs you: up to two 18 px lines, then the ellipsis. The ring and the machine stay on the
     first line's centre, 11 px down the 22 px slot; the line box replaces the trimmed label,
     whose ink padding would show the top of a third line under the clamp. */
  .clamp { align-items: flex-start; }
  .clamp .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
    /* The second line never ends on one word: "Retry failed syncs when the / network drops". */
    text-wrap: pretty;
    line-height: 18px;
    margin-top: 2px;
  }
  .clamp > :global(:not(.line, .title, [data-testid='state-ring'])) { display: inline-flex; align-items: center; min-height: 22px; }
  /* With no subline the cluster ends the title's last line, 18 px tall on its centre: the title
     runs the line's whole width and its last word carries an empty room the cluster's width
     plus the row's gap (`lastLine`), or, past its two lines, every line keeps that room. */
  .low { --room-gap: 8px; }
  .low.ring { --room-gap: 5px; }
  .low .line { display: block; position: relative; flex: 1; min-width: 0; padding-top: 2px; }
  /* Balanced: with the whole first line free, `pretty` let "drops" end the title alone. */
  .low .title { margin-top: 0; text-wrap: balance; }
  .low .room { padding-left: calc(var(--room, 0px) + var(--room-gap)); }
  .low .cluster { position: absolute; right: 0; bottom: 0; display: flex; align-items: center; gap: var(--room-gap); height: 18px; }
  .low .cluster > :global(*) { display: inline-flex; align-items: center; flex: none; }
  .low .line:global([data-fit='narrow']) .title { padding-right: calc(var(--room, 0px) + var(--room-gap)); }
  .low .line:global([data-fit='narrow']) .room { display: none; }
  /* The ringed row: every row's mark sits in one 22 px slot (1.5 px of air inside the ring),
     ring drawn or not, the 13 px mark centred in it; a 5 px gap and 13 px give the title
     about 235 px at the 304 px default width; unread reads at 500. */
  .ring { gap: 5px; }
  .ring > :global([data-testid='state-ring']) { --ring-air: 1.5px; }
  .ring .pin, .facts .pin { color: var(--color-muted-foreground); }
  /* A quiet row's mark is the muted tier at full strength: the ring's resting dim would take it under 4.5:1. */
  .quiet > :global([data-testid='state-ring'].ring .picture) { opacity: 1; }
  .quiet :global([data-testid='thread-provider']) { color: var(--color-muted-foreground); }
  .agents { display: inline-flex; align-items: center; gap: 2px; flex: none; font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--color-accent); }
  .agents.asking { color: var(--color-live); }
  /* The time sits in a narrow column of its own: tabular, right-aligned, so the titles end on one edge. */
  .ring :global(.when) { min-width: 3.2ch; text-align: right; justify-content: flex-end; }
  .ring .title { font-size: var(--text-sm); }
  .ring.unread .title { font-weight: 500; }
  /* Two lines: the 22 px slot and the title at 14 px own the first line,
     about 259 px of title at the 304 px default width. */
  .ring.stacked .title { font-size: var(--text-base); }
  /* The second line starts under the title, past the 22 px slot and its 5 px gap; the time ends on the title's right edge. */
  .facts {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 16px;
    padding-left: 27px;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    /* The time beside the project: subtle would fall under 4.5:1 once the row is selected or a menu's shadow falls on it. */
    --when-color: var(--color-meta);
  }
  .known { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  /* After the project, in the line's muted tier; it never yields its room to the project's name. */
  .failed { display: inline-flex; align-items: center; gap: 8px; flex: none; }
  /* Under a project's header the line has no project before it: the word leads, with no dot. */
  .known > .failed:first-child > [aria-hidden='true'] { display: none; }
  .trail { display: flex; align-items: center; gap: 6px; flex: none; }
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
