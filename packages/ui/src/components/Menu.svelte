<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { Check, ChevronRight, Settings } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { dangerLast, type MenuItem } from '../lib/menu';
  import ProjectTile from './ProjectTile.svelte';
  import BackRow from './BackRow.svelte';

  let {
    items,
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
    testid,
    onclose,
    children
  }: {
    items: MenuItem[];
    onpick: (id: string) => void;
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
    testid?: string;
    /** The list closed: a caller that swapped in a submenu's rows puts its first list back. */
    onclose?: () => void;
    children: Snippet;
  } = $props();

  const popover = new Closing();
  /** The rows a row's own `items` opened in place, until its way back or the close. */
  let nested = $state<MenuItem[] | null>(null);
  let shownItems = $derived(nested ?? items);
  let ordered = $derived(dangerLast(shownItems));
  let root = $state<HTMLDivElement | undefined>(undefined);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
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
    void tick().then(() => {
      const list = root?.querySelector<HTMLElement>('[role=menu]');
      sheet = !!list?.dataset['mobileSheet'];
      if (sheet) list?.focus({ preventScroll: true });
      else rows()[0]?.focus({ preventScroll: true });
    });
  });

  function rows(): HTMLElement[] {
    return root ? Array.from(root.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)')) : [];
  }

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    if (disabled) return;
    popover.toggle();
  }

  function pick(item: MenuItem) {
    if (disabled || item.disabled) return;
    // The picked row leaves with the list: the keyboard goes back to the trigger first, so a dialog the pick opens
    // gives it back there, as Escape does.
    // A submenu or its way back swaps the rows in place: the list stays, the keys land on its first row.
    if (item.submenu || item.back) {
      if (item.items) nested = item.items;
      else if (item.back && nested) nested = null;
      else onpick(item.id);
      void tick().then(() => rows()[0]?.focus({ preventScroll: true }));
      return;
    }
    if (!switches || item.checked === undefined) { popover.hide(); trigger?.focus({ preventScroll: true }); }
    onpick(item.id);
  }

  /** A press, not a click: another menu's trigger stops its click from bubbling here. */
  function onWindowPointerdown(event: PointerEvent) {
    if (!popover.open) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    popover.hide();
  }

  function onkeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Escape') {
      if (!popover.open) return;
      event.stopPropagation();
      popover.hide();
      trigger?.focus({ preventScroll: true });
      return;
    }
    if (!popover.open) {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      popover.show();
      return;
    }
    const list = rows();
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? list.indexOf(active) : -1;
    const focused = shownItems.find((item) => item.id === active?.dataset['value']);
    if (event.key === 'Enter' || (event.key === 'ArrowRight' && focused?.submenu)) {
      if (index < 0) return;
      event.preventDefault();
      if (focused) pick(focused);
      return;
    }
    if (event.key === 'ArrowLeft') {
      const back = shownItems.find((item) => item.back);
      if (back) { event.preventDefault(); pick(back); }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    let next = 0;
    if (event.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (event.key === 'End') next = list.length - 1;
    list[next]?.focus({ preventScroll: true });
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
    aria-haspopup="menu"
    aria-expanded={popover.open}
    aria-label={label}
    title={titled ? label : undefined}
    data-testid={testid}
    bind:this={trigger}
    {disabled}
    onclick={toggle}
    {onkeydown}
  >
    {@render children()}
  </button>

  {#if popover.shown}
    <div
      class="popover"
      class:switches
      class:end={align === 'end'}
      class:below={placement === 'bottom'}
      class:closing={popover.closing}
      role="menu"
      tabindex="-1"
      {onkeydown}
      use:popover.attach
      use:floating={{ anchor: () => trigger ?? null, placement, align, cap, dismiss: () => popover.hide() }}
      onanimationend={popover.end}
      data-testid={testid ? `${testid}-menu` : undefined}
    >
      <!-- A phone sheet titles every menu the same way, switches included. -->
      {#if switches && !sheet}<div class="heading ui-label" aria-hidden="true">{label}</div>
      <!-- A second level's back row names it: no sheet title over it. -->
      {:else if sheet && !ordered[0]?.back}<div class="sheet-title" aria-hidden="true">{heading ?? label}</div>{/if}
      {#each ordered as item (item.id)}
        {#if item.separator && item.label}
          <!-- A labelled rule opens a section: its words, no line. -->
          <div class="section ui-label" role="presentation">{item.label}</div>
        {:else if item.separator}
          <div class="separator" role="separator"></div>
        {:else if item.back}
          <!-- One way back for every second level: it names the level and draws its own rule. -->
          <BackRow label={item.label} title={item.title} disabled={item.disabled} data-value={item.id} data-testid={item.testid} onclick={() => pick(item)} />
        {:else}
        <button
          type="button"
          class="item"
          class:active={item.active}
          class:danger={item.danger}
          class:checkable={item.checked !== undefined || item.active !== undefined}
          class:inline-hint={!switches && !!item.status && !!item.hint}
          class:radio={item.radio}
          class:submenu={item.submenu}
          class:glyphed={!switches && !!item.glyph}
          class:iconed={switches && !!(item.icon || item.glyph)}
          class:clip={item.clip}
          role={item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          disabled={item.disabled}
          data-row
          data-value={item.id}
          data-testid={item.testid}
          title={item.title}
          onclick={() => pick(item)}
        >
          <span class="label">
            {#if item.icon === 'settings'}<Settings size={14} strokeWidth={1.75} />{/if}
            {#if item.projectTile}<ProjectTile project={item.projectTile.project} store={item.projectTile.store} size={18} />{/if}
            {#if item.glyph}<span class="glyph" class:live={item.live} aria-hidden="true"><item.glyph size={16} strokeWidth={1.75} /></span>{/if}
            {#if item.status}<span class="status-dot" data-tone={item.status.tone} role="img" aria-label={item.status.label} title={item.status.label}></span>{/if}
            <span class="ui-label">{item.label}</span>
            {#if item.submenu}<span class="more" aria-hidden="true"><ChevronRight size={14} strokeWidth={1.75} /></span>{/if}
          </span>
          <!-- A submenu row's chevron stands for the context menu's '›' hint: one mark, not two. -->
          {#if item.hint && !item.submenu}
            <span class="hint ui-label">{item.hint}</span>
          {/if}
          {#if switches && item.checked !== undefined && !item.radio}
            <span class="switch" class:on={item.checked} aria-hidden="true"></span>
          {:else if item.checked || item.active}<span class="check"><Check size={14} aria-hidden="true" /></span>{/if}
        </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .separator { height: 1px; background: var(--color-border); margin: var(--space-1) var(--overlay-row-pad); }
  /* A section title is read, never tapped: its trimmed label box (`.ui-label`) reaches over the row above, which keeps the tap. */
  .section { padding: var(--space-3) var(--overlay-row-pad) var(--space-2); font-size: var(--text-meta); font-weight: 600; color: var(--color-subtle); pointer-events: none; }
  .section:first-child, .sheet-title + .section { padding-top: var(--space-1); }
  /* A sheet's rows are taller, so its section labels take more air above and keep a clear gap to their first row. */
  /* One sheet inset (ContextMenu.svelte too): rows, rules and section titles start on one line. */
  .popover:global([data-mobile-sheet='true']) { padding-inline: var(--space-2); }
  .popover:global([data-mobile-sheet='true']) .section { padding: var(--space-4) var(--overlay-row-pad) var(--space-2); }
  .popover:global([data-mobile-sheet='true']) .section:first-child,
  .popover:global([data-mobile-sheet='true']) .sheet-title + .section { padding-top: 0; }
  /* A rule only ever separates: one left first or last by a hidden item draws nothing. */
  /* A back row draws its own rule (BackRow.svelte): a separator under it would be a second one. */
  .separator:first-child, .sheet-title + .separator, .heading + .separator, .separator:last-child, .separator + .separator, .popover :global(.back-rule + .separator) { display: none; }
  /* The list holds the focus only to keep the keys; its rows wear the ring. */
  .popover:focus { outline: none; }
  .sheet-title { padding: 0 var(--space-4) var(--space-3); color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 600; line-height: 1.35; text-align: center; overflow-wrap: anywhere; }
  .label { display: flex; align-items: center; gap: var(--space-2); }
  .glyph { display: inline-flex; flex: 0 0 16px; color: var(--color-muted-foreground); margin-right: 2px; }
  .glyph.live { color: var(--color-live); }
  /* A hint under a row with a glyph starts under its words, not under the glyph: the line reads as the label's. */
  .item.glyphed:not(.inline-hint) > .hint { padding-left: calc(18px + var(--space-2)); }
  .item.danger .glyph { color: inherit; }
  /* The rows pack in the middle of a tall phone row: stretched, they left the label high and the check low. */
  .item.checkable { display: grid; grid-template-columns: minmax(0, 1fr) 14px; column-gap: 8px; align-content: center; }
  /* With no hint there is no second line for the check to centre across. */
  .item.checkable:not(:has(> .hint)) .check { grid-row: 1; }
  .checkable .hint { grid-column: 1; grid-row: 2; }
  /* The one selection mark of every menu: a chosen row (`checked` or `active`) wears this check, nothing else. */
  .check { display: flex; grid-column: 2; grid-row: 1 / span 2; align-self: center; color: var(--color-accent); }
  /* A row with a status dot (a changed file) keeps its counts on the label's line, at the right. */
  .item.checkable.inline-hint { grid-template-columns: minmax(0, 1fr) auto 14px; align-items: center; }
  .inline-hint .hint { grid-column: 2; grid-row: 1; }
  .inline-hint .check { grid-column: 3; grid-row: 1; }
  /* One head form for every overlay: the section's (above), the ContextMenu's and the palette's groups. */
  .heading { padding: var(--space-2) var(--overlay-row-pad) var(--space-1); color: var(--color-subtle); font-size: var(--text-xs); font-weight: 600; }
  .popover.switches { width: min(300px, calc(100vw - 24px)); padding: var(--space-2); }
  /* A switch row is a menu row's height (44 px under a finger, app.css); a hint grows it. */
  .switches .item.checkable { grid-template-columns: minmax(0, 1fr) 36px; min-height: var(--overlay-row); padding: var(--space-1) var(--space-3); column-gap: var(--space-3); }
  .switches .item.radio .check { justify-self: center; }
  .switches .label { gap: 9px; }
  .switches .glyph { margin-right: 0; }
  .switches .hint { font-size: var(--text-xs); }
  /* Under the words, past the 14 px icon and its 9 px gap; a row with no icon starts its hint under its name. */
  .switches .iconed > .hint { padding-left: 23px; }
  /* The shared switch (app.css), a little smaller in a menu row. */
  .switch { --switch-width: 36px; --switch-height: 22px; grid-column: 2; grid-row: 1 / span 2; align-self: center; }
  .status-dot { display: inline-block; width: 6px; height: 6px; flex: none; border-radius: 50%; margin-right: 8px; vertical-align: middle; background: var(--color-live); }
  .status-dot[data-tone='success'] { background: var(--color-success); }
  .status-dot[data-tone='danger'] { background: var(--color-danger); }
  .status-dot[data-tone='neutral'] { background: var(--color-muted-foreground); }
  /* A machine out of reach: the offline ring, as on its list line (MachineOffline). */
  .status-dot[data-tone='offline'] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-muted-foreground); }
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

  /* A one-line item is as tall as a context menu row; a hint below grows it.
     Labels are trimmed to their capitals, so the gap keeps descenders off the hint. */
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--space-1);
    height: auto;
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    white-space: normal;
  }

  /* A row with a line under its name is a block of two: more air around it than inside it, so the
     hint reads as its own row's and never as a title over the next one. */
  .item:has(> .hint):not(.inline-hint) { padding-block: var(--space-2); }
  .popover:has(> .item > .hint) { gap: var(--space-1); }

  /* Hover fills only where a pointer hovers: under a finger the last row
     touched kept its fill after the sheet opened or the press ended. Keyboard
     focus wears the shared accent ring (app.css). */
  @media (hover: hover) {
    .item:hover:not(:disabled) {
      background: var(--color-hover);
    }
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .item:active:not(:disabled) {
    transform: none;
    background: var(--color-active);
  }

  .item.danger {
    color: var(--color-danger);
  }

  .label {
    font-weight: 400;
  }

  /* A clipped row keeps one line: the label takes the row's width and ends in an ellipsis (`MenuItem.clip`). */
  .item.clip { align-items: stretch; }
  .item.clip .label { min-width: 0; }
  .item.clip .label .ui-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* A row that opens more rows: its chevron at the far edge. */
  .submenu .label { align-self: stretch; }
  .more { display: inline-flex; margin-left: auto; color: var(--color-subtle); }

  .hint {
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }
</style>
