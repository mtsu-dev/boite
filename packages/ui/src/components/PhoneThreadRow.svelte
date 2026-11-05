<script lang="ts">
  import { Archive, Check, CircleAlert, CirclePause, Ellipsis, FolderInput, KeyRound, LogIn, MessageCircleQuestion, Network, PencilLine, Pin, ShieldQuestion } from '@lucide/svelte';
  import { threadLiveKind, waitedFor, waitingSince, type InboxReason } from '../lib/inbox';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import { namesMachine } from '../lib/row-machine';
  import type { MenuItem } from '../lib/menu';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { asksMidTurn, delegatedChip, threadState } from '../lib/thread-state';
  import { rowSubagents } from '../lib/delegated-work';
  import { pendingLine } from '../lib/thread-move.svelte';
  import { longPress } from '../lib/long-press';
  import { swipeActions, type SwipeSide } from '../lib/swipe-actions';
  import { projectName } from '../lib/format';
  import { lastLine } from '../lib/last-line';
  import { fill, strings } from '../lib/strings';
  import Menu from './Menu.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import StateRing from './StateRing.svelte';
  import ThreadPicture from './ThreadPicture.svelte';
  import ThreadState from './ThreadState.svelte';

  /**
   * A thread in a phone's list, one line the way a mail app lists its mail:
   * its picture in the state ring, the title and the time. A second grey line
   * comes only for what the user must know from the list: what it waits on in
   * the Inbox, a move to come, the project and machine when the list mixes
   * them, a subagent asking. With that line the time moves to its right end,
   * as on the desktop, and the title has the first line to itself. The branch and the pull request are the thread's
   * own header. A long press opens the row's sheet; the same sheet's trigger
   * stays in the row for a keyboard and a screen reader, drawn only while it
   * has the focus. A finger slides the row right to mark it done or left to
   * archive it, each with the Undo toast.
   * `grouped`: under its project's header, which already names it.
   */
  let { machine, project, thread, now, items, grouped = false, several = false, pin = true, start = false, end = false, wait, onopen, onaction }: {
    machine: Machine;
    /** A bot's thread belongs to no project. */
    project: Project | undefined;
    thread: ThreadSummary;
    now: number;
    items: MenuItem[];
    grouped?: boolean;
    several?: boolean;
    /** Off under Recent's band labels, the Pinned one already saying it. */
    pin?: boolean;
    /** The first row of a Recent band: its card's top corners are rounded, as a project card's are. */
    start?: boolean;
    /** The last row of a Recent band: its card ends under it, so it draws no hairline and its bottom corners are rounded. */
    end?: boolean;
    /** The Inbox tab: what the thread waits on and since when, the desktop Inbox card's reason, in place of the state's time. */
    wait?: { reason: InboxReason; since: number };
    onopen: () => void;
    onaction: (action: string) => void;
  } = $props();
  let owner = $derived(machine.store);
  let away = $derived(owner.connection !== 'ready');
  /** The open thread's row counts what its strip and panel tab count (`rowSubagents`). */
  let subagents = $derived(rowSubagents(owner, thread.id));
  let kind = $derived(threadState(thread, subagents));
  let agents = $derived(delegatedChip(subagents));
  /** Nothing live on it and not pinned, Recent's Earlier band: the provider's mark takes the muted tier, as on the desktop. */
  let quiet = $derived(!thread.pinned && threadLiveKind(thread, kind) === null);
  /** A failure says so in words after the project, so the red mark is not the only cue; the Inbox tab already words its reason. */
  let failed = $derived(wait || away ? null : kind === 'error' ? strings.sidebar.state.error : kind === 'interrupted' ? strings.sidebar.state.interrupted : null);
  /** A row that needs the user counts from the home card's `since`, so both read one age. */
  let waited = $derived(wait ? null : waitingSince(owner, thread));
  let pending = $derived(pendingLine(thread));
  /** The machine is named only when it is not this one (`namesMachine`), as "· Failed" is, after the project, with its glyph. */
  let elsewhere = $derived(several && !grouped && namesMachine(machine, away));
  /** The grey second line; the time joins it, so the title keeps the whole first line. */
  let second = $derived(Boolean(wait || pending || (!grouped && project) || elsewhere || failed || agents?.asking));
  /** A pinned row draws its pin just before the time, on the second line when it has one. */
  let pinned = $derived(thread.pinned && pin);
  /**
   * A row that needs the user, wherever it is listed (Recent's band, its Needs you filter, a
   * project's card), pinned or not: a long title takes a second line before its ellipsis, as on
   * the desktop. Every other row keeps one line, except under a project's header at 360 px.
   */
  let clamp = $derived(threadLiveKind(thread, kind) === 'needs');
  /**
   * A title that may wrap with no grey line under it: the draft, the pin and the time end its
   * last line (`lastLine`), as they end the grey line when there is one, so a wrapped title
   * has its first line to itself and the ages of a project's rows share one line.
   */
  let low = $derived(!second && (clamp || grouped));
  /** The chip is drawn only while subagents ask: it says they need the user, with how many ask. */
  let asking = $derived((subagents?.asking ?? 0) === 1 ? strings.sidebar.state.subagentsAskingOne : fill(strings.sidebar.state.subagentsAskingMany, { count: String(subagents?.asking ?? 0) }));
  const reasonIcons = { question: MessageCircleQuestion, permission: ShieldQuestion, secret: KeyRound, 'sign-in': LogIn, failed: CircleAlert, interrupted: CirclePause } as const;
  let draft = $derived(hasUnsentDraft(owner.composerStates[thread.id]) && !(owner.openThread?.id === thread.id));
  /** What a slide may do now: the menu's own items, so a thread at work is never marked done by a finger. */
  const allowed = (side: SwipeSide) => items.some(item => item.id === (side === 'right' ? 'done' : 'archive') && !item.disabled);
  let body = $state<HTMLElement>();
  /** The long press opens the sheet the trigger opens, under the row. */
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    body?.parentElement?.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')?.click();
  }
</script>

{#snippet pinMark()}<span class="mark pin" data-testid="thread-pinned"><Pin size={13} /></span>{/snippet}
{#snippet time()}
  {#if wait}<time class="time waited" datetime={new Date(wait.since).toISOString()} title={fill(strings.inbox.waited, { time: waitedFor(now, wait.since) })}>{waitedFor(now, wait.since)}</time>
  {:else}<span class="time"><ThreadState {thread} {now} {subagents} {away} {waited} compact /></span>{/if}
{/snippet}

<div class="phone-row" class:offline={away} class:quiet class:grouped class:start class:end data-thread-id={thread.id} data-machine-id={machine.id} data-testid="mobile-row">
  <!-- Under the row while it slides: done on the left, archive on the right, armed past the threshold. -->
  <div class="reveal" aria-hidden="true">
    <span class="side done"><Check size={20} /><span class="ui-label">{strings.sidebar.markDone}</span></span>
    <span class="side archive"><span class="ui-label">{strings.sidebar.archive}</span><Archive size={20} /></span>
  </div>
  <!-- The long press and the slide are a finger's shortcuts; the menu trigger below is the keyboard's. -->
  <div class="body" role="presentation" bind:this={body} use:swipeActions={{ allows: allowed, run: side => onaction(side === 'right' ? 'done' : 'archive') }} use:longPress oncontextmenu={openMenu}>
    <StateRing {kind} asking={asksMidTurn(thread, subagents)} stale={away} size={32} ground="var(--ring-ground, var(--color-background))">
      <span class="face"><ThreadPicture {owner} {thread} size={32} logo={18} mono={quiet} /></span>
    </StateRing>
    <span class="lines">
      <!-- The title is the row's button; its overlay stretches over the whole row, so a tap anywhere opens it
           while the pull request's link above the overlay stays its own target, never a link inside a button. -->
      <span class="head" class:clamp class:low data-lines={clamp ? 2 : undefined} use:lastLine={low ? thread.title : null}>
        <button class="ghost thread" data-testid="mobile-thread-{thread.id}" onclick={onopen}>
          <span class="title" class:unread={thread.unread} data-last-line="title">{thread.title}{#if low}<span class="room" data-last-line="room" aria-hidden="true"></span>{/if}</span>
        </button>
        <span class="cluster" data-last-line="cluster">
          {#if draft}<span class="mark draft" data-testid="thread-draft" title={strings.sidebar.unsentDraft} aria-label={strings.sidebar.unsentDraft}><PencilLine size={13} /></span>{/if}
          {#if pinned && !second}{@render pinMark()}{/if}
          {#if !second}{@render time()}{/if}
        </span>
      </span>
      {#if second}
        <span class="meta">
          {#if wait}{@const Icon = reasonIcons[wait.reason]}<span class="fact why" class:failed={wait.reason === 'failed' || wait.reason === 'sign-in' || wait.reason === 'interrupted'} data-testid="thread-wait-reason" data-reason={wait.reason}><Icon size={12} aria-hidden="true" /><span class="ui-label" title={strings.inbox.reasons[wait.reason]}>{strings.inbox.reasonTags[wait.reason]}</span></span>{/if}
          {#if pending}<span class="fact pending" data-testid="thread-pending" title={pending}><FolderInput size={12} aria-hidden="true" /><span class="ui-label">{pending}</span></span>{/if}
          {#if !grouped && project}<span class="fact project" data-testid="thread-project"><ProjectTile {project} store={owner} size={12} /><span class="ui-label">{projectName(project)}</span></span>{/if}
          {#if elsewhere}<span class="fact machine" data-testid="thread-machine"><span class="dot" aria-hidden="true">·</span><MachineIcon icon={machine.icon} os={owner.core?.os} size={12} /><span class="ui-label">{machine.label}</span></span>{/if}
          {#if failed}<span class="fact failed" data-testid="thread-failed"><span aria-hidden="true">·</span><span class="ui-label">{failed}</span></span>{/if}
          <!-- Agents at work are the ring's to say; one asking is said here, it needs the user. -->
          {#if agents?.asking}<span class="fact agents asking" data-testid="thread-subagents" data-count={agents.shown} role="img" title={agents.label} aria-label={agents.label}><Network size={12} aria-hidden="true" /><span class="ui-label">{wait ? agents.shown : asking}</span></span>{/if}
          {#if pinned}{@render pinMark()}{/if}
          {@render time()}
        </span>
      {/if}
    </span>
  </div>
  <!-- The row's actions: the same sheet a long press opens. A finger has the long press; the keyboard and a
       screen reader reach this trigger, drawn while it has the focus, and the sheet anchors to it. -->
  <span class="menu-slot">
    <Menu {items} onpick={onaction} label={strings.sidebar.threadMenu} placement="bottom" variant="ghost" testid="mobile-thread-menu-{thread.id}"><Ellipsis size={18} /></Menu>
  </span>
</div>

<style>
  .phone-row {
    position: relative;
    overflow: hidden;
    -webkit-touch-callout: none;
  }
  /* The hairline is drawn over the row's last pixel instead of under it, so a row is 56 or 64 px whole. */
  /* Inset to the title, as a grouped list draws its separators. */
  .phone-row::after { content: ''; position: absolute; inset: auto var(--hairline-end, 0px) 0 56px; z-index: 1; border-bottom: 1px solid var(--color-border); pointer-events: none; }
  /* A band's card ends here: the gap to the next band parts them, no rule. */
  .phone-row.end::after { display: none; }
  /* Each band reads as one rounded group, like the Projects view's cards: the row's own clip rounds its ground. */
  .phone-row.start { border-top-left-radius: var(--radius-lg); border-top-right-radius: var(--radius-lg); }
  .phone-row.end { border-bottom-left-radius: var(--radius-lg); border-bottom-right-radius: var(--radius-lg); }
  /* Inside a project's card the row sits on the card's surface, not the list's ground. */
  :global(.project-group) .phone-row { --row-ground: var(--color-cell); --ring-ground: var(--color-cell); }
  .reveal {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-muted-foreground);
    background: var(--color-surface-2);
    opacity: 0;
    transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
  }
  .side { display: inline-flex; align-items: center; gap: 8px; opacity: 0; }
  .phone-row:global([data-swipe]) > .reveal { opacity: 1; }
  .phone-row:global([data-swipe='right']) .done, .phone-row:global([data-swipe='left']) .archive { opacity: 1; }
  /* Past the threshold the reveal takes the action's colour: letting go now acts. */
  .phone-row:global([data-swipe='right'][data-armed]) > .reveal { background: var(--color-success); color: var(--color-accent-ink); }
  .phone-row:global([data-swipe='left'][data-armed]) > .reveal { background: var(--color-accent); color: var(--color-accent-ink); }
  .phone-row:global([data-swipe='right']:not([data-armed])) > .reveal { color: var(--color-success); }
  .phone-row:global([data-swipe='left']:not([data-armed])) > .reveal { color: var(--color-accent); }
  .body {
    position: relative;
    display: flex;
    /* 52 px for the one line, 60 with the grey line under it. */
    min-height: 52px;
    gap: 10px;
    align-items: center;
    padding: 4px 16px 4px 8px;
    user-select: none;
    touch-action: pan-y;
    transform: translateX(var(--swipe, 0px));
    transition: transform var(--dur-3) var(--ease-out-quint);
    background: var(--row-ground, var(--color-cell));
  }
  .body:global(.dragging) { transition: none; }
  .thread {
    display: block;
    width: 100%;
    height: auto;
    padding: 0;
    text-align: left;
    white-space: normal;
    border-radius: 0;
    color: var(--color-foreground);
  }
  /* No position on the button or .lines: the overlay is placed against .body, the whole row. */
  .thread::after { content: ''; position: absolute; inset: 0; }
  .thread:hover:not(:disabled) { background: transparent; color: var(--color-foreground); }
  .thread:active::after { background: var(--color-hover); }
  .thread:focus-visible { outline: none; }
  .thread:focus-visible::after { outline: 2px solid var(--color-accent); outline-offset: -2px; }
  .face { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--color-surface-2); }
  /* A quiet row's mark: the muted tier at full strength, the ring's resting dim would take it under 4.5:1. */
  .quiet .face { color: var(--color-muted-foreground); }
  .quiet :global([data-testid='state-ring'].ring .picture) { opacity: 1; }
  .phone-row.offline .lines, .phone-row.offline .face { opacity: 0.55; }
  .lines { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
  .head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .head .thread { flex: 0 1 auto; width: auto; min-width: 0; }
  /* The marks and the time are the head's own items until the title may wrap (`.low`). */
  .cluster { display: contents; }
  /* There the title runs the row's width and the cluster ends its last line, on that line's
     baseline: a strut in the title's type sets it. Both share one grid cell, never a positioned
     box, so the title's overlay still spans the whole row. The title's last word carries an empty
     room the cluster's width plus the gap (`lastLine`); past its lines, every line keeps that room. */
  .head.low { display: grid; grid-template-columns: minmax(0, 1fr); --room-gap: 6px; }
  .head.low > * { grid-area: 1 / 1; }
  .head.low .thread { width: 100%; }
  /* Balanced: with the whole first line free, `pretty` let one word end the title alone. */
  .head.low .title { text-wrap: balance; }
  .low .room { padding-left: calc(var(--room, 0px) + var(--room-gap)); }
  .low .cluster { justify-self: end; align-self: end; display: flex; align-items: baseline; gap: var(--room-gap); }
  .low .cluster::before { content: '\200b'; width: 0; margin-right: calc(-1 * var(--room-gap)); font-size: 15px; line-height: 1.3; }
  .low .cluster .time { margin-left: 0; }
  .head.low:global([data-fit='narrow']) .title { padding-right: calc(var(--room, 0px) + var(--room-gap)); }
  .head.low:global([data-fit='narrow']) .room { display: none; }
  .title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.3;
  }
  .title.unread { font-weight: 650; }
  /* Needs you: up to two lines, then the ellipsis; the marks stay on the first line's centre.
     `pretty` keeps the second line from ending on one word. */
  .clamp .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
  .clamp:not(.low) .mark { align-self: flex-start; margin-top: 3px; }
  /* At 360 px a project's row leaves the title about 200 px: one line cut it to "…the co…", so every
     title there takes up to two lines. */
  @media (max-width: 360px) {
    .grouped .title {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      white-space: normal;
      overflow-wrap: anywhere;
      text-wrap: pretty;
    }
    .grouped .head:not(.low) .mark { align-self: flex-start; margin-top: 3px; }
  }
  /* On the second line the pin stands right before the time, at the line's end. */
  .meta .mark.pin { margin-left: auto; }
  .meta .mark.pin + .time { margin-left: 0; padding-left: 0; }
  .mark { display: inline-flex; flex: none; align-self: center; }
  .mark.draft { color: var(--color-accent); }
  .mark.pin { color: var(--color-muted-foreground); }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    line-height: 16px;
    color: var(--color-muted-foreground);
  }
  /* Half an em of clip room under a trimmed label: at the label's own height, "2 agents" lost the tail of its g. */
  .fact { display: inline-flex; align-items: center; gap: 4px; min-width: 0; flex: 0 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-block: 0.5em; margin-block: -0.5em; }
  .fact .ui-label { overflow: hidden; text-overflow: ellipsis; }
  .fact.agents { flex: none; }
  /* The failure's word keeps its room; the project's name yields first. */
  .fact.failed { flex: none; gap: 8px; }
  /* Under a project's header nothing comes before it: the word leads, with no dot. */
  .meta > .fact.failed:first-child > [aria-hidden='true'] { display: none; }
  /* The machine yields its room before the project loses a letter: shrink is weighted by width, so the steps are far apart. */
  .fact.machine { flex-shrink: 1000; }
  /* The dot stands 8 px from the glyph, as "· Failed" stands from its word. */
  .fact.machine .dot { flex: none; margin-right: 4px; }
  .fact.machine > :global(svg) { flex: none; }
  .fact.project { flex-shrink: 1; }
  .fact.project { max-width: 55%; }
  .fact.project :global(.tile.letter) { font-size: 9px; font-weight: 600; }
  .pending { color: var(--color-accent); }
  .agents.asking { color: var(--color-live); }
  /* The reason, one word, leads the line and never yields its room; the wait reads in the needs colour, a failure in danger. */
  .fact.why { flex: none; color: var(--color-foreground); font-weight: 500; }
  .fact.why > :global(svg) { color: var(--color-live); }
  .fact.why.failed > :global(svg) { color: var(--color-danger); }
  /* Grey like every time in the list: the ring says it waits. */
  .waited { font-variant-numeric: tabular-nums; color: var(--color-subtle); font-size: 13px; }
  .time { margin-left: auto; flex: none; padding-left: 4px; }
  .time :global(.when) { font-size: 13px; }
  /* On the second line the time is 12 px at the line's right end, in the meta tier beside the muted facts. */
  .meta { --when-color: var(--color-meta); }
  .meta .time :global(.when), .meta .waited { font-size: var(--text-xs); }
  .meta .waited { color: var(--color-meta); }
  /* The sheet's anchor at the row's right end, 44 px square, drawn only while the keyboard is on it. */
  .menu-slot {
    position: absolute;
    right: 0;
    bottom: 4px;
    display: flex;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-2) var(--ease-out-quint);
  }
  .menu-slot:focus-within { opacity: 1; pointer-events: auto; }
  .menu-slot :global(.trigger) { width: 44px; height: 44px; justify-content: center; color: var(--color-muted-foreground); background: var(--row-ground, var(--color-cell)); }
  .phone-row:global([data-swipe]) .menu-slot { opacity: 0; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .body { transition: none; } }
  :global(html[data-motion='reduced']) .body { transition: none; }
</style>
