import { expect, test } from 'vitest';
import { lineCount, wordCut } from './word-fit';

// One unit per character: widths a test can count.
const measure = (text: string): number => text.length;

test('a title too long for its line ends on a whole word, never inside one', () => {
  const title = 'Add CSV import to the contacts page';
  expect(wordCut(title, 40, 1, measure)).toBe(title);
  // The browser's own cut read "Add CSV import to the contacts p".
  expect(wordCut(title, 32, 1, measure)).toBe('Add CSV import to the contacts\u2026');
  expect(wordCut(title, 12, 1, measure)).toBe('Add CSV\u2026');
  // Punctuation does not hang before the ellipsis.
  expect(wordCut('Fix it, then ship the build', 12, 1, measure)).toBe('Fix it\u2026');
  // A first word wider than the line is left whole for the CSS ellipsis.
  expect(wordCut('Supercalifragilistic word', 8, 1, measure)).toBe('Supercalifragilistic word');
});

test('a clamped title fills its lines before the cut', () => {
  const title = 'Rework the onboarding flow so a new user sees the first project';
  expect(lineCount(title, 30, measure)).toBe(3);
  const cut = wordCut(title, 30, 2, measure);
  expect(lineCount(cut, 30, measure)).toBeLessThanOrEqual(2);
  expect(cut).toBe('Rework the onboarding flow so a new user sees the first\u2026');
  // A word longer than a line breaks inside it, the way overflow-wrap does.
  expect(lineCount('a verylongwordthatbreaks', 10, measure)).toBe(4);
});
