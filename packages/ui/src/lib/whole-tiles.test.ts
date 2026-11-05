import { expect, test } from 'vitest';
import { PEEK_MAX, PEEK_MIN, PEEK_SHARE, peekGrow, wholeTiles } from './whole-tiles';

const START = 4;
const GAP = 2;

/** The strip's tiles laid out from its left padding, each grown by `grow`. */
function layout(widths: number[], grow = 0): { left: number; width: number }[] {
  let left = START;
  return widths.map((natural) => {
    const tile = { left, width: natural + grow };
    left += tile.width + GAP;
    return tile;
  });
}

/** What shows of the tile the strip's end crosses, as a share of its width; 0 when the end falls between two tiles. */
function endShare(edge: number, tiles: { left: number; width: number }[]): number {
  const crossing = tiles.find((tile) => tile.left + tile.width > edge);
  if (!crossing) return 1;
  return crossing.left < edge ? (edge - crossing.left) / crossing.width : 0;
}

test('the 360 px strip that cut its fifth tile to a 6 px sliver shows a tile by half', () => {
  const widths = [64, 60, 70, 60, 60, 60];
  const edge = layout(widths)[4]!.left + 6;
  expect(endShare(edge, layout(widths))).toBeLessThan(PEEK_MIN);
  const grow = peekGrow(edge, layout(widths));
  expect(grow).toBeGreaterThan(0);
  expect(endShare(edge, layout(widths, grow))).toBeCloseTo(PEEK_SHARE, 5);
});

test('a strip whose end falls between two tiles, the next one hidden with no cue, shows a tile by half', () => {
  const widths = [64, 60, 70, 60, 60, 60];
  const edge = layout(widths)[4]!.left - 1;
  expect(endShare(edge, layout(widths))).toBe(0);
  expect(endShare(edge, layout(widths, peekGrow(edge, layout(widths))))).toBeCloseTo(PEEK_SHARE, 5);
});

test('a tile already shown by 40% to 80%, or a strip that holds every tile, keeps the natural widths', () => {
  const widths = [64, 60, 70, 60, 60, 60];
  const tiles = layout(widths);
  expect(peekGrow(tiles[3]!.left + 0.4 * 60, tiles)).toBe(0);
  expect(peekGrow(tiles[3]!.left + 0.8 * 60, tiles)).toBe(0);
  expect(peekGrow(tiles.at(-1)!.left + 60, tiles)).toBe(0);
});

test('at any phone width and provider mix, the strip end shows a tile by 40% to 80%', () => {
  const mixes = [[64, 60, 70, 60, 60, 60], [64, 60, 70, 92, 60, 60, 60, 60], [60, 60, 60, 60, 60, 60, 60], [64, 92, 92, 92, 92]];
  for (const widths of mixes) {
    const end = layout(widths).at(-1)!;
    for (let edge = 120; edge < end.left + end.width; edge += 1) {
      const grow = peekGrow(edge, layout(widths));
      expect(grow, `${widths} at ${edge}`).toBeGreaterThanOrEqual(0);
      expect(endShare(edge, layout(widths, grow)), `${widths} at ${edge}`).toBeGreaterThanOrEqual(PEEK_MIN - 1e-9);
      expect(endShare(edge, layout(widths, grow)), `${widths} at ${edge}`).toBeLessThanOrEqual(PEEK_MAX + 1e-9);
    }
  }
});

/** A phone strip as wholeTiles sees it: jsdom has no layout, so the rail's width and its tiles' natural boxes are given. */
function strip(clientWidth: number, widths: number[]): HTMLElement {
  const rail = document.createElement('div');
  rail.style.paddingRight = '24px';
  Object.defineProperty(rail, 'clientWidth', { value: clientWidth });
  for (const { left, width } of layout(widths)) {
    const tile = document.createElement('button');
    tile.dataset.row = '';
    Object.defineProperty(tile, 'offsetLeft', { value: left });
    Object.defineProperty(tile, 'offsetWidth', { value: width });
    rail.append(tile);
  }
  document.body.append(rail);
  return rail;
}

test('on 360 and 390 px phones the end tile shows by 40% to 80% before the 24 px fade starts, not only before the strip edge', () => {
  // The showcase's strip, measured in Chrome: Favorites, Claude, OpenCode, Codex, pi, Grok, Muse Code.
  // At 360 (353 px wide) pi ran 1 px into the fade and Grok showed only inside it; the r6 pack's sheet put pi 11 of its 70 px clear of it.
  const shown = [65, 60, 73, 60, 60, 60, 77];
  for (const [clientWidth, widths] of [[353, shown], [383, shown], [334, [60, 60, 60, 68, 60, 60]]] as const) {
    const rail = strip(clientWidth, [...widths]);
    const action = wholeTiles(rail, { cell: () => 0, cue: 20, tiles: '[data-row]', wideOnly: '(min-width: 721px)' });
    const grow = parseFloat(rail.style.getPropertyValue('--tile-grow') || '0');
    const share = endShare(clientWidth - 24, layout([...widths], grow));
    expect(share, `${clientWidth}`).toBeGreaterThanOrEqual(PEEK_MIN - 1e-9);
    expect(share, `${clientWidth}`).toBeLessThanOrEqual(PEEK_MAX + 1e-9);
    action.destroy();
    rail.remove();
  }
});

test('a phone strip says a tile waits past its end only while one does, so its fade never dims the last tile scrolled whole', () => {
  // Muse r11: at 390 Grok read cut with no cue, at 360 it was gone; the fade marks the end that can still scroll.
  const rail = strip(353, [65, 60, 73, 60, 60, 60, 77]);
  let scrollLeft = 0;
  Object.defineProperty(rail, 'scrollWidth', { value: 540 });
  Object.defineProperty(rail, 'scrollLeft', { get: () => scrollLeft, set: (value: number) => { scrollLeft = value; } });
  const action = wholeTiles(rail, { cell: () => 0, cue: 20, tiles: '[data-row]', wideOnly: '(min-width: 721px)' });
  expect(rail.dataset.moreEnd).toBe('true');
  scrollLeft = 540 - 353;
  rail.dispatchEvent(new Event('scroll'));
  expect(rail.dataset.moreEnd).toBeUndefined();
  scrollLeft = 60;
  rail.dispatchEvent(new Event('scroll'));
  expect(rail.dataset.moreEnd).toBe('true');
  action.destroy();
  rail.remove();
  // A strip that holds every tile has nothing past its end.
  const whole = strip(353, [60, 60, 60]);
  Object.defineProperty(whole, 'scrollWidth', { value: 353 });
  const fits = wholeTiles(whole, { cell: () => 0, cue: 20, tiles: '[data-row]', wideOnly: '(min-width: 721px)' });
  expect(whole.dataset.moreEnd).toBeUndefined();
  fits.destroy();
  whole.remove();
});
