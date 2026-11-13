import { afterEach, expect, test } from 'vitest';
import { collapseMs, collapseRow } from './row-collapse';

afterEach(() => { delete document.documentElement.dataset['motion']; document.documentElement.style.removeProperty('--dur-3'); });

test('a row closes in place only when its thread left the list, in the app\'s --dur-3, and reduced motion is a cut', () => {
  document.documentElement.style.setProperty('--dur-3', '220ms');
  const row = document.createElement('div');
  // Folded away, moved, a page change: the thread is still listed, so the row goes at once.
  expect(collapseRow(row, () => false).duration).toBe(0);
  const closing = collapseRow(row, () => true);
  expect(closing.duration).toBe(220);
  expect(closing.css?.(0, 1)).toContain('height: 0px');
  expect(closing.css?.(0, 1)).toContain('opacity: 0');
  document.documentElement.dataset['motion'] = 'reduced';
  expect(collapseRow(row, () => true).duration).toBe(0);
  expect(collapseMs()).toBe(0);
});
