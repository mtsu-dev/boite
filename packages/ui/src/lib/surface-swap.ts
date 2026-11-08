/**
 * One surface replacing another in the same box (a panel's tab switch): the
 * old one fades out, then the new one fades in, so two texts never share a
 * frame. Under reduced motion it is a cut. The CSS side is the arriving
 * node's `animation`, which these delay; the leaving side is a Svelte `out:`.
 */

/** The page asks for no motion: the OS setting, or the page's own switch (the tests set it, jsdom has no media queries). */
export function reducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset['motion'] === 'reduced') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A duration token in milliseconds, `140ms` or `0.14s` alike; 0 when unset. */
export function tokenMs(node: Element, name: string): number {
  const token = getComputedStyle(node).getPropertyValue(name).trim();
  return parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 0;
}

/**
 * `out:` for the surface leaving: it fades on `--dur-exit`, laid over the
 * box (out of the flow) so the next one takes its place underneath.
 */
export function leaveSurface(node: HTMLElement, reduced = reducedMotion()): { duration: number; css?: (t: number) => string } {
  const body = node.parentElement;
  const duration = reduced ? 0 : tokenMs(node, '--dur-exit');
  if (!body || duration === 0) return { duration: 0 };
  Object.assign(node.style, {
    position: 'absolute', top: `${body.offsetTop}px`, left: `${body.offsetLeft}px`,
    width: `${body.clientWidth}px`, height: `${body.clientHeight}px`, zIndex: '1', pointerEvents: 'none',
  });
  return { duration, css: (t) => `opacity: ${t}` };
}

/**
 * The surface arriving: it waits out the old one's exit before its own fade,
 * so the box goes through empty rather than through both. Nothing under
 * reduced motion: it is simply there.
 */
export function arriveSurface(node: HTMLElement, reduced = reducedMotion()): void {
  if (reduced) return;
  node.dataset['arriving'] = '';
  node.style.animationDelay = `${tokenMs(node, '--dur-exit')}ms`;
}
