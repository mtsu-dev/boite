import { expect, test } from 'vitest';
import { listAbsent } from './list-absent';

const machine = (over: Partial<{ connection: string; projects: unknown[]; draftEntries: unknown[] }> = {}) =>
  ({ connection: 'ready', projects: [], draftEntries: [], ...over }) as never;

test('the desktop list column is absent only before the first project, once every machine answered', () => {
  expect(listAbsent([machine()], false)).toBe(true);
  // A phone keeps its drawer; a project, a draft or a machine still connecting keeps the column.
  expect(listAbsent([machine()], true)).toBe(false);
  expect(listAbsent([machine(), machine({ projects: [{}] })], false)).toBe(false);
  expect(listAbsent([machine({ draftEntries: [{}] })], false)).toBe(false);
  expect(listAbsent([machine({ connection: 'connecting' })], false)).toBe(false);
  expect(listAbsent([], false)).toBe(false);
});
