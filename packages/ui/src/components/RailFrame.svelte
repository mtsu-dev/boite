<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Store } from '../lib/store.svelte';
  import { clampSidebar, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '../lib/prefs';
  import { strings } from '../lib/strings';
  import { experimentOn } from '../lib/experiments.svelte';
  import { pinnedQuotas } from '../lib/pinned-quotas.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import ResizeHandle from './ResizeHandle.svelte';
  import QuotaLine from './QuotaLine.svelte';

  /**
   * The column right of the app rail, for the thread list and the Bots list
   * alike: one width the user drags, one fold from the title bar, the head on
   * top, an optional subhead that stays put (the Bots search) and the rows in
   * one scroll. On a desktop it reaches the window's top, its head level with
   * the main column's bar, and its foot holds the limits line, the same under
   * every list; the machines and Settings live on the app rail.
   *
   * `drawer` is the thread list's phone form, a sheet over the chat; the Agents
   * list is a whole screen on a phone and stays in the flow.
   */
  let {
    store,
    kind,
    label,
    testid,
    drawer = false,
    absent = false,
    scroller = $bindable(),
    onscroll,
    head,
    subhead,
    children
  }: {
    store: Store;
    kind: 'sidebar' | 'agents-rail';
    label?: string;
    testid?: string;
    drawer?: boolean;
    /** No column on a desktop: nothing to list yet (lib/list-absent.ts). */
    absent?: boolean;
    scroller?: HTMLDivElement;
    onscroll?: () => void;
    head: Snippet;
    /** What stays put between the head and the rows, like the Agents search. */
    subhead?: Snippet;
    children: Snippet;
  } = $props();

  let rail = $state<HTMLElement | undefined>(undefined);
  const phone = new MediaQuery('(max-width: 720px)');
  let dockVisible = $derived(phone.current ? kind === 'sidebar' && store.sidebarOpen : !store.sidebarCollapsed);
  let folded: boolean | undefined;
  /**
   * Whether this list was folded since it was drawn. Only then does its
   * arrival slide in from the window's edge: a list drawn by a page change
   * (Threads to Agents, back from Settings) or at boot replaces the one that
   * stood there, so it stands still and only its rows change.
   */
  let wasFolded = $state(untrack(() => store.sidebarCollapsed));
  let sliding: ReturnType<typeof setTimeout> | undefined;
  let marked: HTMLElement[] = [];

  function unmark(): void {
    clearTimeout(sliding);
    for (const element of marked) delete element.dataset.railSliding;
    marked = [];
  }

  /**
   * Marks the body row while the list folds or unfolds, so the chat card's own
   * left gap eases in step (app.css), and the main column's bar beside it,
   * whose left end follows; the boot and a page change move both at once. An attribute, since Svelte rewrites the row's class list. Before
   * the DOM update, so the mark and the fold reach the same style pass.
   */
  $effect.pre(() => {
    const now = store.sidebarCollapsed;
    const was = folded;
    folded = now;
    if (now) wasFolded = true;
    const row = untrack(() => rail)?.parentElement;
    if (was === undefined || was === now || !row) return;
    unmark();
    row.dataset.railSliding = '';
    const bar = row.parentElement?.querySelector<HTMLElement>(':scope > .titlebar');
    if (bar) bar.dataset.railSliding = now ? 'out' : 'in';
    marked = bar ? [row, bar] : [row];
    sliding = setTimeout(unmark, 600);
  });

  // Gone before the slide ends (Settings opened at once): the row's next gap
  // change, a page change, must not ease.
  $effect(() => unmark);

  let resizeFrom = 0;
  /** Rows scrolled under the head: it takes a hairline and the fade deepens, so no sliced row shows below it. */
  let scrolled = $state(false);

  /** At rest the foot never shows half a row: its fade ends at the top of the row the edge slices (lib/row-cut.ts). */
  let cut = $state(0);
  $effect(() => {
    const box = scroller;
    if (!box) return;
    let stop: (() => void) | undefined;
    let gone = false;
    void import('../lib/row-cut').then(({ watchRowCut }) => { if (!gone) stop = watchRowCut(box, value => { cut = value; }); });
    return () => { gone = true; stop?.(); };
  });
</script>

<aside
  bind:this={rail}
  class="rail {kind}"
  class:drawer
  class:open={drawer && store.sidebarOpen}
  class:collapsed={store.sidebarCollapsed}
  class:absent
  aria-hidden={absent ? 'true' : undefined}
  class:was-folded={wasFolded}
  style:--sidebar-width={`${store.sidebarWidth}px`}
  aria-label={label}
  data-testid={testid}
  data-quota-dock-target=""
>
  <div class="views" class:scrolled={scrolled && !subhead}>{@render head()}</div>
  {@render subhead?.()}
  <div class="scroll" class:scrolled data-project-list={kind === 'sidebar' ? '' : undefined} bind:this={scroller} style:--cut={cut ? `${cut}px` : undefined}
    onscroll={() => { scrolled = (scroller?.scrollTop ?? 0) > 0; onscroll?.(); }}>
    {@render children()}
  </div>
  {#if (store.page === 'chat' || store.page === 'agents') && dockVisible && experimentOn('pinned-quotas') && pinnedQuotas.current.pinned && pinnedQuotas.wantsDock(store)}
    <Deferred part={parts.PinnedQuota} quiet>{#snippet children(PinnedQuota)}<PinnedQuota {store} dock />{/snippet}</Deferred>
  {/if}
  <!-- A phone reaches the limits from its Settings tab. -->
  {#if !phone.current}<QuotaLine {store} />{/if}
  <div class="resize">
    <ResizeHandle
      orientation="vertical"
      edge="right"
      label={strings.sidebar.resize}
      testid={kind === 'sidebar' ? 'sidebar-resize' : 'agents-resize'}
      value={store.sidebarWidth}
      min={SIDEBAR_MIN}
      max={SIDEBAR_MAX}
      onstart={() => { resizeFrom = store.sidebarWidth; }}
      onmove={(delta) => (store.sidebarWidth = clampSidebar(resizeFrom + delta))}
      onend={() => store.setSidebarWidth(store.sidebarWidth)}
      onstep={(delta) => store.setSidebarWidth(store.sidebarWidth + delta)}
      onreset={() => store.setSidebarWidth(SIDEBAR_DEFAULT)}
    />
  </div>
</aside>

<style>
  /* Typed, so the foot's fade eases to a row's top when the list settles instead of jumping. */
  @property --cut { syntax: '<length>'; inherits: false; initial-value: 0px; }
  /* The container name `sidebar` is also read by Sidebar.svelte's narrow-column layout. */
  .rail {
    container: sidebar / inline-size;
    position: relative;
    width: var(--sidebar-width);
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .views { margin: 0 10px; border-bottom: 1px solid transparent; transition: border-color var(--motion-duration) var(--motion-curve); }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* No rule above or below the rows: they fade out under the head and the
       foot. The fade is exactly the padding, so at rest it covers nothing; a
       mask, not a scroll-driven animation, because tests and closing elements
       wait on every running animation and that one would never end. */
    /* Shallow at the foot, the shared edge (app.css `--scroll-edge`): the last row reads whole at the end, where the
       fade covers only the padding; at rest it ends on a row's top (`--cut`, set by the script). */
    --fade: var(--scroll-edge);
    /* Shorter on top: the head's tools sit right above, and a deeper fade
       there opened a wider gap under them than between them and the switch. */
    --fade-top: 3px;
    padding: var(--fade-top) 6px var(--fade);
    /* A row the keyboard reaches scrolls clear of both fades, never read through one. */
    scroll-padding-block: calc(var(--fade-top) + 4px) calc(var(--fade) + 4px);
    display: flex;
    flex-direction: column;
    --mask-top: var(--fade-top);
    /* Eased like the shared edge: the sliver at the very edge closes, the rest of the line stays legible. */
    mask-image: linear-gradient(to bottom, transparent, black var(--mask-top), black calc(100% - var(--fade) - var(--cut)), rgb(0 0 0 / 0.55) calc(100% - var(--fade) / 2 - var(--cut)), transparent calc(100% - var(--cut)));
    transition: --cut var(--motion-duration) var(--motion-curve);
  }
  /* Scrolled: the head reads as an opaque edge the rows pass under, so no sliced card title shows through the
     3 px fade; the top fade as deep as the foot's. */
  .scroll.scrolled { --mask-top: var(--fade); }
  /* The project list settles on a boundary (Sidebar.svelte names them), close by only, so a long fling still ends
     where it was thrown; a drag's own auto-scroll is never pulled back to one. */
  .scroll[data-project-list] { scroll-snap-type: y proximity; }
  :global(:is(html.thread-dragging, html.project-dragging)) .scroll { scroll-snap-type: none; }
  .scroll > :global(*) { flex-shrink: 0; }

  /* The edge that drags the width, centred in the frame gap (ResizeHandle). */
  .resize { display: contents; }
  @media (min-width: 721px) {
    /* Folding slides it out past the window's left edge and the chat card
       widens with it: a margin as wide as the list and its gap gives that room
       back, so the chat never jumps. App.svelte eases the card's own left gap
       in step. */
    /* Up to the window's top (App.svelte pulls it over the bar's band), its
       head in that band, level with the main column's title. */
    .rail { padding-top: 6px; }
    .views.scrolled { border-bottom-color: var(--color-border); }
    .rail {
      --slide-room: calc(var(--sidebar-width) + var(--frame-gap));
      /* One motion with the panel that comes in on the other side: the same duration and curve for the slide and the fade. */
      transition: margin-left var(--motion-duration) var(--motion-curve), opacity var(--motion-duration) var(--motion-curve), display var(--motion-duration) allow-discrete;
    }
    /* No room taken, no head, no foot: the main card keeps the one frame gap of the row; a body that folds the column
       itself (App.svelte's `sidebar-folded`) gives that gap as its padding, so then the column leaves the flow. */
    .rail.absent { width: 0; padding: 0; overflow: hidden; visibility: hidden; transition: none; }
    :global(.sidebar-folded) > .rail.absent { display: none; }
    .rail.collapsed {
      display: none;
      pointer-events: none;
      opacity: 0;
      margin-left: calc(-1 * var(--slide-room));
      transition: margin-left var(--motion-duration) var(--motion-curve), opacity var(--motion-duration) var(--motion-curve), display var(--motion-duration) allow-discrete;
    }
    /* Unfolding only (`wasFolded`): a list drawn open stands where it is. */
    @starting-style { .rail.was-folded:not(.collapsed) { opacity: 0; margin-left: calc(-1 * var(--slide-room)); } }
  }
  @media (max-width: 720px) {
    .rail.drawer {
      background: var(--color-surface);
      border-right: 1px solid var(--color-border);
      position: fixed;
      inset: var(--titlebar) auto 0 0;
      z-index: 30;
      width: min(340px, 90vw);
      visibility: hidden;
      pointer-events: none;
      opacity: 0;
      /* A drawer from the left edge, where its button is. */
      transform: translateX(calc(-100% - 12px));
      transition: opacity var(--dur-3) var(--ease-out-quint), transform var(--motion-duration) var(--motion-curve), visibility var(--motion-duration);
      box-shadow: var(--shadow-overlay);
    }
    .rail.drawer.open {
      visibility: visible;
      pointer-events: auto;
      opacity: 1;
      transform: none;
    }
    /* On a phone the list is the whole screen: no width to drag, and the tab bar
       below already leads to Settings. */
    .rail:not(.drawer) { width: auto; flex: 1; }
    .rail:not(.drawer) .views { margin: 0 12px; }
    .resize { display: none; }
  }
</style>
