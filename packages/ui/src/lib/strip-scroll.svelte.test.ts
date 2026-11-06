import { afterEach, expect, test } from 'vitest';
import { StripScroll } from './strip-scroll.svelte';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; document.body.innerHTML = ''; });

/** A strip `clientWidth` wide holding `scrollWidth` of tabs, scrolled to `left`. */
function strip(clientWidth: number, scrollWidth: number, left: number): { scroll: StripScroll; node: HTMLElement } {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientWidth', { value: clientWidth });
  Object.defineProperty(node, 'scrollWidth', { value: scrollWidth });
  node.scrollLeft = left;
  document.body.append(node);
  let scroll!: StripScroll;
  cleanup = $effect.root(() => { scroll = new StripScroll(() => node, () => null); });
  return { scroll, node };
}

function wheel(scroll: StripScroll, deltaY: number): boolean {
  const event = new WheelEvent('wheel', { deltaY, cancelable: true });
  scroll.onwheel(event);
  return event.defaultPrevented;
}

// The wheel was taken for any vertical turn over the tabs: a strip that fits,
// or one already at the end the wheel went toward, froze the page's scroll.
test('a vertical wheel scrolls the strip sideways only while it has room to go', () => {
  const fits = strip(400, 400, 0);
  expect(wheel(fits.scroll, 60)).toBe(false);
  expect(wheel(fits.scroll, -60)).toBe(false);

  const atStart = strip(400, 900, 0);
  expect(wheel(atStart.scroll, -60)).toBe(false);
  expect(wheel(atStart.scroll, 60)).toBe(true);
  expect(atStart.node.scrollLeft).toBe(60);

  const atEnd = strip(400, 900, 500);
  expect(wheel(atEnd.scroll, 60)).toBe(false);
  expect(atEnd.node.scrollLeft).toBe(500);
  expect(wheel(atEnd.scroll, -60)).toBe(true);
  expect(atEnd.node.scrollLeft).toBe(440);
});
