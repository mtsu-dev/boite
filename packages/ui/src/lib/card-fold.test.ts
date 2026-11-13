import { expect, test } from 'vitest';
import { foldQuiet } from './card-fold';

const live = (row: string) => row.startsWith('!');

test('a big card keeps every row with something to say, fills up to three with quiet ones and folds the rest', () => {
  expect(foldQuiet(['a', '!b', 'c', 'd', '!e', 'f'], live)).toEqual({ shown: ['a', '!b', '!e'], folded: ['c', 'd', 'f'] });
  // Needs-you rows are never folded, however many.
  expect(foldQuiet(['!a', '!b', '!c', '!d', 'e', 'f'], live)).toEqual({ shown: ['!a', '!b', '!c', '!d'], folded: ['e', 'f'] });
});

test('a small card folds nothing, and one quiet row is never folded alone', () => {
  expect(foldQuiet(['a', 'b', 'c'], live).folded).toEqual([]);
  expect(foldQuiet(['a', 'b', 'c', 'd'], live)).toEqual({ shown: ['a', 'b', 'c', 'd'], folded: [] });
});
