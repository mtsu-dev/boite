<script lang="ts">
  import { Archive, Bot, Check, Ellipsis, FolderInput, GitBranch, PencilLine, Pin } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { MenuItem } from '../lib/menu';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { delegatedChip, threadState } from '../lib/thread-state';
  import { pendingLine } from '../lib/thread-move.svelte';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import { longPress } from '../lib/long-press';
  import { swipeActions, type SwipeSide } from '../lib/swipe-actions';
  import { projectName } from '../lib/format';
  import { strings } from '../lib/strings';
  import Menu from './Menu.svelte';
  import PullRequestBadge from './PullRequestBadge.svelte';
  import StateRing from './StateRing.svelte';
  import ThreadPicture from './ThreadPicture.svelte';
  import ThreadState from './ThreadState.svelte';

  /**
   * A thread in a phone's list: its picture in the state ring, the title on up
   * to two lines, then one line of facts (the project and the machine when the
   * list mixes them, the pull request, the branch, its agents) and the time.
   * No menu button: a long press opens the row's sheet, whose trigger stays in
   * the row for a screen reader and the keyboard. A finger slides the row right
   * to mark it done or left to archive it, each with the Undo toast.
   * `grouped`: under its project's header, which already names it.
   */
  let { machine, project, thread, now, items, grouped = false, several = false, onopen, onaction }: {
    machine: Machine;
    /** A bot's thread belongs to no project. */
    project: Project | undefined;
    thread: ThreadSummary;
    now: number;
    items: MenuItem[];
    grouped?: boolean;
    several?: boolean;
    onopen: () => void;
    onaction: (action: string) => void;
  } = $props();
  let owner = $derived(machine.store);
  let away = $derived(owner.connection !== 'ready');
  let subagents = $derived(owner.subagents(thread.id));
  let kind = $derived(threadState(thread, subagents));
  let agents = $derived(delegatedChip(subagents));
  let pending = $derived(pendingLine(thread));
  let draft = $derived(hasUnsentDraft(owner.composerStates[thread.id]) && !(owner.openThread?.id === thread.id));
  const pr = trackThreadPullRequest(() => ({ owner, thread }));
  /** What a slide may do now: the menu's own items, so a thread at work is never marked done by a finger. */
  const allowed = (side: SwipeSide) => items.some(item => item.id === (side === 'right' ? 'done' : 'archive') && !item.disabled);
  let body = $state<HTMLElement>();
  /** The long press opens the sheet the trigger opens, under the row. */
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    body?.parentElement?.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')?.click();
  }
</script>

<div class="phone-row" class:offline={away} data-thread-id={thread.id} data-machine-id={machine.id} data-testid="mobile-row">
  <!-- Under the row while it slides: done on the left, archive on the right, armed past the threshold. -->
  <div class="reveal" aria-hidden="true">
    <span class="side done"><Check size={20} /><span class="ui-label">{strings.sidebar.markDone}</span></span>
    <span class="side archive"><span class="ui-label">{strings.sidebar.archive}</span><Archive size={20} /></span>
  </div>
  <!-- The long press and the slide are a finger's shortcuts; the menu trigger below is the keyboard's. -->
  <div class="body" role="presentation" bind:this={body} use:swipeActions={{ allows: allowed, run: side => onaction(side === 'right' ? 'done' : 'archive') }} use:longPress oncontextmenu={openMenu}>
    <StateRing {kind} stale={away} size={32} ground="var(--ring-ground, var(--color-background))">
      <span class="face"><ThreadPicture {owner} {thread} size={32} logo={18} /></span>
    </StateRing>
    <span class="lines">
      <!-- The title is the row's button; its overlay stretches over the whole row, so a tap anywhere opens it
           while the pull request's link above the overlay stays its own target, never a link inside a button. -->
      <button class="ghost thread" data-testid="mobile-thread-{thread.id}" onclick={onopen}>
        <span class="title" class:unread={thread.unread}>{thread.title}{#if draft}<span class="mark draft" data-testid="thread-draft" title={strings.sidebar.unsentDraft} aria-label={strings.sidebar.unsentDraft}><PencilLine size={13} /></span>{/if}{#if thread.pinned}<span class="mark pin"><Pin size={13} /></span>{/if}</span>
      </button>
      <span class="meta">
        {#if pending}<span class="fact pending" data-testid="thread-pending" title={pending}><FolderInput size={12} aria-hidden="true" /><span class="ui-label">{pending}</span></span>{/if}
        {#if !grouped && project}<span class="fact project" data-testid="thread-project">{projectName(project)}</span>{/if}
        {#if several && !grouped}<span class="fact machine">{machine.label}</span>{/if}
        {#if pr.value}<span class="fact pr"><PullRequestBadge pullRequest={pr.value} /></span>{/if}
        {#if agents}<span class="fact agents" class:asking={agents.asking} data-testid="thread-subagents" data-count={agents.shown} role="img" title={agents.label} aria-label={agents.label}><Bot size={12} aria-hidden="true" /><span class="ui-label">{agents.text}</span></span>{/if}
        {#if thread.branch}<span class="fact branch" data-testid="thread-branch" title={thread.branch}><GitBranch size={12} aria-hidden="true" /><span class="ui-label">{thread.branch}</span></span>{/if}
        <span class="time"><ThreadState {thread} {now} {subagents} {away} compact /></span>
      </span>
    </span>
  </div>
  <!-- The row's actions without a visible button: a long press opens them, a screen reader and a keyboard reach them here. -->
  <span class="menu-slot">
    <Menu {items} onpick={onaction} label={strings.sidebar.threadMenu} placement="bottom" variant="ghost" testid="mobile-thread-menu-{thread.id}"><Ellipsis size={18} /></Menu>
  </span>
</div>

<style>
  .phone-row {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--color-border);
    -webkit-touch-callout: none;
  }
  /* Inside a project's card the row sits on the card's surface, not the list's ground. */
  :global(.project-group) .phone-row { --row-ground: var(--color-surface); --ring-ground: var(--color-surface); }
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
    min-height: 64px;
    gap: 12px;
    align-items: center;
    padding: 10px 12px 10px 8px;
    user-select: none;
    touch-action: pan-y;
    transform: translateX(var(--swipe, 0px));
    transition: transform var(--dur-3) var(--ease-out-quint);
    background: var(--row-ground, var(--color-background));
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
  /* What a finger can reach inside the row rides above the overlay. */
  .fact.pr { position: relative; z-index: 1; }
  .face { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--color-surface-2); }
  .phone-row.offline .lines, .phone-row.offline .face { opacity: 0.55; }
  .lines { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
  .title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .mark { display: inline-flex; margin-left: 6px; vertical-align: -1px; }
  .mark.draft { color: var(--color-accent); }
  .mark.pin { color: var(--color-muted-foreground); }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    color: var(--color-muted-foreground);
  }
  .fact { display: inline-flex; align-items: center; gap: 4px; min-width: 0; flex: 0 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .fact .ui-label { overflow: hidden; text-overflow: ellipsis; }
  .fact.pr, .fact.agents { flex: none; }
  /* The project names the row in a mixed list: the branch yields its room first. */
  .fact.project { flex-shrink: 0; max-width: 55%; }
  .pending { color: var(--color-accent); }
  .agents { color: var(--color-accent); }
  .agents.asking { color: var(--color-live); }
  .branch { font-family: var(--font-mono); font-size: 12px; }
  .time { margin-left: auto; flex: none; padding-left: 4px; }
  .time :global(.when) { font-size: 13px; }
  /* The trigger is real but out of sight; focusing it from the keyboard shows it over the row's end. */
  .menu-slot {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 4px;
    display: flex;
    align-items: center;
    clip-path: inset(50%);
    opacity: 0;
  }
  .menu-slot:focus-within, .menu-slot:has(:global([aria-expanded='true'])) { clip-path: none; opacity: 1; }
  .menu-slot :global(.trigger) { background: var(--row-ground, var(--color-background)); }
  @media (prefers-reduced-motion: reduce) { .body { transition: none; } }
  :global(html[data-motion='reduced']) .body { transition: none; }
</style>
