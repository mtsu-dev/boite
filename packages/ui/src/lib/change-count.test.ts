import { expect, test } from 'vitest';
import { changeCount, changeText } from './change-count';

// The chat said "+2-1", the panel "6 changed files" and its rows "-2": one phrase now, its minus a real minus sign.
test('a set of changes reads "1 file, +7 −2", an empty or unknown side left out', () => {
  expect(changeText(changeCount(1, 7, 2))).toBe('1 file, +7 −2');
  expect(changeText(changeCount(6, 12, 0))).toBe('6 files, +12');
  expect(changeText(changeCount(null, 0, 3))).toBe('−3');
  expect(changeText(changeCount(2, null, null))).toBe('2 files');
  expect(changeText(changeCount(null, 0, 0))).toBe('');
});
