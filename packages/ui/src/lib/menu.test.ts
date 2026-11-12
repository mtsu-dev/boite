import { expect, test } from 'vitest';
import { dangerLast, separator, type MenuItem } from './menu';

const ids = (items: MenuItem[]) => items.map((item) => item.id);

test('a destructive row goes last behind a rule, and a list already ending on it is left as it was', () => {
  const tail = [{ id: 'edit', label: 'Edit' }, separator('sep'), { id: 'remove', label: 'Remove', danger: true }];
  expect(dangerLast(tail)).toBe(tail);
  expect(ids(dangerLast([{ id: 'remove', label: 'Remove', danger: true }, { id: 'edit', label: 'Edit' }, { id: 'copy', label: 'Copy' }])))
    .toEqual(['edit', 'copy', 'sep-danger', 'remove']);
});

test('the rules a moved destructive row leaves behind neither open the menu nor double up', () => {
  const remove = { id: 'remove', label: 'Remove', danger: true };
  expect(ids(dangerLast([remove, separator('a'), { id: 'edit', label: 'Edit' }]))).toEqual(['edit', 'sep-danger', 'remove']);
  expect(ids(dangerLast([{ id: 'edit', label: 'Edit' }, separator('a'), remove, separator('b'), { id: 'copy', label: 'Copy' }])))
    .toEqual(['edit', 'a', 'copy', 'sep-danger', 'remove']);
});
