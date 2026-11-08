/**
 * One surface replacing another in the same box (a panel's tab switch): the
 * old one leaves at once and the new one is there in the same frame, settling
 * from a high opacity, so no frame shows an empty box or two texts. Under
 * reduced motion it is a plain cut. The CSS side is the arriving node's
 * `animation`.
 */

/** The page asks for no motion: the OS setting, or the page's own switch (the tests set it, jsdom has no media queries). */
export function reducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset['motion'] === 'reduced') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The surface arriving: marked so its settle plays, with no delay. Nothing under reduced motion. */
export function arriveSurface(node: HTMLElement, reduced = reducedMotion()): void {
  if (reduced) return;
  node.dataset['arriving'] = '';
}
