import { afterEach, expect, test, vi } from 'vitest';
import { subscribeScroll } from './scroll-coordinator';

const OriginalResizeObserver = globalThis.ResizeObserver;
afterEach(() => { vi.restoreAllMocks(); globalThis.ResizeObserver = OriginalResizeObserver; });

test('one scroller shares frame geometry and events, remeasures moved lists, and releases its last subscription', () => {
  const observed = new Set<Element>();
  const disconnect = vi.fn();
  let resized: ResizeObserverCallback;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe(node: Element) { observed.add(node); }
    unobserve(node: Element) { observed.delete(node); }
    disconnect() { observed.clear(); disconnect(); }
  } as unknown as typeof ResizeObserver;
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++serial, callback); return serial; });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  const frame = () => { const pending = [...frames.values()]; frames.clear(); for (const run of pending) run(0); };
  const root = document.createElement('div');
  const rootRect = vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 10, 300, 400));
  const height = vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(400);
  const added = vi.spyOn(root, 'addEventListener');
  const removed = vi.spyOn(root, 'removeEventListener');
  const callbacks = Array.from({ length: 100 }, () => vi.fn());
  const lists = callbacks.map(callback => subscribeScroll(root, document.createElement('div'), callback));
  expect(observed.size).toBe(101);
  expect(added.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(1);
  expect(rootRect).toHaveBeenCalledTimes(1);
  expect(height).toHaveBeenCalledTimes(1);
  frame(); rootRect.mockClear(); height.mockClear(); callbacks.forEach(callback => callback.mockClear());
  root.scrollTop = 500;
  root.dispatchEvent(new Event('scroll')); root.scrollTop = 600; root.dispatchEvent(new Event('scroll'));
  expect(rootRect).toHaveBeenCalledTimes(1);
  expect(height).toHaveBeenCalledTimes(1);
  for (const callback of callbacks) expect(callback).toHaveBeenLastCalledWith({ top: 10, height: 400, scrollTop: 600 });
  frame(); rootRect.mockReturnValue(new DOMRect(0, 30, 300, 200)); height.mockReturnValue(200);
  for (const list of lists) list.schedule();
  resized!([], {} as ResizeObserver);
  frame();
  expect(callbacks[0]).toHaveBeenLastCalledWith({ top: 30, height: 200, scrollTop: 600 });
  lists[0]!.destroy(); callbacks[0]!.mockClear();
  expect(observed.size).toBe(100);
  root.dispatchEvent(new Event('scroll'));
  expect(callbacks[0]).not.toHaveBeenCalled();
  for (const list of lists.slice(1)) list.destroy();
  expect(removed.mock.calls.filter(([name]) => name === 'scroll')).toHaveLength(1);
  expect(frames.size).toBe(0);
  expect(observed.size).toBe(0);
  expect(disconnect).toHaveBeenCalledTimes(1);
  rootRect.mockClear(); root.dispatchEvent(new Event('scroll')); expect(rootRect).not.toHaveBeenCalled();
  const again = subscribeScroll(root, document.createElement('div'), vi.fn());
  expect(rootRect).toHaveBeenCalledTimes(1);
  again.destroy();
});
