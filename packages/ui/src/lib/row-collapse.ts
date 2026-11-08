import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { reducedMotion } from './surface-swap';

/** How long an archived row takes to close, the app's `--dur-3` (220 ms): read once, so a theme's tempo applies. */
export function collapseMs(): number {
  if (reducedMotion()) return 0;
  const value = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--dur-3').trim();
  const ms = value.endsWith('ms') ? parseFloat(value) : value.endsWith('s') ? parseFloat(value) * 1000 : NaN;
  return Number.isFinite(ms) ? ms : 220;
}

/**
 * A list row leaving because its thread left the list (archived, deleted): it closes in place, height to nothing,
 * so the rows under it slide up instead of jumping, before the undo toast shows (UndoToast.svelte waits as long).
 * Any other removal (a page change, a folded project, a move) and reduced motion are a cut. Used `|global`, since
 * the row sits inside the component's own blocks.
 */
export function collapseRow(node: HTMLElement, gone: () => boolean): TransitionConfig {
  const duration = gone() ? collapseMs() : 0;
  if (duration === 0) return { duration: 0 };
  const style = getComputedStyle(node);
  const height = node.getBoundingClientRect().height;
  const [top, bottom] = [parseFloat(style.paddingTop) || 0, parseFloat(style.paddingBottom) || 0];
  const [above, below] = [parseFloat(style.marginTop) || 0, parseFloat(style.marginBottom) || 0];
  return {
    duration,
    easing: cubicOut,
    css: t => `box-sizing: border-box; overflow: hidden; height: ${t * height}px; min-height: 0; padding-top: ${t * top}px; padding-bottom: ${t * bottom}px; margin-top: ${t * above}px; margin-bottom: ${t * below}px; opacity: ${t};`
  };
}
