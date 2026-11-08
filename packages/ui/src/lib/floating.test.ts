import { afterEach, describe, expect, it, vi } from 'vitest';
import { floating } from './floating';

describe('floating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  // A phone sheet once landed 28 px low under reduced motion: its padding came
  // in through a 0.01ms transition, the first measure read the desktop box, and
  // no observer fired when the padding alone grew.
  it('never animates its placement and re-places when the border box changes', () => {
    const boxes: (ResizeObserverOptions | undefined)[] = [];
    vi.stubGlobal('ResizeObserver', class {
      observe(_target: Element, options?: ResizeObserverOptions) { boxes.push(options); }
      unobserve() {}
      disconnect() {}
    });
    const anchor = document.createElement('button');
    const node = document.createElement('div');
    document.body.append(anchor, node);
    const handle = floating(node, { anchor: () => anchor });
    expect(node.style.transitionProperty).toBe('none');
    expect(boxes[0]).toEqual({ box: 'border-box' });
    handle.destroy();
  });
});
