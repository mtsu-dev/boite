import { afterEach, expect, test } from 'vitest';
import { floating } from './floating';

afterEach(() => { document.body.replaceChildren(); });

function anchorAt(left: number): HTMLElement {
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => ({ left, right: left + 80, top: 100, bottom: 124, width: 80, height: 24, x: left, y: 100, toJSON: () => ({}) });
  document.body.append(anchor);
  return anchor;
}

/**
 * Round 6: the sidebar's view picker sits 10 px from the window's edge, and
 * its menu, clamped to the 12 px margin, left the first letter of the tab row
 * under it showing at its left edge.
 */
test('a menu opened from a trigger inside the window margin starts on the trigger edge', () => {
  const node = document.createElement('div');
  document.body.append(node);
  const anchor = anchorAt(10);
  const placed = floating(node, { anchor: () => anchor, placement: 'bottom' });
  expect(node.style.left).toBe('10px');
  placed.destroy();
});

test('a menu still keeps the margin from the edge when its trigger does', () => {
  const node = document.createElement('div');
  document.body.append(node);
  const anchor = anchorAt(40);
  const placed = floating(node, { anchor: () => anchor, placement: 'bottom' });
  expect(node.style.left).toBe('40px');
  placed.destroy();
  const edge = anchorAt(-4);
  const clamped = floating(node, { anchor: () => edge, placement: 'bottom' });
  expect(node.style.left).toBe('0px');
  clamped.destroy();
});
