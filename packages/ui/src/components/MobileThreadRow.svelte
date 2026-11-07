<script lang="ts">
  import { Archive, Ellipsis, GitBranch, Pin, PinOff } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { MenuItem } from '../lib/menu';
  import { strings } from '../lib/strings';
  import { closeSwipedRow, swipeRow } from '../lib/swipe-row';
  import { longPress } from '../lib/long-press';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';
  import Menu from './Menu.svelte';
  import PullRequestBadge from './PullRequestBadge.svelte';
  import ThreadHeadline from './ThreadHeadline.svelte';

  /**
   * A phone's thread row, the desktop row's grammar at a finger's size: the
   * title on one line, the state at its end, the pull request and its branch
   * under it only when there is one. `compact` is the flat lists' form
   * (Recent, Activity): the project's tile and one marker, no second line.
   * The row menu has no button of its own: a long press opens it, a slide
   * left shows pin and archive. Its trigger stays for the keyboard, drawn
   * only while focused.
   */
  let { machine, thread, project, now, items, compact = false, onopen, onaction }: {
    machine: Machine; thread: ThreadSummary; project: Project | undefined; now: number; items: MenuItem[]; compact?: boolean;
    onopen: () => void; onaction: (action: string) => void;
  } = $props();
  const owner = $derived(machine.store);
  const pr = trackThreadPullRequest(() => ({ owner, thread, hidden: compact }));
  const pullRequest = $derived(compact ? null : pr.value);
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

<div class="row" class:meta={pullRequest} data-testid="mobile-row" data-thread-id={thread.id} data-machine-id={machine.id}>
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
    <button class="ghost thread" class:offline={owner.connection !== 'ready'} data-testid="mobile-thread-{thread.id}" title={thread.title} onclick={onopen} use:longPress>
      <ThreadHeadline {owner} {thread} {now} tile={compact ? project : undefined} mark={compact} />
    </button>
    {#if pullRequest}
      <span class="metadata"><PullRequestBadge {pullRequest} />{#if thread.branch}<span class="branch" title={thread.branch}><GitBranch size={12} /><span class="ui-label">{thread.branch}</span></span>{/if}</span>
    {/if}
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
  /* One line of 44 px, a finger's height; the pull request line sits in the padding under it, so the whole row stays one target. */
  .thread { display: block; width: 100%; min-height: var(--touch-target); height: auto; padding: 12px 12px; border-radius: 0; text-align: left; font-size: var(--text-reading); color: var(--color-foreground); }
  .meta .thread { padding-bottom: 32px; }
  .thread :global(.headline) { gap: 10px; }
  /* A phone reads every title at full ink: the state at the end says which rows need the user. */
  .thread :global(.headline .title) { color: var(--color-foreground); font-weight: 400; }
  .thread :global(.headline .when) { font-size: var(--text-sm); }
  .thread.offline { opacity: 0.55; }
  /* Under the title, from its edge: the pull request, then its branch in mono. */
  .metadata { position: absolute; left: 36px; right: 12px; bottom: 11px; display: flex; align-items: center; gap: 10px; min-width: 0; height: 16px; pointer-events: none; font-size: var(--text-xs); color: var(--color-subtle); }
  .metadata :global(.pr-link) { position: relative; color: var(--color-muted-foreground); text-decoration: none; font-size: inherit; }
  /* The badge stays small; a finger gets the row's bottom 44px under it. */
  .metadata :global(.pr-link)::after { content: ''; position: absolute; inset: -11px -6px; }
  .metadata :global(.pr-link.merged svg) { color: var(--color-success); }
  .metadata :global(.pr-link.closed svg) { color: var(--color-danger); }
  .branch { display: flex; align-items: center; gap: 4px; min-width: 0; font-family: var(--font-mono); font-size: 11.5px; }
  .branch :global(svg) { flex: none; }
  .branch .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The menu's trigger, out of sight until the keyboard reaches it; the popover hangs under the row's end. */
  .row-menu { position: absolute; top: 0; right: 4px; bottom: 0; display: flex; align-items: center; pointer-events: none; }
  .row-menu :global(.trigger) { opacity: 0; background: var(--row-background, var(--color-background)); }
  .row-menu :global(.trigger:focus-visible) { opacity: 1; pointer-events: auto; }
  /* The sheet lives in the top layer but inherits the hidden trigger's pointer rule. */
  .row-menu :global(.popover) { pointer-events: auto; }
</style>
