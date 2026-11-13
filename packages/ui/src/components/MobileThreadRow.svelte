<script lang="ts">
  import { rowAsks, stateForm } from '../lib/status-order';
  import { Archive, Ellipsis, GitBranch, Pin, PinOff } from '@lucide/svelte';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { MenuItem } from '../lib/menu';
  import { strings } from '../lib/strings';
  import { closeSwipedRow, swipeRow } from '../lib/swipe-row';
  import { longPress } from '../lib/long-press';
  import Menu from './Menu.svelte';
  import CommandWords from './CommandWords.svelte';
  import MachinePlace from './MachinePlace.svelte';
  import type { RowPlace } from '../lib/row-place';
  import ThreadHeadline from './ThreadHeadline.svelte';
  import PullRequestBadge from './PullRequestBadge.svelte';
  import ThreadState from './ThreadState.svelte';
  import { wordFit } from '../lib/word-fit';
  import { threadState } from '../lib/thread-state';
  import { feedOperation, feedQuestion, feedSecondary, feedVerbLabel, type FeedKind, type FeedVerb } from '../lib/activity-feed';
  import { feedAsk } from '../lib/feed-row';
  import { ago, exactTime } from '../lib/format';
  import DecisionActions from './DecisionActions.svelte';
  import ActivityKind from './ActivityKind.svelte';
  import ClampText from './ClampText.svelte';
  import { collapseRow } from '../lib/row-collapse';

  /**
   * A phone's thread row, the desktop row's grammar at a finger's size (ThreadHeadline.svelte): the title gets the
   * width, two lines of it before any ellipsis, its mark, its word and its time at the end of its first line, then where it
   * lives under it when the list says so. A list row's place line also carries its pull request, a link, and its branch, as
   * before the redraw, outside the row's button; the pin waits under the slide. `compact` is
   * the flat lists' form (Recent, Activity): the project's tile first, unless the line under the title names the
   * project in words. Activity (the phone's screen) is a card under its kind line, whose glyph is the card's one
   * mark (ActivityKind.svelte): the whole title on the card's width, on the kind word's edge as on the desktop; under
   * it the place line, where the decision comes from and since when (`where`, lib/feed-row.ts); an
   * update opens on what happened with its time beside it, so its place line only says where; then what the thread wants, one line, a permission titled by what it
   * does as the composer titles it; a command it asks to run reads in full in a mono block under them.
   * Its machine out of reach, "Offline" is said once: on the place line, unless the card above says it (`placed`). A sub-agent with the same ask is a line of its own (`helpers`), one
   * event per row, as on the desktop; `verb` names what a Needs you row asks: the decision pair after the content,
   * right-aligned as on the desktop (DecisionActions.svelte), Deny or Skip outlined and settled here, then the verb
   * solid; Review, when the command is too long to read here, outlined alone.
   * `onverb` opens what the verb is for, the row itself unless a sub-agent asks.
   * In the lists the row menu has no button of its own: a long press opens it, a slide left shows pin and archive,
   * and its trigger stays for the keyboard, drawn only while focused. An Activity card shows it at its kind line's
   * end, as every Activity card does.
   */
  let { machine, thread, project, now, items, compact = false, reason, at, helpers = [], verb = null, kind: feedKind = null, where, placed = false, onopen, onverb = onopen, onaction }: {
    machine: Machine; thread: ThreadSummary; project: Project | undefined; now: number; items: MenuItem[]; compact?: boolean;
    reason?: string; at?: number; verb?: FeedVerb | null;
    /** Activity's Needs you rows: what the decision is, named on the row's first line (ActivityKind.svelte). */
    kind?: FeedKind | null;
    /** Activity: the sub-agents of this thread that ask, each with what it asks. */
    helpers?: { thread: ThreadSummary; reason?: string }[];
    /** Recent and Activity: where the row lives, first on its line under the title (lib/row-place.ts, lib/feed-row.ts). */
    where?: RowPlace;
    /** The card above names the machine and says it is out of reach: the row only mutes its title. */
    placed?: boolean;
    onopen: () => void; onverb?: (event?: MouseEvent) => void; onaction: (action: string) => void;
  } = $props();
  const owner = $derived(machine.store);
  const pin = $derived(items.find(item => item.id === 'pin'));
  const archive = $derived(items.find(item => item.id === 'archive'));
  const kind = $derived(thread.archived ? null : threadState(thread, rowAsks(owner, thread.id)));
  /** A dot when the user must act or a turn failed, the arc for work, each with its word; the time alone otherwise (ThreadState draws it then). */
  const form = $derived(stateForm(kind));
  const away = $derived(owner.connection !== 'ready');
  const pr = trackThreadPullRequest(() => ({ owner, thread }));
  /** A list row's pull request and branch; Activity's cards keep their own lines. */
  const pullRequest = $derived(reason === undefined ? pr.value : null);
  const branch = $derived(reason === undefined ? thread.branch : undefined);
  /** "Offline" said once: on the place line, unless the card's head, the place's machine or the row's own state
      (work it last saw, ThreadState.svelte) already says it. */
  const chip = $derived(away && !placed && !where?.host?.away && form !== 'work');
  const listLine = $derived(reason === undefined && (!!where || chip || !!branch || pullRequest !== null));
  /** Activity: what the thread asks, in words, a question whole; nothing when its reason only names the place line's project. */
  const ask = $derived(reason === undefined ? null : feedQuestion(owner, thread.id) ?? feedAsk(owner, thread.id, { reason, place: where?.project }));
  /** Activity: the whole command the thread asks to run, read before Allow. */
  const operation = $derived(reason === undefined ? null : feedOperation(owner, thread.id));
  const long = $derived(!!operation && (operation.split('\n').length > 6 || operation.length > 480));
  const action = $derived<FeedVerb | null>(verb === 'allow' && long ? 'review' : verb);
  /** The pair's other half, for the row's own request only: a sub-agent's is settled in its thread. */
  const secondary = $derived(reason === undefined ? null : feedSecondary(owner, thread.id, action));
  let settling = $state(false);
  async function settle() {
    if (!secondary || settling) return;
    settling = true;
    try { await secondary.run(); } finally { settling = false; }
  }
  let menu = $state<HTMLElement>();
  /** A long press, or Android's own, opens the row's menu where its hidden trigger stands. */
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    if (menu?.contains(event.target as Node)) return;
    menu?.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')?.click();
  }
  function swiped(action: string) { closeSwipedRow(); onaction(action); }
</script>

{#snippet placeLine(since?: number)}
  <span class="meta" data-testid="mobile-row-meta"><span class="where" data-testid="mobile-row-where" title={where?.text}>{#if where?.project}<span class="ui-label" use:wordFit={where.project}></span>{/if}{#if where?.host}<MachinePlace host={where.host} />{/if}{#if chip}<span class="away" data-testid="thread-offline">{strings.connection.offline}</span>{/if}{#if pullRequest}<PullRequestBadge {pullRequest} />{/if}{#if branch}<span class="branch" data-testid="thread-branch" title={branch}><GitBranch size={12} /><span class="ui-label">{branch}</span></span>{/if}</span>{#if since !== undefined}<time class="since ui-label" title={exactTime(since)}>{ago(since, now)}</time>{/if}</span>
{/snippet}
{#snippet why()}{@render placeLine(verb || !feedKind ? at : undefined)}{/snippet}

<div class="row" out:collapseRow|global={() => !owner.threads.some(entry => entry.id === thread.id)} class:reason={reason !== undefined} class:tiled={compact && project !== undefined && where === undefined} data-row-card={reason !== undefined ? '' : undefined} data-testid="mobile-row" data-thread-id={thread.id} data-machine-id={machine.id}>
  <!-- Under the row, for a finger that slides it left; the long press offers the same to everyone else. -->
  {#if pin || archive}
    <div class="swipe-actions" data-swipe-actions aria-hidden="true">
      {#if pin}<button type="button" class="swipe" tabindex="-1" data-testid="mobile-swipe-pin-{thread.id}" onclick={() => swiped('pin')}>{#if thread.pinned}<PinOff size={18} />{:else}<Pin size={18} />{/if}<span class="ui-label">{pin.label}</span></button>{/if}
      {#if archive}<button type="button" class="swipe" tabindex="-1" data-testid="mobile-swipe-archive-{thread.id}" onclick={() => swiped('archive')}><Archive size={18} /><span class="ui-label">{archive.label}</span></button>{/if}
    </div>
  {/if}
  <!-- The row's contextmenu (a long press, Android's, a right click) opens the menu wherever it lands; the button inside stays the keyboard's target. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="body" use:swipeRow oncontextmenu={openMenu}>
    <button class="ghost thread" class:offline={away} class:stated={kind !== null} data-testid="mobile-thread-{thread.id}" title={[thread.title, reason, thread.branch].filter(Boolean).join('\n')} onclick={onopen} use:longPress>
      <!-- One line for every list (ThreadHeadline.svelte): the title, then the mark and its word in the row's one slot
           and the time after it; in Activity the decision's kind over it, its glyph the card's mark, and the place
           line under it. A card with no kind wears the row's mark in that glyph's place. -->
      {#if feedKind}<ActivityKind kind={feedKind}>{#if !verb && at !== undefined}<time title={exactTime(at)}>{ago(at, now)}</time>{/if}</ActivityKind>{/if}
      {#if reason !== undefined}
        <span class="title-line" data-row-title>{#if !feedKind && form !== null}<span class="lone-mark"><ThreadState {thread} {now} subagents={rowAsks(owner, thread.id)} {away} mark /></span>{/if}<ThreadHeadline {owner} {thread} offline={away} ask={why} /></span>
      {:else}
        <ThreadHeadline {owner} {thread} {now} tile={compact && where === undefined ? project : undefined} offline={away}
          at={form !== null ? thread.lastUserMessageAt ?? thread.createdAt : undefined} />
      {/if}
      {#if listLine}<span class="meta meta-room" aria-hidden="true"><span class="ui-label">&nbsp;</span></span>{/if}
    </button>
    <!-- A list row's place line over the room kept for it: the pull request's link cannot sit inside the row's button. -->
    {#if listLine}<div class="list-meta">{@render placeLine()}</div>{/if}
    {#if reason !== undefined && (ask || operation || helpers.length > 0)}
      <!-- What is decided on, whole up to four lines and behind "Show all" past them (ClampText.svelte), then the
           sub-agents asking the same; outside the row's button, since the fold is a button of its own. -->
      <div class="detail">
        {#if ask}<ClampText text={ask} testid="mobile-row-reason" />{/if}
        {#if operation}<ClampText text={operation} testid="thread-operation" mono><CommandWords text={operation} /></ClampText>{/if}
        {#each helpers as helper (helper.thread.id)}
          <span class="why helper" data-testid="thread-helper" data-thread-id={helper.thread.id}><span class="text"><span class="who">{helper.thread.title}</span> <span class="sep" aria-hidden="true">·</span> {helper.reason}</span></span>
        {/each}
      </div>
    {/if}
    {#if action}
      <div class="verbs">
        <DecisionActions>
          {#if secondary}<button type="button" class="secondary" data-testid="thread-verb-secondary" data-verb={secondary.kind} disabled={settling} onclick={() => void settle()}>{feedVerbLabel(secondary.kind)}</button>{/if}
          <button type="button" class={action === 'review' ? 'secondary' : 'primary'} data-testid="thread-verb" data-verb={action} onclick={onverb}>{feedVerbLabel(action)}</button>
        </DecisionActions>
      </div>
    {/if}
    <span class="row-menu" bind:this={menu}><Menu {items} onpick={onaction} label={strings.sidebar.threadMenu} heading={thread.title} placement="bottom" variant="ghost" testid="mobile-thread-menu-{thread.id}"><Ellipsis size={18} /></Menu></span>
  </div>
</div>

<style>
  .row { position: relative; display: block; overflow: hidden; }
  /* What a slide uncovers: pin, then archive at the edge, as mail apps lay them. */
  .swipe-actions { position: absolute; inset: 0 0 0 auto; display: flex; }
  .swipe { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 76px; height: 100%; padding: 0 6px; border: 0; border-radius: 0;
    font-size: var(--text-meta); font-weight: 500; background: var(--color-surface-3); color: var(--color-foreground); }
  .swipe .ui-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Its own formatting context: the verb's bottom margin stays inside its ground instead of showing the slide's
     buttons under it. */
  .body { position: relative; display: flow-root; touch-action: pan-y; transform: translateX(var(--swipe, 0px)); transition: transform var(--dur-3) var(--ease-out-quint); background: var(--row-background, var(--color-background)); }
  .body:global(.dragging) { transition: none; }
  /* The title's line, its mark and time at its end, then where it lives: a finger's 44 px at least. */
  .thread { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 4px; width: 100%; min-height: var(--touch-target); height: auto; padding: 10px 12px; border-radius: 0; text-align: left; font-size: var(--text-reading); color: var(--color-foreground); }
  /* The line under the title, in the list's quiet ink, from the title's edge: where the row lives, or a sub-agent
     that asks the same. */
  .meta, .why { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); line-height: 1.4; color: var(--color-muted-foreground); }
  .tiled .meta { margin-left: 26px; }
  /* Activity's content under the title's button, on its edge. */
  .detail { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 10px 31px; margin-top: -4px; }
  /* Activity's title line, on the kind word's edge (the glyph's 13 px and its 6 px gap, ActivityKind.svelte). */
  .title-line { position: relative; display: flex; align-items: flex-start; min-width: 0; padding-left: 19px; }
  .title-line > :global(.headline) { flex: 1; }
  /* A card with no kind line: the row's mark in the glyph's column, on the middle of the title's capitals, which its
     trimmed box (.ui-label) starts on; the title's line ends before the menu there. */
  .lone-mark { position: absolute; left: 0; top: calc(0.36 * var(--text-reading) - 10px); display: flex; align-items: center; height: 20px; }
  .reason .thread:not(:has(:global(.activity-kind))) .title-line { margin-right: calc(var(--touch-target) - 8px); }
  /* An Activity card: no button border, so the kind line, the place line and what is asked start on the card's
     12 px edge; the kind line ends before the menu, which shows at its end on every card and leaves the title the
     card's width. A 10 px step to the title: the menu's 32 px stay clear of it. */
  .reason .thread { border-inline-width: 0; }
  .reason .thread > :global(.activity-kind) { margin: 0 calc(var(--touch-target) - 8px) 6px 0; }
  .helper .who { color: var(--color-foreground); font-weight: 500; }
  .sep { flex: none; color: var(--color-subtle); }
  /* The label inside is trimmed to its capitals, so the clip gets the room of its descenders back without
     moving the line ("atlas-api" lost its p). */
  .meta .where { display: flex; align-items: center; gap: 8px; flex: 0 1 auto; min-width: 0; padding-block: 0.3em; margin-block: -0.3em; overflow: hidden; white-space: nowrap; }
  .meta .where > .ui-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .where > .branch { display: flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .where > .branch :global(svg) { flex: none; }
  .where > .branch > .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  /* The room the list row's place line takes in its button, and the line laid over it inside the button's 1 px border and padding. */
  .meta-room { visibility: hidden; }
  .list-meta { position: absolute; left: 13px; right: 13px; bottom: 10px; pointer-events: none; }
  /* "Offline" when nothing above says it: MachinePlace's state mark, alone. */
  .where > .away { flex: none; padding: 0 6px; border: 1px solid var(--color-edge); border-radius: var(--radius-sm); font-size: var(--text-xs); line-height: 1.5; }
  /* Activity's since when, last on the place line: the title keeps its line whole. */
  .meta .since { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  /* The title line's end: the mark, then the time, centred on the first line's capitals (the title's box is trimmed
     to them, .ui-label), whose middle sits 0.36 em down at the title's size. */
  .thread :global(.headline > :is(.when, .at)) { height: 22px; margin-top: calc(0.36 * var(--text-reading) - 11px); }
  .thread :global(.headline > .when) { font-size: var(--text-sm); }
  .thread :global(.headline > .when:not(.state)) { font-weight: 400; }
  .thread :global(.headline > .at) { line-height: 22px; font-size: var(--text-sm); }
  /* A row with no mark: its time drawn by the state itself, on the same line as a marked row's. */
  .thread :global(.headline > .when:not(.state)) { line-height: 22px; }
  /* A sub-agent's line: one line under the content; its thread holds the whole. */
  .why .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The pair follows what it answers, right-aligned on the row's edge as on the desktop: the title keeps the row's
     width up to its mark and time, which stand in one column down the page. */
  .verbs { padding: 0 12px 10px; margin-top: -2px; }
  /* The ring every row draws, inside the box: the list's edge would clip one outside it. */
  .thread:focus-visible { outline-offset: -2px; }
  .thread :global(.headline) { gap: 10px; align-items: flex-start; }
  .thread :global(.headline > :is(.tile, .bot)) { margin-top: calc(0.36 * var(--text-reading) - 8px); }
  /* A phone reads every title at full ink: the mark says which rows need the user. Two lines of it before the
     ellipsis in the lists; Activity's are whole, since the row is about them. */
  .thread :global(.headline .title) { color: var(--color-foreground); font-weight: 400; }
  /* Its machine out of reach: the muted title (ThreadHeadline.svelte), no fading of the row. */
  .thread :global(.headline.offline .title) { color: var(--color-muted-foreground); }
  /* A clamped title's second line keeps its untrimmed box: .ui-label's half-em under it showed the top of the third
     line, so only a descender's room is kept. */
  .thread :global(.headline .title) { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; padding-bottom: 0.25em; margin-bottom: -0.25em; }
  .reason .thread :global(.headline .title) { display: block; -webkit-line-clamp: none; line-clamp: none; overflow: visible; font-weight: var(--weight-title); }
  /* The place line under the title clears its last line's descenders by as much as the kind line stands above it. */
  .reason .thread :global(.lead) { row-gap: 10px; }
  .thread :global(.headline .pin) { display: none; }
  /* One status per row: a state outranks the unsent draft's mark, which the thread shows once open. */
  .thread.stated :global(.headline > .draft) { display: none; }
  /* The menu's trigger, out of sight until the keyboard reaches it; the popover hangs under the row's end. */
  .row-menu { position: absolute; top: 0; right: 4px; bottom: 0; display: flex; align-items: center; pointer-events: none; }
  .row-menu :global(.trigger) { opacity: 0; background: var(--row-background, var(--color-background)); }
  .row-menu :global(.trigger:focus-visible) { opacity: 1; pointer-events: auto; }
  /* Activity's cards show it on the kind line's end (the button's 10 px, then half its 16 px), a finger's width and
     32 px tall, its glyph's box on the card's 12 px edge, the contact cards' place (ContactInboxRows.svelte); with no kind line, on the title's first line. */
  .reason .row-menu { bottom: auto; top: 2px; height: 32px; right: calc(12px - (var(--touch-target) - 14px) / 2); pointer-events: auto; }
  .reason:not(:has(:global(.activity-kind))) .row-menu { top: calc(10px + 0.36 * var(--text-reading) - 16px); }
  .reason .row-menu :global(.trigger) { opacity: 1; min-width: var(--touch-target); height: 32px; min-height: 0; background: transparent; }
  /* The sheet lives in the top layer but inherits the hidden trigger's pointer rule. */
  .row-menu :global(.popover) { pointer-events: auto; }
</style>
