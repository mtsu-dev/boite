import { markFeature } from '@boite/contracts';
import type { ContactRequest, HeldContactLetter } from '@boite/contracts';

/**
 * What contacts ask, as Activity and its count read it: identical asks from
 * one contact (an agent that retried, or asked each of your machines) are one
 * fact, one row with how many came in, oldest first like the rest.
 */
export type InboxAsk = { machine: { id: string }; createdAt: number }
  & ({ request: ContactRequest; letter?: undefined } | { letter: HeldContactLetter; request?: undefined });

/**
 * The key identical asks share: who asks (their core, whichever machine of yours
 * they asked) and the words; a letter also keeps its machine and thread, since
 * it is for one conversation there.
 */
export function askKey(row: InboxAsk): string {
  return row.request
    ? JSON.stringify(['request', row.request.coreId, row.request.text.trim()])
    : JSON.stringify(['mail', row.machine.id, row.letter.contact, row.letter.thread, row.letter.text.trim()]);
}

/** One entry per fact: the newest ask stands for its group (the one an answer goes to), `same` holds them all, oldest first. */
export function mergeAsks<R extends InboxAsk>(rows: readonly R[]): { row: R; same: R[] }[] {
  const groups = new Map<string, R[]>();
  for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = askKey(row);
    groups.set(key, [...groups.get(key) ?? [], row]);
  }
  return [...groups.values()].map(same => ({ row: same.at(-1)!, same }));
}

// Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
markFeature('boite-feature:contacts');
