import { expect, test } from 'vitest';
import { dangerLast, separator, type MenuItem } from './menu';

const ids = (items: MenuItem[]) => items.map((item) => item.id);

test('a destructive row goes last behind a rule, and a list already ending on it is left as it was', () => {
  const tail = [{ id: 'edit', label: 'Edit' }, separator('sep'), { id: 'remove', label: 'Remove', danger: true }];
  expect(dangerLast(tail)).toBe(tail);
  expect(ids(dangerLast([{ id: 'remove', label: 'Remove', danger: true }, { id: 'edit', label: 'Edit' }, { id: 'copy', label: 'Copy' }])))
    .toEqual(['edit', 'copy', 'sep-danger', 'remove']);
});
