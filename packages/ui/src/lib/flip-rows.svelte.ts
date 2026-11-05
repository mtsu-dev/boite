import { untrack } from 'svelte';
import { glides } from './motion';

/**
 * Where each drawn row of a thread list sits, by its `data-window-key`
 * (WindowList), in the scroller's content: a scroll moves no row.
 */
export function rowPlaces(root: HTMLElement): Map<string, number> {
  const origin = root.getBoundingClientRect().top - root.scrollTop;
  const places = new Map<string, number>();
  for (const row of root.querySelectorAll<HTMLElement>('[data-window-key]')) {
    const key = row.dataset['windowKey'];
    if (key && !places.has(key)) places.set(key, row.getBoundingClientRect().top - origin);
  }
  return places;
}

/**
 * Slides every row that moved since `before` from its old place to its new
 * one over `--dur-3` on the app's out easing: a thread that changes band
 * travels there instead of vanishing and reappearing 300 px away. Only rows
 * on screen before or after move, so a long list never starts dozens of
 * animations, and nothing moves under reduced motion (`glides`, the media
 * query and `html[data-motion='reduced']` both) or for less than a pixel.
 * A row new to the list just appears.
 */
export function slideRows(root: HTMLElement, before: ReadonlyMap<string, number>): number {
  if (!glides()) return 0;
  const style = getComputedStyle(root);
  const token = style.getPropertyValue('--dur-3').trim();
  const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 0;
  if (duration < 1) return 0;
  const easing = style.getPropertyValue('--ease-out-quint').trim() || 'ease-out';
  const view = root.getBoundingClientRect();
  const origin = view.top - root.scrollTop;
  const shown = (top: number) => top + origin < view.bottom && top + origin > view.top - 120;
  let moved = 0;
  const seen = new Set<string>();
  for (const row of root.querySelectorAll<HTMLElement>('[data-window-key]')) {
    const key = row.dataset['windowKey'];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const was = before.get(key);
    if (was === undefined || typeof row.animate !== 'function') continue;
    const now = row.getBoundingClientRect().top - origin;
    const delta = was - now;
    if (Math.abs(delta) < 1 || !(shown(was) || shown(now))) continue;
    row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration, easing });
    moved += 1;
  }
  return moved;
}

/**
 * Animates a list's rows between two orders: reads where they sit just before
 * the DOM takes `order`'s new value, then slides them from there. `order` is
 * a key of what the rows' places depend on (their keys, bands and lanes), so
 * a tick of a row's clock reads no layout. `scope` names the list drawn (the
 * view, a filter): a row found again in another list just appears there, as
 * Recent and Projects key a thread alike.
 */
export function flipRows(root: () => HTMLElement | undefined, order: () => string, scope: () => string = () => ''): void {
  let before: Map<string, number> | null = null;
  let drawn: string | null = null;
  $effect.pre(() => {
    order();
    const now = scope();
    before = untrack(() => { const node = root(); return node && drawn === now ? rowPlaces(node) : null; });
    drawn = now;
  });
  $effect(() => {
    order();
    scope();
    untrack(() => {
      const node = root();
      if (node && before) slideRows(node, before);
      before = null;
    });
  });
}
