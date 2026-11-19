import type { Journal } from '../src/journal.ts';

/**
 * The events of `journal`, of `type` when given. By type it reads the whole
 * events table, so it lives with the tests, never on the core's event loop.
 */
export function countEvents(journal: Journal, type?: string): number {
  const row = type === undefined
    ? journal.db.query('SELECT COUNT(*) AS n FROM events').get() as { n: number }
    : journal.db.query('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as { n: number };
  return row.n;
}
