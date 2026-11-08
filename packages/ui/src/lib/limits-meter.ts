import type { AccountQuota } from '@boite/contracts';
import { quotaAccountName, quotaTone, remainingPercent } from './quota-reader.svelte';

/**
 * What the rail's Limits button reads in its gauge: the least any shown
 * account has left in any of its windows, since that is the one that stops
 * work first. Null with nothing read yet, so the button keeps its glyph.
 */
export function lowestLimit(rows: readonly AccountQuota[]): { left: number; tone: 'ok' | 'low' | 'out'; account: string; window: string } | null {
  let lowest: { left: number; used: number; row: AccountQuota; window: string } | null = null;
  for (const row of rows) for (const window of row.windows) {
    const left = remainingPercent(window.usedPercent);
    if (lowest === null || left < lowest.left) lowest = { left, used: window.usedPercent, row, window: window.label };
  }
  return lowest && { left: Math.floor(lowest.left), tone: quotaTone(lowest.used), account: quotaAccountName(lowest.row), window: lowest.window };
}
