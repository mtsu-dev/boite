import { glides } from './motion';

/**
 * Grows an element that just got taller from the height it had, its content
 * fading in with it, over `--motion-duration`: a decision docked at the composer's
 * head and the box around it move as one piece, with no frame drawn at the
 * final size before the content is there. Reduced motion shows it at once.
 */
export function growFrom(element: HTMLElement, from: number): void {
  const to = element.getBoundingClientRect().height;
  if (to - from < 1) return;
  move(element, [{ height: `${from}px`, opacity: from > 0 ? 1 : 0, overflow: 'hidden' }, { height: `${to}px`, opacity: 1, overflow: 'hidden' }]);
}

/** The dock's own motion: `--motion-duration` on `--motion-curve`, nothing under reduced motion. */
function move(element: HTMLElement, frames: Keyframe[]): void {
  if (!glides() || typeof element.animate !== 'function') return;
  const style = getComputedStyle(element);
  const token = style.getPropertyValue('--motion-duration').trim();
  const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 0;
  if (duration <= 0) return;
  element.animate(frames, { duration, easing: style.getPropertyValue('--motion-curve').trim() || 'ease-out' });
}

/**
 * Closes an element that just got shorter from the height it had: an
 * answered decision leaves the dock as the box closes over its place, in
 * `--motion-duration` (200 ms), while its receipt lands in the transcript. Reduced
 * motion cuts.
 */
export function collapseFrom(element: HTMLElement, from: number): void {
  const to = element.getBoundingClientRect().height;
  if (from - to < 1) return;
  move(element, [{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }]);
}

/**
 * Watches a dock for decisions leaving it: when `count` falls on the same
 * thread (`owner`) and the dock got shorter, it closes from its last height.
 * A thread switch changes both at once and moves nothing.
 */
export function collapsesOnLeave(count: () => number, owner: () => string | undefined): (element: HTMLElement) => () => void {
  return (element) => {
    if (typeof ResizeObserver !== 'function') return () => {};
    let tall = element.getBoundingClientRect().height;
    let seen = count();
    let whose = owner();
    const watch = new ResizeObserver(() => {
      const now = count();
      const who = owner();
      const height = element.getBoundingClientRect().height;
      const from = tall;
      const left = who === whose && now < seen && height < from - 1;
      seen = now;
      whose = who;
      // An animation in flight reports its frames: keep the height it ends on.
      if (left || !element.getAnimations?.().length) tall = height;
      if (left) collapseFrom(element, from);
    });
    watch.observe(element);
    return () => watch.disconnect();
  };
}

/** An attachment for a decision that mounts with its content: it grows in from nothing. */
export function arrive(element: HTMLElement): void {
  growFrom(element, 0);
}

/**
 * Watches a dock whose decisions come and go: when `count` rises and the dock
 * got taller, it grows from its last height. Other growth (a fold opened, a
 * page turned) keeps its own motion.
 */
export function growsOnArrival(count: () => number): (element: HTMLElement) => () => void {
  return (element) => {
    if (typeof ResizeObserver !== 'function') return () => {};
    let tall = 0;
    let seen = 0;
    const watch = new ResizeObserver(() => {
      const now = count();
      const height = element.getBoundingClientRect().height;
      const from = tall;
      const arrived = now > seen && height > from + 1;
      seen = now;
      // An animation in flight reports its frames: keep the height it ends on.
      if (arrived || !element.getAnimations?.().length) tall = height;
      if (arrived) growFrom(element, from);
    });
    watch.observe(element);
    return () => watch.disconnect();
  };
}
