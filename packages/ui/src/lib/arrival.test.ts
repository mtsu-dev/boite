import { afterEach, expect, test, vi } from 'vitest';
import { arrive, collapsesOnLeave, growFrom } from './arrival';

afterEach(() => { delete document.documentElement.dataset.motion; document.body.replaceChildren(); vi.restoreAllMocks(); });

function dock(height: number): { node: HTMLElement; animate: ReturnType<typeof vi.fn> } {
  const node = document.createElement('div');
  node.style.setProperty('--dur-enter', '200ms');
  node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: height, width: 0, height, x: 0, y: 0, toJSON() {} }) as DOMRect;
  const animate = vi.fn();
  node.animate = animate as unknown as typeof node.animate;
  document.body.append(node);
  return { node, animate };
}

test('a decision grows in from nothing, box and content together, so no empty frame comes first', () => {
  const { node, animate } = dock(120);
  arrive(node);
  expect(animate).toHaveBeenCalledTimes(1);
  const [frames, timing] = animate.mock.calls[0]!;
  expect(frames).toEqual([{ height: '0px', opacity: 0, overflow: 'hidden' }, { height: '120px', opacity: 1, overflow: 'hidden' }]);
  expect(timing).toMatchObject({ duration: 200 });
});

test('a dock already open grows from its last height with its content in full', () => {
  const { node, animate } = dock(180);
  growFrom(node, 60);
  expect(animate.mock.calls[0]![0]).toEqual([{ height: '60px', opacity: 1, overflow: 'hidden' }, { height: '180px', opacity: 1, overflow: 'hidden' }]);
});

test('under reduced motion a decision appears at once', () => {
  document.documentElement.dataset.motion = 'reduced';
  const { node, animate } = dock(120);
  arrive(node);
  expect(animate).not.toHaveBeenCalled();
});

/** A dock whose height, count and thread the test sets, with the observer's callback in hand. */
function watched(): { animate: ReturnType<typeof vi.fn>; set: (height: number, count: number, owner: string) => void } {
  let height = 180, count = 1, owner = 't-one';
  let changed = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { changed = callback; } observe() {} disconnect() {} });
  const { node, animate } = dock(0);
  node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: height, width: 0, height, x: 0, y: 0, toJSON() {} }) as DOMRect;
  collapsesOnLeave(() => count, () => owner)(node);
  return { animate, set: (h, c, o) => { height = h; count = c; owner = o; changed(); } };
}

test('an answered decision closes the dock from its last height instead of jumping', () => {
  const { animate, set } = watched();
  set(60, 0, 't-one');
  expect(animate).toHaveBeenCalledTimes(1);
  const [frames, timing] = animate.mock.calls[0]!;
  expect(frames).toEqual([{ height: '180px', overflow: 'hidden' }, { height: '60px', overflow: 'hidden' }]);
  expect(timing).toMatchObject({ duration: 200 });
  vi.unstubAllGlobals();
});

test('a thread switch, or reduced motion, closes the dock at once', () => {
  const { animate, set } = watched();
  set(60, 0, 't-two');
  expect(animate).not.toHaveBeenCalled();
  set(180, 1, 't-two');
  document.documentElement.dataset.motion = 'reduced';
  set(60, 0, 't-two');
  expect(animate).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
