import { expect, test } from 'vitest';
import { opensByItself, workingFit, workingHeight } from './inbox-fit';

test('the open work is five rows at most, then its See all line', () => {
  expect(workingHeight(2)).toBe(68);
  expect(workingHeight(5)).toBe(170);
  expect(workingHeight(13)).toBe(204);
});

test('the rows fit in the column under the composer and the free room over the sentence, never in a hidden column', () => {
  // Round 13 at 1440x900: 406 px drawn and three rows in a 489 px column, 93 px free over the sentence.
  expect(workingFit({ count: 3, drawn: 406, column: 489, top: 0, spare: 0 })).toBeNull();
  expect(workingFit({ count: 3, drawn: 406, column: 489, top: 0, spare: 93 })).toBe(508);
  // Dense: thirteen at work need five rows and See all, more than the room has.
  expect(workingFit({ count: 13, drawn: 406, column: 489, top: 0, spare: 93 })).toBeNull();
  // What the column draws over the Inbox counts against it.
  expect(workingFit({ count: 2, drawn: 200, column: 240, top: 10, spare: 40 })).toBe(278);
  expect(workingFit({ count: 2, drawn: 200, column: 240, top: 20, spare: 40 })).toBeNull();
  // A phone's home hides the column: no room, whatever is free elsewhere.
  expect(workingFit({ count: 2, drawn: 0, column: 0, top: 0, spare: 500 })).toBeNull();
  expect(workingFit({ count: 0, drawn: 0, column: 600, top: 0, spare: 0 })).toBeNull();
});

test('a cut list waits folded even when five rows and See all would fit', () => {
  // Round 13b dense at 1440x900: thirteen at work, 610 px with the free room, 204 px of rows fit, the lane opened.
  const dense = workingFit({ count: 13, drawn: 300, column: 489, top: 0, spare: 121 });
  expect(dense).toBe(504);
  expect(opensByItself(13, dense)).toBe(false);
  expect(opensByItself(5, workingFit({ count: 5, drawn: 300, column: 489, top: 0, spare: 0 }))).toBe(true);
  expect(opensByItself(3, null)).toBe(false);
});
