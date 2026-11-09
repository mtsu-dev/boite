import { glides } from './motion';

/**
 * Grows an element that just got taller from the height it had, its content
 * fading in with it, over `--motion-duration`: a decision at the end of the timeline
 * and its content move as one piece, with no frame drawn at the
 * final size before the content is there. Reduced motion shows it at once.
 */
export function growFrom(element: HTMLElement, from: number): void {
  const to = element.getBoundingClientRect().height;
  if (to - from < 1) return;
  move(element, [{ height: `${from}px`, opacity: from > 0 ? 1 : 0, overflow: 'hidden' }, { height: `${to}px`, opacity: 1, overflow: 'hidden' }]);
}

/** The decision's own motion: `--motion-duration` on `--motion-curve`, nothing under reduced motion. */
function move(element: HTMLElement, frames: Keyframe[]): void {
  if (!glides() || typeof element.animate !== 'function') return;
  const style = getComputedStyle(element);
  const token = style.getPropertyValue('--motion-duration').trim();
  const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 0;
  if (duration <= 0) return;
  element.animate(frames, { duration, easing: style.getPropertyValue('--motion-curve').trim() || 'ease-out' });
}

/** An attachment for a decision that mounts with its content: it grows in from nothing. */
export function arrive(element: HTMLElement): void {
  growFrom(element, 0);
}

