import { expect, test } from 'vitest';
import type { ContactRequest } from '@boite/contracts';
import { mergeAsks } from './contact-inbox';

// An agent that retried, or asked each of the owner's machines, filled Activity with copies of one fact.
test('identical asks merge into one row led by the newest, across machines; other words or contacts stay apart', () => {
  const ask = (id: string, at: number, coreId = 'core-chris', text = 'Open boite?', machine = 'local') =>
    ({ machine: { id: machine }, createdAt: at, request: { id, coreId, contact: 'Chris', text } as unknown as ContactRequest });
  const rows = [ask('b', 2), ask('a', 1), ask('c', 3, 'core-chris', ' Open boite? '), ask('d', 4, 'core-sam'), ask('e', 5, 'core-chris', 'Other'), ask('f', 6, 'core-chris', 'Open boite?', 'pc')];
  const merged = mergeAsks(rows);
  expect(merged.map(entry => [entry.row.request.id, entry.same.map(row => row.request.id)])).toEqual([
    ['f', ['a', 'b', 'c', 'f']], ['d', ['d']], ['e', ['e']],
  ]);
});
