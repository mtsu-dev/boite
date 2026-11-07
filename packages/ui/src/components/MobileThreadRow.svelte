<script lang="ts">
  import { Archive, Ellipsis, Pin, PinOff } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { MenuItem } from '../lib/menu';
  import { strings } from '../lib/strings';
  import { ago, exactTime } from '../lib/format';
  import { closeSwipedRow, swipeRow } from '../lib/swipe-row';
  import { longPress } from '../lib/long-press';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import Menu from './Menu.svelte';
  import ThreadHeadline from './ThreadHeadline.svelte';

  /**
   * A phone's thread row, the desktop row's grammar at a finger's size: the
   * title on one line, the pull request and the state at its end, the branch
   * in the tooltip. `compact` is the flat lists' form (Recent, Activity): the
   * project's tile first. Activity adds `reason`, what the thread wants and
   * when, under the title, and `nested` steps a sub-agent in under its parent.
   * The row menu has no button of its own: a long press opens it, a slide
   * left shows pin and archive. Its trigger stays for the keyboard, drawn
   * only while focused.
   */
  let { machine, thread, project, now, items, compact = false, reason, at, nested = false, onopen, onaction }: {
    machine: Machine; thread: ThreadSummary; project: Project | undefined; now: number; items: MenuItem[]; compact?: boolean;
    reason?: string; at?: number; nested?: boolean; onopen: () => void; onaction: (action: string) => void;
  } = $props();
  const owner = $derived(machine.store);
  // Activity says why the thread is there; its pull request waits in the thread.
  const pr = trackThreadPullRequest(() => ({ owner, thread, hidden: reason !== undefined }));
  const pullRequest = $derived(reason !== undefined ? null : pr.value);
  const pin = $derived(items.find(item => item.id === 'pin'));
  const archive = $derived(items.find(item => item.id === 'archive'));
  let menu = $state<HTMLElement>();
  /** A long press, or Android's own, opens the row's menu where its hidden trigger stands. */
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    if (menu?.contains(event.target as Node)) return;
    menu?.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')?.click();
  }
  function swiped(action: string) { closeSwipedRow(); onaction(action); }
</script>

<div class="row" class:reason={reason !== undefined} class:nested class:tiled={compact && !nested && project !== undefined} data-testid="mobile-row" data-thread-id={thread.id} data-machine-id={machine.id}>
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
    <button class="ghost thread" class:offline={owner.connection !== 'ready'} data-testid="mobile-thread-{thread.id}" title={thread.branch ? `${thread.title}\n${thread.branch}` : thread.title} onclick={onopen} use:longPress>
      <ThreadHeadline {owner} {thread} {now} tile={compact && !nested ? project : undefined} {pullRequest} />
      {#if reason !== undefined}<span class="why" data-testid="mobile-row-reason"><span class="text ui-label">{reason}</span>{#if at !== undefined}<time class="ui-label" title={exactTime(at)}>{ago(at, now)}</time>{/if}</span>{/if}
    </button>
    <span class="row-menu" bind:this={menu}><Menu {items} onpick={onaction} label={strings.sidebar.threadMenu} placement="bottom" variant="ghost" testid="mobile-thread-menu-{thread.id}"><Ellipsis size={18} /></Menu></span>
  </div>
</div>

<style>
  .row { position: relative; display: block; overflow: hidden; }
  /* What a slide uncovers: pin, then archive at the edge, as mail apps lay them. */
  .swipe-actions { position: absolute; inset: 0 0 0 auto; display: flex; }
  .swipe { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 76px; height: 100%; padding: 0 6px; border: 0; border-radius: 0;
    font-size: 11px; font-weight: 500; background: var(--color-surface-3); color: var(--color-foreground); }
  .swipe .ui-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { position: relative; touch-action: pan-y; transform: translateX(var(--swipe, 0px)); transition: transform var(--dur-3) var(--ease-out-quint); background: var(--row-background, var(--color-background)); }
  .body:global(.dragging) { transition: none; }
  /* One line of 44 px, a finger's height. */
  .thread { display: block; width: 100%; min-height: var(--touch-target); height: auto; padding: 12px 12px; border-radius: 0; text-align: left; font-size: var(--text-reading); color: var(--color-foreground); }
  /* Activity's reason under the title, from the title's edge; the reason gives way, its time does not. */
  .why { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--text-sm); line-height: 1.4; color: var(--color-muted-foreground); }
  .tiled .why { margin-left: 26px; }
  .why .text { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The time under the state, at the row's end. */
  .why time { flex: none; margin-left: auto; font-size: inherit; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .reason .thread { padding: 10px 12px; }
  /* A sub-agent under its parent: stepped in, a hairline where the tile was. */
  .nested .thread { padding-left: 40px; }
  .nested .body::before { content: ''; position: absolute; left: 20px; top: 0; bottom: 0; width: 1px; background: var(--color-border); }
  .thread :global(.headline) { gap: 10px; }
  /* A phone reads every title at full ink: the state at the end says which rows need the user. */
  .thread :global(.headline .title) { color: var(--color-foreground); font-weight: 400; }
  .thread :global(.headline .when) { font-size: var(--text-sm); }
  .thread.offline { opacity: 0.55; }
  .thread :global(.headline .pr) { font-size: var(--text-sm); }
  /* At 360 px a plain time goes before the title is cut; a state keeps its mark and word. */
  @media (max-width: 380px) {
    .thread :global(.headline .when:not(.state)), .thread :global(.headline .when .elapsed) { display: none; }
  }
  /* The menu's trigger, out of sight until the keyboard reaches it; the popover hangs under the row's end. */
  .row-menu { position: absolute; top: 0; right: 4px; bottom: 0; display: flex; align-items: center; pointer-events: none; }
  .row-menu :global(.trigger) { opacity: 0; background: var(--row-background, var(--color-background)); }
  .row-menu :global(.trigger:focus-visible) { opacity: 1; pointer-events: auto; }
  /* The sheet lives in the top layer but inherits the hidden trigger's pointer rule. */
  .row-menu :global(.popover) { pointer-events: auto; }
</style>
