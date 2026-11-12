import { afterEach, describe, expect, it, vi } from 'vitest';
import { floating } from './floating';
import { mobileOverlay } from './mobile-history';

vi.mock('./mobile-history', () => ({ mobileOverlay: vi.fn() }));

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

  // A phone picked the agent browser from the panel switcher's sheet, then pressed Back: the sheet, still playing its
  // exit, held the history entry, so that Back closed it again instead of the panel under it.
  it('gives Back to what lies under a phone sheet as soon as its exit starts', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }));
    const releases = [vi.fn(), vi.fn()];
    vi.mocked(mobileOverlay).mockReset().mockReturnValueOnce(releases[0]!).mockReturnValueOnce(releases[1]!);
    const anchor = document.createElement('button');
    const node = document.createElement('div');
    document.body.append(anchor, node);
    const dismiss = vi.fn();
    const handle = floating(node, { anchor: () => anchor, dismiss });
    expect(mobileOverlay).toHaveBeenCalledTimes(1);
    const settle = () => new Promise(resolve => setTimeout(resolve));

    node.classList.add('closing');
    await settle();
    expect(releases[0]).toHaveBeenCalledTimes(1);
    // Opened again inside its exit, it takes an entry of its own again.
    node.classList.remove('closing');
    await settle();
    expect(mobileOverlay).toHaveBeenCalledTimes(2);
    handle.destroy();
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(releases[1]).toHaveBeenCalledTimes(1);
  });

  // A phone sheet docks its whole border box to the bottom edge: a box measured without its padding
  // and hairline would stop that far short of it, and a fractional height must not be rounded.
  it('docks a sheet by its full fractional height, padding and border included in either box model', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('innerHeight', 900);
    vi.mocked(mobileOverlay).mockReset().mockReturnValue(() => {});
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const tops = (['border-box', 'content-box'] as const).map((sizing) => {
      const node = document.createElement('div');
      node.style.cssText = `box-sizing: ${sizing}; height: ${sizing === 'border-box' ? 403.5 : 371.5}px; padding: 15px 0; border-top: 1px solid; border-bottom: 1px solid`;
      document.body.append(node);
      const handle = floating(node, { anchor: () => anchor });
      const top = node.style.top;
      handle.destroy();
      return top;
    });
    expect(tops).toEqual(['496.5px', '496.5px']);
  });
});
