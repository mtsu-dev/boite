import { describe, expect, test } from 'vitest';
import { ReadingAnchor } from './reading-anchor';

/** An element whose top is `top()` px down the page, connected. */
function box(top: () => number, mid?: string): HTMLElement {
  const node = document.createElement('div');
  if (mid) node.dataset['mid'] = mid;
  node.getBoundingClientRect = () => ({ top: top(), bottom: top() + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top(), toJSON: () => ({}) });
  document.body.append(node);
  return node;
}

describe('ReadingAnchor', () => {
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
