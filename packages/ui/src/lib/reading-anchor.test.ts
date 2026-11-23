import { describe, expect, test } from 'vitest';
import { ReadingAnchor } from './reading-anchor';

/** An element whose top is `top()` px down the page, connected. */
function box(top: () => number, mid?: string): HTMLElement {
  const node = document.createElement('div');
  if (mid) node.dataset['mid'] = mid;
  node.getBoundingClientRect = () => {
    const y = top();
    return { top: y, bottom: y + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y, toJSON: () => ({}) };
  };
  document.body.append(node);
  return node;
}

describe('ReadingAnchor', () => {
  test('uses a virtual row estimate without measuring the entire overscan', () => {
    const viewport = box(() => 0);
    Object.defineProperty(viewport, 'clientHeight', { value: 600 });
    const column = document.createElement('div');
    viewport.append(column);
    let reads = 0;
    const rows = Array.from({ length: 40 }, (_, index) => box(() => {
      reads++;
      return (index - 25) * 100 - 20;
    }, `m-${index}`));
    column.append(...rows);
    const anchors = new ReadingAnchor(undefined);
    try {
      // An approximate slot places the top a row too far down.
      anchors.remember(viewport, column, rows[26]);
      expect(anchors.current).toEqual({ id: 'm-25', offset: -20, message: 'm-25' });
      expect(reads).toBeLessThan(6);
    } finally {
      viewport.remove();
    }
  });

  test('a held row stays the anchor, to the fraction, until a scroll moves it more than 2 px', () => {
    let row = -40.25;
    const viewport = box(() => 0);
    Object.defineProperty(viewport, 'clientHeight', { value: 600 });
    const column = document.createElement('div');
    document.body.append(column);
    const node = box(() => row, 'm-1');
    column.append(node);
    const anchors = new ReadingAnchor(undefined);
    anchors.nodes.set('m-1', node);
    anchors.hold({ id: 'm-1', offset: -40.25 });
    // The browser's own anchoring snapped the row 0.77 px off: the held offset is not read again.
    row = -41.02;
    anchors.remember(viewport, column);
    expect(anchors.current?.offset).toBe(-40.25);
    anchors.release(viewport);
    expect(anchors.held).toBe(true);
    expect(anchors.drift(viewport, anchors.current!)).toBeCloseTo(-0.77);
    // The reader scrolled: what they read now is the anchor.
    row = -60.25;
    anchors.release(viewport);
    expect(anchors.held).toBe(false);
    anchors.remember(viewport, column);
    expect(anchors.current?.offset).toBe(-60.25);
  });
});
