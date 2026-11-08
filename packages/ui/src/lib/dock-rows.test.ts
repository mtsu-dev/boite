import { expect, test } from 'vitest';
import { dockRows } from './dock-rows';

test('a lone entry wider than a 360 px strip keeps its name, never a "+1"', () => {
  expect(dockRows([420], 290)).toEqual({ rows: [[0]], hidden: 0 });
});

test('names that do not fit whole narrow before anything is counted, and one or two left over get a row of their own', () => {
  // Whole, the three need three rows; short, two share the first.
  expect(dockRows([170, 180, 150], 290)).toEqual({ rows: [[0, 1], [2]], hidden: 0 });
  // Six short entries hold two rows of two; the fifth and sixth keep their names on a third.
  expect(dockRows([200, 200, 200, 200, 200, 200], 250)).toEqual({ rows: [[0, 1], [2, 3], [4, 5]], hidden: 0 });
});

test('three or more left over become one "+N" on the last row', () => {
  const { rows, hidden } = dockRows([200, 200, 200, 200, 200, 200, 200], 250);
  expect(rows).toEqual([[0, 1], [2]]);
  expect(hidden).toBe(4);
});
