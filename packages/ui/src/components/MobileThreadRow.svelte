<script lang="ts">
  import { rowAsks, stateForm } from '../lib/status-order';
  import { Archive, Ellipsis, Pin, PinOff } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { MenuItem } from '../lib/menu';
  import { strings } from '../lib/strings';
  import { closeSwipedRow, swipeRow } from '../lib/swipe-row';
  import { longPress } from '../lib/long-press';
  import Menu from './Menu.svelte';
  import ThreadHeadline from './ThreadHeadline.svelte';
  import { threadState } from '../lib/thread-state';
  import { feedOperation, type FeedVerb } from '../lib/activity-feed';
  import { collapseRow } from '../lib/row-collapse';

  /**
   * A phone's thread row, the desktop row's grammar at a finger's size (ThreadHeadline.svelte): the title gets the
   * width, two lines of it before any ellipsis, its mark and its time at the end of its first line, then where it
   * lives under it when the list says so. The pull request waits in the thread, the pin under the slide. `compact` is
   * the flat lists' form (Recent, Activity): the project's tile first. Activity (the phone's screen) is the whole
   * title on the row's width with `reason`, what the thread wants, one line under it; a command it asks to run
   * reads in full in a mono block under them. A sub-agent with the same ask is a line of its own (`helpers`), one
   * event per row, as on the desktop; `verb` names what a Needs you row asks, a button after the content at its text
   * edge (the desktop keeps it at the end of the title's line), Review when the command is too long to read here.
   * `onverb` opens what the verb is for, the row itself unless a sub-agent asks.
   * The row menu has no button of its own: a long press opens it, a slide
   * left shows pin and archive. Its trigger stays for the keyboard, drawn
   * only while focused.
   */
  let { machine, thread, project, now, items, compact = false, reason, at, helpers = [], verb = null, where, onopen, onverb = onopen, onaction }: {
    machine: Machine; thread: ThreadSummary; project: Project | undefined; now: number; items: MenuItem[]; compact?: boolean;
    reason?: string; at?: number; verb?: FeedVerb | null;
    /** Activity: the sub-agents of this thread that ask, each with what it asks. */
    helpers?: { thread: ThreadSummary; reason?: string }[];
    /** Recent: where the row lives, first on its line under the title (lib/row-place.ts). */
    where?: string;
    onopen: () => void; onverb?: (event?: MouseEvent) => void; onaction: (action: string) => void;
  } = $props();
  const owner = $derived(machine.store);
  const pin = $derived(items.find(item => item.id === 'pin'));
  const archive = $derived(items.find(item => item.id === 'archive'));
  const kind = $derived(thread.archived ? null : threadState(thread, rowAsks(owner, thread.id)));
  /** A dot when the user must act or a turn failed, the arc for work, the time alone otherwise (ThreadState draws it then). */
  const form = $derived(stateForm(kind));
  const away = $derived(owner.connection !== 'ready');
  /** Activity: the whole command the thread asks to run, read before Allow. */
  const operation = $derived(reason === undefined ? null : feedOperation(owner, thread.id));
  const long = $derived(!!operation && (operation.split('\n').length > 6 || operation.length > 480));
  const action = $derived<FeedVerb | null>(verb === 'allow' && long ? 'review' : verb);
  let menu = $state<HTMLElement>();
  /** A long press, or Android's own, opens the row's menu where its hidden trigger stands. */
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    if (menu?.contains(event.target as Node)) return;
    menu?.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')?.click();
  }
  function swiped(action: string) { closeSwipedRow(); onaction(action); }
</script>

{#snippet why()}<span class="why" data-testid="mobile-row-reason"><span class="text">{reason}</span></span>{/snippet}

<div class="row" out:collapseRow|global={() => !owner.threads.some(entry => entry.id === thread.id)} class:reason={reason !== undefined} class:tiled={compact && project !== undefined} data-testid="mobile-row" data-thread-id={thread.id} data-machine-id={machine.id}>
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
      <!-- One line for every list (ThreadHeadline.svelte): the title, then the mark in the row's one slot and the time
           after it; in Activity what is asked is one line under the title. The project's header says how many need
           the user, so no row repeats the word. -->
      <ThreadHeadline {owner} {thread} {now} tile={compact ? project : undefined} mark ask={reason === undefined ? undefined : why}
        at={reason !== undefined ? at : form !== null ? thread.lastUserMessageAt ?? thread.createdAt : undefined} />
      {#if reason !== undefined}
        {#if operation}<code class="operation" class:long data-testid="thread-operation">{operation}</code>{/if}
        {#each helpers as helper (helper.thread.id)}
          <span class="why helper" data-testid="thread-helper" data-thread-id={helper.thread.id}><span class="text"><span class="who">{helper.thread.title}</span> <span class="sep" aria-hidden="true">·</span> {helper.reason}</span></span>
        {/each}
      {:else if where}
        <span class="meta" data-testid="mobile-row-meta"><span class="where" data-testid="mobile-row-where">{where}</span></span>
      {/if}
    </button>
    {#if action}<button type="button" class="small verb" data-testid="thread-verb" data-verb={action} onclick={onverb}>{strings.mobile.feed.verb[action]}</button>{/if}
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
  .tiled :is(.meta, .helper, .operation) { margin-left: 26px; }
  .helper .who { color: var(--color-foreground); font-weight: 500; }
  .sep { flex: none; color: var(--color-subtle); }
  .meta .where { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The title line's end: the mark, then the time, centred on the first line's capitals (the title's box is trimmed
     to them, .ui-label), whose middle sits 0.36 em down at the title's size. */
  .thread :global(.headline > :is(.when, .at)) { height: 22px; margin-top: calc(0.36 * var(--text-reading) - 11px); }
  .thread :global(.headline > .when) { font-size: var(--text-sm); }
  .thread :global(.headline > .when:not(.state)) { font-weight: 400; }
  .thread :global(.headline > .at) { line-height: 22px; font-size: var(--text-sm); }
  /* Activity: what is asked, one line under the title; the row's tooltip and the thread hold the whole. */
  .why .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The command as it will run: mono, wrapped, every line; too long, its first lines and Review. */
  .operation { display: block; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-code-background); color: var(--color-code-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .operation.long { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; line-clamp: 6; overflow: hidden; }
  /* The verb follows what it answers, at the text's edge under it, one width on every row and a finger's height: the
     title keeps the row's width up to its mark and time, which stand in one column down the page. */
  .verb { display: flex; justify-content: center; width: var(--verb-width); min-height: var(--touch-target); margin: -4px 12px 10px; font-size: var(--text-sm); font-weight: 600; }
  .tiled .verb { margin-left: 38px; }
  .reason { --verb-width: 88px; }
  /* The ring every row draws, inside the box: the list's edge would clip one outside it. */
  .thread:focus-visible { outline-offset: -2px; }
  .thread :global(.headline) { gap: 10px; align-items: flex-start; }
  .thread :global(.headline > .tile) { margin-top: calc(0.36 * var(--text-reading) - 8px); }
  /* A phone reads every title at full ink: the mark says which rows need the user. Two lines of it before the
     ellipsis in the lists; Activity's are whole, since the row is about them. */
  .thread :global(.headline .title) { color: var(--color-foreground); font-weight: 400; }
  /* A clamped title's second line keeps its untrimmed box: .ui-label's half-em under it showed the top of the third
     line, so only a descender's room is kept. */
  .thread :global(.headline .title) { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; padding-bottom: 0.25em; margin-bottom: -0.25em; }
  .reason .thread :global(.headline .title) { display: block; -webkit-line-clamp: none; line-clamp: none; overflow: visible; }
  /* What is asked, under the title, clears its descenders. */
  .reason .thread :global(.lead) { row-gap: 6px; }
  /* Its machine dropped: dimmed, title and mark alike; its card header says "offline". */
  .thread.offline { opacity: 0.6; }
  .thread :global(.headline .pin) { display: none; }
  /* One status per row: a state outranks the unsent draft's mark, which the thread shows once open. */
  .thread.stated :global(.headline > .draft) { display: none; }
  /* The menu's trigger, out of sight until the keyboard reaches it; the popover hangs under the row's end. */
  .row-menu { position: absolute; top: 0; right: 4px; bottom: 0; display: flex; align-items: center; pointer-events: none; }
  .row-menu :global(.trigger) { opacity: 0; background: var(--row-background, var(--color-background)); }
  .row-menu :global(.trigger:focus-visible) { opacity: 1; pointer-events: auto; }
  /* The sheet lives in the top layer but inherits the hidden trigger's pointer rule. */
  .row-menu :global(.popover) { pointer-events: auto; }
</style>
