/*
 * Where the guide's box goes on the screen: whether a control is in view of
 * its window, the edge it lies past when it is not, and where the arrow
 * pointing toward it sits. Physical screen pixels throughout.
 */
import type { WindowEdge } from '@boite/contracts';
import type { ScreenRect } from '../platform/types.ts';

export const sameRect = (a: ScreenRect | null, b: ScreenRect | null) =>
  a === b || (a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
/** A control scrolled under the window's edge is out of view, whatever its app says. */
export const centerInside = (rect: ScreenRect, frame: ScreenRect) => {
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  return x >= frame.left && x < frame.left + frame.width && y >= frame.top && y < frame.top + frame.height;
};
/**
 * The edge of `bounds` that `rect` lies past, the farthest out, a vertical one
 * on a tie since most scrolling is; null when its center is inside.
 */
export function edgeOf(rect: ScreenRect, bounds: ScreenRect): WindowEdge | null {
  if (centerInside(rect, bounds)) return null;
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const past: [WindowEdge, number][] = [
    ['above', bounds.top - y], ['below', y - (bounds.top + bounds.height)],
    ['left', bounds.left - x], ['right', x - (bounds.left + bounds.width)],
  ];
  let best = past[0]!;
  for (const side of past) if (side[1] > best[1]) best = side;
  return best[0];
}
/** The marker's square, in physical pixels: the page draws its arrow in the middle. */
const MARKER = 32;
/** How far inside the edge it sits, so it reads as the window's and not the next app's. */
const MARKER_INSET = 10;
/**
 * Where the marker for a control at `rect`, past `edge` of `bounds`, goes:
 * just inside that edge, level with the control along it, kept within the
 * window's corners.
 */
export function markerRect(edge: WindowEdge, rect: ScreenRect, bounds: ScreenRect): ScreenRect {
  const along = (start: number, size: number, aim: number) =>
    Math.round(Math.max(Math.min(aim - MARKER / 2, start + size - MARKER_INSET - MARKER), start + MARKER_INSET));
  const x = along(bounds.left, bounds.width, rect.left + rect.width / 2);
  const y = along(bounds.top, bounds.height, rect.top + rect.height / 2);
  if (edge === 'above') return { left: x, top: bounds.top + MARKER_INSET, width: MARKER, height: MARKER };
  if (edge === 'below') return { left: x, top: bounds.top + bounds.height - MARKER_INSET - MARKER, width: MARKER, height: MARKER };
  if (edge === 'left') return { left: bounds.left + MARKER_INSET, top: y, width: MARKER, height: MARKER };
  return { left: bounds.left + bounds.width - MARKER_INSET - MARKER, top: y, width: MARKER, height: MARKER };
}
