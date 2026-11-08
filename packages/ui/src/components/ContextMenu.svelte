<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Check } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { contextMenu, type ContextMenuState } from '../lib/context-menu.svelte';
  import { restoreFocus } from '../lib/focus';
  import { dangerLast, type MenuItem } from '../lib/menu';
  import BackRow from './BackRow.svelte';

  const GAP = 6;

  const popover = new Closing();
  /** The request is nulled the moment it is answered, so the exit plays on a copy. */
  let held = $state<ContextMenuState | null>(null);
  let root = $state<HTMLDivElement | undefined>(undefined);
  let left = $state(0);
  let top = $state(0);
  /** On a phone the menu is the shared bottom sheet (app.css), not a popover at the finger. */
  let sheet = $state(false);

  /** Whether the menu is up, so its close hands the keyboard back once and only then. */
  let opened = false;

  /** Opens at the pointer, then slides inside the viewport once its size is known. */
  $effect(() => {
    const current = contextMenu.current;
    if (!current) {
      popover.hide();
      if (opened) untrack(giveBack);
      opened = false;
      return;
    }
    opened = true;
    held = current;
    popover.show();
    sheet = window.matchMedia?.('(max-width: 720px)').matches ?? false;
    // A sheet is docked from its first frame: placed at the finger first, it drew there once, labels cut by the edge.
    left = sheet ? 0 : current.x;
    top = current.y;
    void tick().then(() => {
      const el = root;
      if (!el) return;
      // Match anchored menus: the top layer stays above the whip and its control.
      if (el.showPopover && !el.matches(':popover-open')) el.showPopover();
      if (sheet) {
        // Docked to the bottom edge over the tab bar (its style); no row opens lit under the finger.
        el.focus({ preventScroll: true });
        return;
      }
      left = Math.max(GAP, Math.min(current.x, window.innerWidth - el.offsetWidth - GAP));
      top = Math.max(GAP, Math.min(current.y, window.innerHeight - el.offsetHeight - GAP));
      rows()[0]?.focus({ preventScroll: true });
    });
  });

  function rows(): HTMLElement[] {
    return root ? Array.from(root.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)')) : [];
  }

  /**
   * The rows go with the menu, and a focus left on the page lets the next
   * Escape stop the running turn: it goes back to the opener, else the
   * composer, unless something outside the menu took it meanwhile.
   */
  function giveBack() {
    opened = false;
    const active = document.activeElement;
    if (!active || active === document.body || root?.contains(active)) restoreFocus(contextMenu.returnTo);
    contextMenu.returnTo = null;
  }

  /** The keyboard is back on the opener before the pick runs, so a dialog it opens returns there too. */
  function pick(item: MenuItem) {
    if (item.disabled || item.separator) return;
    const current = contextMenu.current;
    contextMenu.close();
    giveBack();
    current?.onpick(item.id);
  }

  function onWindowPointerdown(event: PointerEvent) {
    if (!contextMenu.current) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    contextMenu.close();
  }

  function onkeydown(event: KeyboardEvent) {
    if (!contextMenu.current) return;
    // Caught on the way down, so the window's own Escape, which stops the turn, never hears it.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      contextMenu.close();
      return;
    }
    // Into a submenu from its row, back out of it from any row.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const focused = (document.activeElement as HTMLElement | null)?.dataset['value'];
      const items = contextMenu.current.items;
      const target = event.key === 'ArrowRight' ? items.find((item) => item.submenu && item.id === focused) : items.find((item) => item.back);
      if (!target || target.disabled) return;
      event.preventDefault();
      pick(target);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const list = rows();
    if (list.length === 0) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const index = active ? list.indexOf(active) : -1;
    let next = 0;
    if (event.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (event.key === 'End') next = list.length - 1;
    list[next]?.focus();
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerdown}
  onkeydowncapture={onkeydown}
  onresize={() => contextMenu.close()}
  onblur={() => contextMenu.close()}
  onscrollcapture={(event) => {
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    // A scroll beside what the menu points at leaves it in place: the timeline settling or following a stream.
    const anchor = contextMenu.anchor;
    if (anchor?.isConnected && event.target instanceof Node && !event.target.contains(anchor)) return;
    contextMenu.close();
  }}
/>

{#if popover.shown && held}
  {@const request = held}
  <div
    class="context-menu"
    class:closing={popover.closing}
    role="menu"
    popover="manual"
    tabindex="-1"
    bind:this={root}
    use:popover.attach
    onanimationend={popover.end}
    style={sheet ? 'left: 0; bottom: 0;' : `left: ${left}px; top: ${top}px;`}
    data-testid="context-menu"
    data-mobile-sheet={sheet ? 'true' : undefined}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each dangerLast(request.items) as item (item.id)}
      {#if item.separator && item.label}
        <!-- A labelled rule opens a group, as in Menu.svelte: a long menu names its groups. -->
        <div class="section ui-label" role="presentation">{item.label}</div>
      {:else if item.separator}
        <div class="rule" role="separator"></div>
      {:else if item.back}
        <BackRow label={item.label} title={item.title} disabled={item.disabled} tabindex={-1} data-value={item.id} data-testid={item.testid} onclick={() => pick(item)} />
      {:else}
        <button
          type="button"
          class="row"
          class:danger={item.danger}
          class:active={item.active}
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          tabindex="-1"
          disabled={item.disabled}
          title={item.title}
          data-row
          data-value={item.id}
          data-testid={item.testid}
          onclick={() => pick(item)}
        >
          {#if item.glyph}
            <span class="glyph" aria-hidden="true"><item.glyph size={16} strokeWidth={1.75} /></span>
          {/if}
          <span class="label ui-label">{item.label}</span>
          {#if item.hint}
            <span class="hint ui-label">{item.hint}</span>
          {/if}
          {#if item.checked || item.active}<span class="check"><Check size={14} aria-hidden="true" /></span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    margin: 0;
    inset: auto;
    z-index: 70;
    min-width: 200px;
    max-width: min(320px, calc(100vw - 12px));
    max-height: calc(100dvh - 12px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--overlay-pad);
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    gap: 1px;
    animation: pop var(--motion-duration) var(--motion-curve);
    transform-origin: top left;
    outline: none;
  }

  .context-menu.closing {
    animation: pop-out var(--motion-duration) var(--motion-curve);
    pointer-events: none;
  }

  /* The one sheet inset, as Menu.svelte's: rows, rules and section titles start on one line. */
  .context-menu[data-mobile-sheet='true'] {
    width: 100vw;
    max-height: 85dvh;
    padding-inline: var(--space-2);
  }

  .section {
    flex-shrink: 0;
    padding: var(--space-3) var(--overlay-row-pad) var(--space-2);
    font-size: var(--text-meta);
    font-weight: 600;
    color: var(--color-subtle);
  }

  .section:first-child { padding-top: var(--space-1); }
  .context-menu[data-mobile-sheet='true'] .section { padding-top: var(--space-4); }
  .context-menu[data-mobile-sheet='true'] .section:first-child { padding-top: 0; }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    height: auto;
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
  }

  /* Hover fills only under a hovering pointer, so a touch leaves none behind;
     keyboard focus wears the shared accent ring (app.css). */
  @media (hover: hover) {
    .row:hover:not(:disabled) {
      background: var(--color-hover);
    }
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .row:active:not(:disabled) {
    transform: none;
    background: var(--color-active);
  }

  .row.danger {
    color: var(--color-danger);
  }

  /* Glyph to label as in Menu.svelte: the gap and 2 px. */
  .glyph {
    display: flex;
    flex: 0 0 16px;
    margin-right: 2px;
    color: var(--color-muted-foreground);
  }

  .danger .glyph {
    color: inherit;
  }

  .label {
    flex: 1;
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* The one selection mark, as in Menu.svelte: 14 px, at the row's far edge. */
  .check {
    display: flex;
    flex: 0 0 14px;
    color: var(--color-accent);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--color-subtle);
    white-space: nowrap;
  }

  .rule {
    flex-shrink: 0;
    height: 1px;
    margin: var(--space-1) var(--overlay-row-pad);
    background: var(--color-border);
  }

  /* A rule only ever separates: none at either end of the menu, never two in a row. */
  /* A back row draws its own rule (BackRow.svelte): no second one under it. */
  .rule:first-child, .rule:last-child, .rule + .rule, .context-menu :global(.back-rule + .rule) { display: none; }
</style>
