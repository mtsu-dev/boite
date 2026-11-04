import { untrack } from 'svelte';
import { stripOverflows } from './strip-overflow';

/**
 * A tab strip too narrow for its tabs: whether it overflows, which ends hide
 * a tab (that end fades instead of cutting a label in half, and its chevron
 * rests), and the chevrons and the wheel that scroll it. Built during a
 * component's setup, it remeasures when the strip's width or content changes.
 */
export class StripScroll {
  overflowing = $state(false);
  hiddenStart = $state(false);
  hiddenEnd = $state(false);
  readonly #node: () => HTMLElement | undefined;

  constructor(node: () => HTMLElement | undefined, content: () => unknown) {
    this.#node = node;
    $effect(() => {
      const element = node();
      if (!element) return;
      void content();
      untrack(() => this.measure());
      // jsdom lays nothing out and ships no ResizeObserver: the strip still renders.
      if (typeof ResizeObserver === 'undefined') return;
      // The chevrons resize the observed tabs: toggling them inside the callback
      // was a resize the observer could not deliver that frame (a loop error).
      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.measure());
      });
      observer.observe(element);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    });
  }

  measure(): void {
    const node = this.#node();
    // A strip with no width yet, a phone's sheet still coming in, has nothing to
    // measure: the observer calls again once it has one. Measured at zero, 44 px
    // chevrons wider than the tabs flipped the state on every run.
    if (!node || node.clientWidth === 0) return;
    const gap = parseFloat(getComputedStyle(node.parentElement ?? node).columnGap) || 0;
    const room = [...(node.parentElement?.querySelectorAll<HTMLElement>(':scope > .chev') ?? [])].reduce((sum, chevron) => sum + chevron.offsetWidth + gap, 0);
    this.overflowing = stripOverflows(node.scrollWidth, node.clientWidth, room, untrack(() => this.overflowing));
    this.readEdges();
  }

  readEdges = (): void => {
    const node = this.#node();
    if (!node) return;
    this.hiddenStart = node.scrollLeft > 1;
    this.hiddenEnd = node.scrollLeft < node.scrollWidth - node.clientWidth - 1;
  };

  scrollBy(direction: -1 | 1): void {
    const node = this.#node();
    if (!node) return;
    const step = Math.max(120, Math.round(node.clientWidth * 0.75));
    node.scrollBy({ left: step * direction, behavior: 'smooth' });
  }

  /** A vertical wheel scrolls the strip sideways. */
  onwheel = (event: WheelEvent): void => {
    const node = this.#node();
    if (!node || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    node.scrollLeft += event.deltaY;
  };
}
