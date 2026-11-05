import { afterEach, expect, test } from 'vitest';
import { fitLines, lastLine } from './last-line';

afterEach(() => { document.body.innerHTML = ''; });

/** jsdom has no layout: each part reports the sizes a browser would give it. */
function draw(sizes: { cluster: number; lines: number; overflow?: boolean }) {
  const line = document.createElement('span');
  line.innerHTML = '<span data-last-line="title" style="line-height: 18px">Retry failed syncs when the network drops<span data-last-line="room"></span></span><span data-last-line="cluster">2h</span>';
  document.body.append(line);
  const title = line.querySelector<HTMLElement>('[data-last-line=title]')!;
  const cluster = line.querySelector<HTMLElement>('[data-last-line=cluster]')!;
  const height = 18 * sizes.lines;
  Object.defineProperties(cluster, { offsetWidth: { get: () => sizes.cluster } });
  Object.defineProperties(title, {
    clientHeight: { get: () => height },
    scrollHeight: { get: () => (sizes.overflow ? height + 18 : height) },
    clientWidth: { get: () => 240 },
    scrollWidth: { get: () => 240 }
  });
  const action = lastLine(line, 'Retry failed syncs when the network drops');
  return { line, action };
}

test('a wrapped title gives its last line the cluster\'s room, and narrows every line only once its text overflows', () => {
  // Round 14: "Retry failed syncs when the 2h / network drops" put the age on the first line.
  const wrapped = draw({ cluster: 26, lines: 2 });
  fitLines([wrapped.line]);
  expect(wrapped.line.style.getPropertyValue('--room')).toBe('26px');
  expect(wrapped.line.dataset.drawn).toBe('2');
  expect(wrapped.line.dataset.fit).toBeUndefined();

  const long = draw({ cluster: 40, lines: 2, overflow: true });
  fitLines([long.line]);
  expect(long.line.dataset.fit).toBe('narrow');

  // A row that stops wrapping (no longer needs the user) loses its room and its marks.
  wrapped.action.update(null);
  expect(wrapped.line.style.getPropertyValue('--room')).toBe('');
  expect(wrapped.line.dataset.drawn).toBeUndefined();
  fitLines([wrapped.line]);
  expect(wrapped.line.dataset.drawn).toBeUndefined();
});
