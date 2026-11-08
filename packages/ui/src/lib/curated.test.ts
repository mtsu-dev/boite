import { expect, test } from 'vitest';
import { curated } from './curated';

const ids = (list: { id: string }[]) => list.map((option) => option.id);
const options = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id }));

test('the one in use always stands in front, with the first others, in the list\'s order', () => {
  expect(ids(curated(options, 'a', 4))).toEqual(['a', 'b', 'c', 'd']);
  // A choice from the back keeps its place in the order, ahead of nothing it was behind.
  expect(ids(curated(options, 'f', 4))).toEqual(['a', 'b', 'c', 'f']);
  // Edited colours match no option: the first ones fill the front.
  expect(ids(curated(options, undefined, 4))).toEqual(['a', 'b', 'c', 'd']);
  expect(ids(curated(options.slice(0, 3), 'c', 4))).toEqual(['a', 'b', 'c']);
});
