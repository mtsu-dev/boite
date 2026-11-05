import { expect, test } from 'vitest';
import { homeFit, workingHeight, type HomeRoom } from './inbox-fit';

const room = (patch: Partial<HomeRoom>): HomeRoom => ({ count: 0, asks: 0, shown: 0, pitch: 66, drawn: 0, column: 0, top: 0, spare: 0, fold: null, ...patch });

test('the open work is five rows at most, then its See all line', () => {
  expect(workingHeight(2)).toBe(68);
  expect(workingHeight(5)).toBe(170);
  expect(workingHeight(13)).toBe(204);
});

test('the rows fit in the column under the composer and the free room over the sentence, never in a hidden column', () => {
  // Round 13 at 1440x900: 406 px drawn and three rows in a 489 px column, 93 px free over the sentence.
  expect(homeFit(room({ count: 3, drawn: 406, column: 489 }))).toEqual({ cards: 0, open: false, height: null });
  expect(homeFit(room({ count: 3, drawn: 406, column: 489, spare: 93 }))).toEqual({ cards: 0, open: true, height: 508 });
  // What the column draws over the Inbox counts against it.
  expect(homeFit(room({ count: 2, drawn: 200, column: 240, top: 10, spare: 40 })).height).toBe(278);
  expect(homeFit(room({ count: 2, drawn: 200, column: 240, top: 20, spare: 40 })).open).toBe(false);
  // A phone's home hides the column: no room, whatever is free elsewhere.
  expect(homeFit(room({ count: 2, column: 0, spare: 500 }))).toEqual({ cards: 0, open: false, height: null });
  expect(homeFit(room({ column: 600 })).open).toBe(false);
});

test('a long lane is tested at the height it draws, five rows and its More line, not vetoed for its length', () => {
  // Round 14 dense at 1440x900: thirteen at work stayed folded over about 300 empty px.
  expect(homeFit(room({ count: 13, drawn: 300, column: 489, spare: 121 }))).toEqual({ cards: 0, open: true, height: 504 });
  expect(homeFit(room({ count: 13, drawn: 300, column: 489, spare: 10 })).open).toBe(false);
});

test('Needs you takes the room first, three cards at least and six at most, then the work opens in what is left', () => {
  // Nine asking, three cards drawn (300 px with the lanes), 310 px free: three more cards (198 px), 112 left, too little for 204 px of work.
  expect(homeFit(room({ count: 13, asks: 9, shown: 3, drawn: 300, column: 489, spare: 121 }))).toEqual({ cards: 6, open: false, height: 498 });
  // A taller room holds the six cards and then the work.
  expect(homeFit(room({ count: 13, asks: 9, shown: 3, drawn: 300, column: 600, spare: 121 }))).toEqual({ cards: 6, open: true, height: 702 });
  // Room for one card more only: four, the work folded.
  expect(homeFit(room({ count: 13, asks: 9, shown: 3, drawn: 300, column: 380 }))).toEqual({ cards: 4, open: false, height: 366 });
  // Never fewer than three, never more cards than ask.
  expect(homeFit(room({ asks: 9, shown: 3, drawn: 600, column: 489 })).cards).toBe(3);
  expect(homeFit(room({ asks: 4, shown: 3, drawn: 300, column: 900 })).cards).toBe(4);
  // Measured again with six already drawn, the answer stays the same.
  expect(homeFit(room({ count: 13, asks: 9, shown: 6, drawn: 498, column: 489, spare: 121 }))).toEqual({ cards: 6, open: false, height: 498 });
});

test("the user's own fold wins: open keeps the work's room before the cards, closed gives it all to them", () => {
  const dense = { count: 13, asks: 9, shown: 3, drawn: 300, column: 489, spare: 121 };
  expect(homeFit(room({ ...dense, fold: 'open' }))).toEqual({ cards: 4, open: true, height: 570 });
  expect(homeFit(room({ ...dense, count: 2, fold: 'closed' }))).toEqual({ cards: 6, open: false, height: 498 });
  // A fold changed under the cards keeps them where they are.
  expect(homeFit(room({ ...dense, shown: 6, drawn: 498, fold: 'open', cards: 6 }))).toEqual({ cards: 6, open: true, height: null });
});
