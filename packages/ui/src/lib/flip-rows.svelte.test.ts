import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { flipRows, slideRows } from './flip-rows.svelte';

const ROW = 40;

/** A list whose rows sit one under the other in DOM order, as jsdom draws no layout. */
function list(keys: string[]): HTMLElement {
  const root = document.createElement('div');
  root.style.setProperty('--dur-3', '220ms');
  root.style.setProperty('--ease-out-quint', 'cubic-bezier(0.22, 1, 0.36, 1)');
  root.getBoundingClientRect = () => new DOMRect(0, 0, 300, 400);
  order(root, keys);
  document.body.append(root);
  return root;
}

function order(root: HTMLElement, keys: string[]): void {
  const known = new Map([...root.children].map(node => [(node as HTMLElement).dataset['windowKey']!, node as HTMLElement]));
  root.replaceChildren(...keys.map(key => {
    const node = known.get(key) ?? document.createElement('div');
    node.dataset['windowKey'] = key;
    node.getBoundingClientRect = () => new DOMRect(0, [...root.children].indexOf(node) * ROW, 300, ROW);
    return node;
  }));
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset['motion'];
  vi.restoreAllMocks();
});

/**
 * Round 6: a thread that left Working for Needs you vanished from one band and
 * reappeared in the other. Its row now slides from where it was, on `--dur-3`
 * and the app's out easing.
 */
test('a row that changes place slides from its old one, and a new row just appears', () => {
  const root = list(['a', 'b', 'c']);
  const animate = vi.spyOn(Element.prototype, 'animate');
  const before = new Map([['a', 0], ['b', ROW], ['c', 2 * ROW]]);
  order(root, ['c', 'a', 'b', 'd']);
  expect(slideRows(root, before)).toBe(3);
  const moved = animate.mock.contexts.map(node => (node as HTMLElement).dataset['windowKey']);
  expect(moved).toEqual(['c', 'a', 'b']);
  expect(animate.mock.calls[0]).toEqual([[{ transform: `translateY(${2 * ROW}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }]);
});

test('nothing slides under reduced motion or a zero duration', () => {
  const root = list(['a', 'b']);
  const animate = vi.spyOn(Element.prototype, 'animate');
  const before = new Map([['a', ROW], ['b', 0]]);
  document.documentElement.dataset['motion'] = 'reduced';
  expect(slideRows(root, before)).toBe(0);
  delete document.documentElement.dataset['motion'];
  vi.spyOn(window, 'matchMedia').mockImplementation(media => ({ matches: media.includes('reduce'), media } as MediaQueryList));
  expect(slideRows(root, before)).toBe(0);
  vi.mocked(window.matchMedia).mockRestore();
  root.style.setProperty('--dur-3', '0.01ms');
  expect(slideRows(root, before)).toBe(0);
  expect(animate).not.toHaveBeenCalled();
});

test('the rows slide when their order changes, not when the list drawn changes', () => {
  const root = list(['a', 'b']);
  const animate = vi.spyOn(Element.prototype, 'animate');
  let keys = $state(['a', 'b']);
  let scope = $state('recent');
  const stop = $effect.root(() => {
    flipRows(() => root, () => keys.join(), () => scope);
    // Stands for the list's own drawing, which runs after the snapshot and before the slide.
    $effect.pre(() => { order(root, keys); });
  });
  flushSync();
  expect(animate).not.toHaveBeenCalled();
  keys = ['b', 'a'];
  flushSync();
  expect(animate).toHaveBeenCalledTimes(2);
  scope = 'projects';
  keys = ['a', 'b'];
  flushSync();
  expect(animate).toHaveBeenCalledTimes(2);
  stop();
});
