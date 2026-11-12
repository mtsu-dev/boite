/**
 * One surface replacing another in the same box (a panel's tab switch): the
 * old one leaves at once and the new one is there in the same frame, settling
 * from a high opacity and a few pixels from the side its panel sits on in the
 * launcher, so no frame shows an empty box or two texts and the eye knows
 * which way it went. Under reduced motion it is a plain cut. The CSS side is
 * the arriving node's `animation`, its offset `--arrive-x`.
 */

/** The page asks for no motion: the OS setting, or the page's own switch (the tests set it, jsdom has no media queries). */
export function reducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset['motion'] === 'reduced') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How far the arriving surface starts from its place: a few pixels, felt more than seen. */
export const ARRIVE_SHIFT = 8;

/**
 * The surface arriving: marked so its settle plays, with no delay. `side` is
 * where the new panel sits against the old one (1 after it, -1 before, 0 a
 * plain fade). Nothing under reduced motion.
 */
export function arriveSurface(node: HTMLElement, reduced = reducedMotion(), side = 0): void {
  if (reduced) return;
  node.dataset['arriving'] = '';
  if (side) node.style.setProperty('--arrive-x', `${Math.sign(side) * ARRIVE_SHIFT}px`);
}
