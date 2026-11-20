<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Closing } from '../lib/closing.svelte';
  import { contextMenu, type ContextMenuState } from '../lib/context-menu.svelte';
  import { restoreFocus } from '../lib/focus';
  import { dangerLast, menuRows, moveMenuFocus, type MenuItem } from '../lib/menu';
  import MenuRows from './MenuRows.svelte';

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
      menuRows(root)[0]?.focus({ preventScroll: true });
    });
  });

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
    moveMenuFocus(event, menuRows(root), false);
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
    <MenuRows ordered={dangerLast(request.items)} {pick} {sheet} atPointer />
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

</style>
