<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { AnchoredPopover } from '../lib/anchored-popover.svelte';
  import { floating } from '../lib/floating';
  import { dangerLast, menuRows, moveMenuFocus, type MenuItem } from '../lib/menu';
  import MenuRows from './MenuRows.svelte';

  let {
    items = [],
    onpick,
    align = 'start',
    placement = 'top',
    variant = 'chip',
    switches = false,
    disabled = false,
    label,
    titled = true,
    heading,
    cap,
    panel,
    panelLabel,
    popupTestid,
    beforeopen,
    oncontextmenu,
    testid,
    onclose,
    children
  }: {
    items?: MenuItem[];
    onpick?: (id: string) => void;
    align?: 'start' | 'end';
    /** Where the popover sits: above the trigger, the composer's way, or under it. */
    placement?: 'top' | 'bottom';
    /** `text` reads as the sentence it sits in: no fill, no border, the parent's type. `icon` is app.css's icon button; `button` a small outline button, as a notice's action. */
    variant?: 'chip' | 'ghost' | 'text' | 'icon' | 'button';
    /** Show persistent toggles with switches and keep the menu open while adjusting them. */
    switches?: boolean;
    disabled?: boolean;
    label: string;
    /** False where the caller draws its own name card beside the trigger (the app rail): no native tooltip on top of it. */
    titled?: boolean;
    /** What the menu acts on, a thread or a project: a phone sheet's title. The label stands in. */
    heading?: string;
    /** The list's tallest desktop height in px, where the room exists for a long list to show whole (lib/floating.ts). */
    cap?: number;
    /** The rail's side-aligned dialog can render the menu items in its body. */
    panel?: Snippet<[(restoreFocus?: boolean) => void, Snippet, boolean]>;
    panelLabel?: string;
    popupTestid?: string;
    /** Return a callback for an alternate action that should only run while opening is still current. */
    beforeopen?: () => boolean | (() => void) | Promise<boolean | (() => void)>;
    oncontextmenu?: (event: MouseEvent) => void;
    testid?: string;
    /** The list closed: a caller that swapped in a submenu's rows puts its first list back. */
    onclose?: () => void;
    children: Snippet;
  } = $props();
  const surfaceId = $props.id();

  const popover = new AnchoredPopover(() => root, () => trigger);
  /** The rows a row's own `items` opened in place, until its way back or the close. */
  let nested = $state<MenuItem[] | null>(null);
  let shownItems = $derived(nested ?? items);
  let ordered = $derived(dangerLast(shownItems));
  let root = $state<HTMLDivElement | undefined>(undefined);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  let surface = $state<HTMLDivElement>();
  let request = 0;
  let opening = false;
  /** The list opened as a phone sheet (lib/floating.ts marks it), which shows a title. */
  let sheet = $state(false);

  /** The list was open since its last close: what puts the first level back waits for the exit to end. */
  let wasOpen = false;
  /** The keyboard lands on the first item the moment the list is there. A phone
      sheet holds the focus on itself instead: no row, Delete included, opens lit.
      The way out plays with the rows it closed on; only once gone does the list
      go back to its first level and tell the caller. */
  $effect(() => {
    if (!popover.open) {
      if (popover.shown || !wasOpen) return;
      wasOpen = false; sheet = false; nested = null; onclose?.();
      return;
    }
    wasOpen = true;
    void popover.focusOnOpen(() => surface, (atSheet) => {
      sheet = atSheet;
      return panel ? surface : menuRows(root)[0];
    });
  });

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    if (disabled) return;
    if (popover.open || opening) close();
    else void show();
  }

  async function show() {
    if (!beforeopen) { popover.show(); return; }
    const current = ++request;
    opening = true;
    try {
      const result = await beforeopen();
      if (current !== request || !trigger?.isConnected || disabled) return;
      if (typeof result === 'function') result();
      else if (result) popover.show();
    } finally {
      if (current === request) opening = false;
    }
  }

  function close(restoreFocus = true) {
    request += 1;
    opening = false;
    popover.close(restoreFocus);
  }

  function pick(item: MenuItem) {
    if (disabled || item.disabled) return;
    // The picked row leaves with the list: the keyboard goes back to the trigger first, so a dialog the pick opens
    // gives it back there, as Escape does.
    // A submenu or its way back swaps the rows in place: the list stays, the keys land on its first row.
    if (item.submenu || item.back) {
      if (item.items) nested = item.items;
      else if (item.back && nested) nested = null;
      else onpick?.(item.id);
      void tick().then(() => menuRows(root)[0]?.focus({ preventScroll: true }));
      return;
    }
    if (!switches || item.checked === undefined) close();
    onpick?.(item.id);
  }

  /** A press, not a click: another menu's trigger stops its click from bubbling here. */
  function onWindowPointerdown(event: PointerEvent) {
    if (!popover.open && !opening) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    close(false);
  }

  function onkeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Escape') {
      if (!popover.open && !opening) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!popover.open) {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (!opening) void show();
      return;
    }
    const list = menuRows(root);
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const focused = shownItems.find((item) => item.id === active?.dataset['value']);
    if (event.key === 'Enter' || (event.key === 'ArrowRight' && focused?.submenu)) {
      if (!focused || !active || !list.includes(active)) return;
      event.preventDefault();
      pick(focused);
      return;
    }
    if (event.key === 'ArrowLeft') {
      const back = shownItems.find((item) => item.back);
      if (back) { event.preventDefault(); pick(back); }
      return;
    }
    moveMenuFocus(event, list);
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="menu" bind:this={root}>
  <button
    type="button"
    class="trigger"
    class:small={variant === 'ghost' || variant === 'button'}
    class:ui-chip={variant === 'chip'}
    class:ghost={variant === 'ghost'}
    class:icon={variant === 'ghost'}
    class:text={variant === 'text'}
    class:icon-button={variant === 'icon'}
    aria-haspopup={panel ? 'dialog' : 'menu'}
    aria-expanded={popover.open}
    aria-controls={popover.open ? surfaceId : undefined}
    aria-label={label}
    title={titled ? label : undefined}
    data-testid={testid}
    bind:this={trigger}
    {disabled}
    onclick={toggle}
    {oncontextmenu}
    {onkeydown}
  >
    {@render children()}
  </button>

  {#if popover.shown}
    <div
      id={surfaceId}
      class="popover"
      class:switches
      class:panel={panel !== undefined}
      class:end={align === 'end'}
      class:below={placement === 'bottom'}
      class:closing={popover.closing}
      role={panel ? 'dialog' : 'menu'}
      aria-label={panelLabel}
      tabindex="-1"
      bind:this={surface}
      {onkeydown}
      use:popover.attach
      use:floating={{ anchor: () => trigger ?? null, placement, align: panel ? 'end' : align,
        side: panel ? 'right' : undefined, sideAnchor: panel ? () => trigger?.closest<HTMLElement>('.app-rail') ?? null : undefined,
        cap: panel ? 460 : cap, dismiss: () => close(false) }}
      onanimationend={popover.end}
      data-testid={popupTestid ?? (testid ? `${testid}-menu` : undefined)}
    >
      {#snippet itemRows()}
        <MenuRows {ordered} {pick} {sheet} {switches} />
      {/snippet}
      {#if panel}
        {@render panel(close, itemRows, popover.open)}
      {:else}
        <!-- A second level's back row names it: no sheet title over it. -->
        {#if switches && !sheet}<div class="heading ui-label" aria-hidden="true">{label}</div>
        {:else if sheet && !ordered[0]?.back}<div class="sheet-title" aria-hidden="true">{heading ?? label}</div>{/if}
        {@render itemRows()}
      {/if}
    </div>
  {/if}
</div>

<style>
  .popover:global([data-mobile-sheet='true']) { padding-inline: var(--space-2); }
  .popover:has(> :global(.item > .hint)) { gap: var(--space-1); }
  /* The list holds the focus only to keep the keys; its rows wear the ring. */
  .popover:focus { outline: none; }
  .sheet-title { padding: 0 var(--space-4) var(--space-3); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 600; line-height: 1.35; text-align: center; overflow-wrap: anywhere; }
  /* One head form for every overlay: the section's (above), the ContextMenu's and the palette's groups. */
  .heading { padding: var(--space-2) var(--overlay-row-pad) var(--space-1); color: var(--color-subtle); font-size: var(--text-xs); font-weight: 600; }
  .popover.switches { width: min(300px, calc(100vw - 24px)); padding: var(--space-2); }
  .menu {
    position: relative;
    display: inline-flex;
  }

  /* The trigger is a button of the family (app.css): a small secondary, a ghost
     icon, a text button or an icon button; an open menu holds its hover fill. */
  .trigger[aria-expanded='true']:not(.icon-button) {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  .popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 200px;
    max-width: 320px;
    padding: var(--overlay-pad);
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    /* The list reads at the body size wherever the trigger sits, a heading
       included: it never inherits the type of the sentence around it. */
    font-size: var(--text-base);
    font-weight: 400;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 1px;
    animation: pop var(--motion-duration) var(--motion-curve);
    transform-origin: bottom left;
  }

  /* A capped list scrolls: a row that shrank instead let its hint run over the next one. */
  .popover > * { flex: none; }
  .popover.panel { width: min(360px, calc(100vw - 24px)); max-width: none; padding: 0; color: var(--color-foreground); overflow: hidden; transform-origin: bottom left; }
  .popover.panel > :global(.popover-frame) { flex: 1; }

  .popover.closing {
    animation: pop-out var(--motion-duration) var(--motion-curve);
    pointer-events: none;
  }

  .popover.end {
    left: auto;
    right: 0;
    transform-origin: bottom right;
  }

  .popover.below {
    bottom: auto;
    top: calc(100% + 6px);
    transform-origin: top left;
  }

  .popover.below.end {
    transform-origin: top right;
  }

</style>
