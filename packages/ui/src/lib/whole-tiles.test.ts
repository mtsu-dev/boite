import { expect, test } from 'vitest';
import { PEEK_MIN, PEEK_SHARE, peekGrow } from './whole-tiles';

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

test('a tile already shown by 40% or more, or a strip that holds every tile, keeps the natural widths', () => {
  const widths = [64, 60, 70, 60, 60, 60];
  const tiles = layout(widths);
  expect(peekGrow(tiles[3]!.left + 0.4 * 60, tiles)).toBe(0);
  expect(peekGrow(tiles[3]!.left + 0.9 * 60, tiles)).toBe(0);
  expect(peekGrow(tiles.at(-1)!.left + 60, tiles)).toBe(0);
});

test('at any phone width and provider mix, the strip end never shows a tile by less than 40%', () => {
  const mixes = [[64, 60, 70, 60, 60, 60], [64, 60, 70, 92, 60, 60, 60, 60], [60, 60, 60, 60, 60, 60, 60], [64, 92, 92, 92, 92]];
  for (const widths of mixes) {
    const end = layout(widths).at(-1)!;
    for (let edge = 120; edge < end.left + end.width; edge += 1) {
      const grow = peekGrow(edge, layout(widths));
      expect(grow, `${widths} at ${edge}`).toBeGreaterThanOrEqual(0);
      expect(endShare(edge, layout(widths, grow)), `${widths} at ${edge}`).toBeGreaterThanOrEqual(PEEK_MIN - 1e-9);
    }
  }
});
