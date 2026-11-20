import type { AccountQuota } from '@boite/contracts';
import { quotaAccountName } from './quota-reader.svelte';

/** From this share on, a use of the account Douane cannot explain is worth a notice outside the limits view. */
const OUTSIDE_NOTICE_PERCENT = 10;

export interface OutsideNotice { account: string; provider: string; percent: number }

/**
 * The account whose limits Douane explains least: the largest share of any of
 * its windows used outside Douane, at least `OUTSIDE_NOTICE_PERCENT`. A tie
 * keeps the first row, so the notice does not hop between accounts. A window
 * whose reset has passed is left out: its figure was the past window's.
 */
export function outsideNotice(rows: readonly AccountQuota[], now = Date.now()): OutsideNotice | null {
  let found: OutsideNotice | null = null;
  for (const row of rows) {
    for (const window of row.windows) {
      const percent = window.outsidePercent;
      if (percent === undefined || percent < OUTSIDE_NOTICE_PERCENT || (window.resetsAt !== null && window.resetsAt <= now) || (found && found.percent >= percent)) continue;
      found = { account: quotaAccountName(row), provider: row.providerName, percent };
    }
  }
  return found;
}
