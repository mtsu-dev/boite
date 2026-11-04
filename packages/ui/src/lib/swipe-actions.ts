/**
 * A phone's row that a finger slides either way to act on it, as mail apps
 * do: right marks it done, left archives it. Past `THRESHOLD` of the row's
 * width the reveal under it arms, and letting go there runs the action; short
 * of it the row springs back. Only a touch drags: a mouse and a keyboard keep
 * the row's menu, which offers the same actions. A gesture that starts
 * vertical stays the list's scroll, and `touch-action: pan-y` on the row lets
 * the browser take it.
 */

/** The share of the row's width past which letting go runs the action. */
export const THRESHOLD = 0.35;
/** Past this many pixels the gesture has chosen between a slide and a scroll. */
const SLOP = 8;

export type SwipeSide = 'right' | 'left';
export type SwipeOptions = {
  /** Which ways the row may slide now: a thread at work cannot be marked done. */
  allows: (side: SwipeSide) => boolean;
  run: (side: SwipeSide) => void;
};

/**
 * `node` is the row's sliding body. It gets `--swipe` (px), `data-swipe`
 * (the side it slides toward) and `data-armed` while past the threshold,
 * which its parent reads to colour the reveal under it.
 */
export function swipeActions(node: HTMLElement, initial: SwipeOptions) {
  let options = initial;
  let startX = 0, startY = 0, offset = 0;
  let pointer: number | null = null;
  let mode: 'idle' | 'pending' | 'drag' = 'idle';
  let swallow = false;

  const host = () => node.parentElement ?? node;
  function place(x: number, dragging: boolean) {
    offset = x;
    const side: SwipeSide | null = x > 0 ? 'right' : x < 0 ? 'left' : null;
    const armed = side !== null && Math.abs(x) >= node.offsetWidth * THRESHOLD;
    node.classList.toggle('dragging', dragging);
    if (x) node.style.setProperty('--swipe', `${x}px`);
    else node.style.removeProperty('--swipe');
    const parent = host();
    if (side) parent.dataset.swipe = side;
    else delete parent.dataset.swipe;
    parent.toggleAttribute('data-armed', armed);
  }

  function down(event: PointerEvent) {
    if (event.pointerType !== 'touch' || pointer !== null) return;
    swallow = false;
    pointer = event.pointerId; mode = 'pending';
    startX = event.clientX; startY = event.clientY;
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointer || mode === 'idle') return;
    const dx = event.clientX - startX, dy = event.clientY - startY;
    if (mode === 'pending') {
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) { mode = 'idle'; pointer = null; return; }
      if (Math.abs(dx) <= SLOP) return;
      mode = 'drag';
      try { node.setPointerCapture(event.pointerId); } catch { /* the pointer already left */ }
    }
    event.preventDefault();
    const side: SwipeSide = dx > 0 ? 'right' : 'left';
    // A way the row cannot go resists: it moves a little, so the finger feels the row is there.
    const x = options.allows(side) ? dx : Math.sign(dx) * Math.min(24, Math.abs(dx) / 4);
    place(x, true);
  }
  function up(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const dragged = mode === 'drag';
    pointer = null; mode = 'idle';
    if (!dragged) return;
    // The click that ends a slide is not a tap on the row; a cancelled pointer sends no click.
    swallow = event.type === 'pointerup';
    const side: SwipeSide | null = offset > 0 ? 'right' : offset < 0 ? 'left' : null;
    const armed = side !== null && options.allows(side) && Math.abs(offset) >= node.offsetWidth * THRESHOLD;
    place(0, false);
    if (event.type !== 'pointercancel' && armed && side) options.run(side);
  }
  function click(event: MouseEvent) {
    if (!swallow) return;
    swallow = false;
    event.preventDefault();
    event.stopPropagation();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('click', click, true);
  return {
    update(next: SwipeOptions) { options = next; },
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('click', click, true);
    }
  };
}
