import type { AccountQuota } from '@boite/contracts';
import { quotaAccountName, quotaTone, remainingPercent } from './quota-reader.svelte';
import { fill, strings } from './strings';

export interface LowestLimit {
  left: number;
  tone: 'ok' | 'low' | 'out';
  account: string;
  provider: string;
  several: boolean;
  window: string;
  /** Set when the figure is a gateway pool's: how many accounts share the window. */
  pool?: number;
}

/** One figure the gauge may read: an account's window, or a gateway pool's window over its accounts. */
interface Candidate { left: number; row: AccountQuota; window: string; pool?: number }

/**
 * A subscription gateway spreads work over its accounts of one provider: one
 * of them run out stops nothing while the others have room. So its accounts
 * count as one pool per provider, and a window reads what the pool has left on
 * average. An entry the gateway cannot use (disabled, in error) is left out
 * while another can serve.
 */
function pools(rows: readonly AccountQuota[]): Candidate[] {
  const byProvider = new Map<string, AccountQuota[]>();
  for (const row of rows) {
    if (!row.gateway || row.gateway.display === 'average') continue;
    byProvider.set(row.providerId, [...(byProvider.get(row.providerId) ?? []), row]);
  }
  const found: Candidate[] = [];
  for (const members of byProvider.values()) {
    if (members.length < 2) continue;
    const usable = members.filter((row) => row.gateway?.status === 'ready' || row.gateway?.status === 'cooldown');
    const serving = usable.length > 0 ? usable : members;
    const windows = new Map<string, number[]>();
    for (const row of serving) for (const window of row.windows) windows.set(window.label, [...(windows.get(window.label) ?? []), remainingPercent(window.usedPercent)]);
    for (const [window, lefts] of windows) found.push({ left: lefts.reduce((sum, left) => sum + left, 0) / lefts.length, row: serving[0]!, window, pool: lefts.length });
  }
  return found;
}

/**
 * What the rail's Limits button reads in its gauge: the least any shown
 * account has left in any of its windows, since that is the one that stops
 * work first, with whose limit it is: the provider, and whether that provider
 * shows several accounts, so the line names the account too. A gateway's
 * accounts of one provider read as their pool (`pools`), never as the one
 * account that happens to be the emptiest. Null with nothing read yet, so the
 * button keeps its glyph.
 */
export function lowestLimit(rows: readonly AccountQuota[]): LowestLimit | null {
  const pooled = pools(rows);
  const inPool = new Set(pooled.map((entry) => entry.row.providerId));
  const candidates: Candidate[] = [...pooled];
  for (const row of rows) {
    if (row.gateway && row.gateway.display !== 'average' && inPool.has(row.providerId)) continue;
    for (const window of row.windows) candidates.push({ left: remainingPercent(window.usedPercent), row, window: window.label });
  }
  let lowest: Candidate | null = null;
  for (const candidate of candidates) if (lowest === null || candidate.left < lowest.left) lowest = candidate;
  if (!lowest) return null;
  const providerId = lowest.row.providerId;
  const several = rows.filter((row) => row.providerId === providerId).length > 1;
  const account = lowest.pool
    ? fill(strings.subscriptionProxy.average, { name: lowest.row.providerName, count: String(lowest.pool) })
    : quotaAccountName(lowest.row);
  return { left: Math.floor(lowest.left), tone: quotaTone(100 - lowest.left), account, provider: lowest.row.providerName, several, window: lowest.window, ...(lowest.pool ? { pool: lowest.pool } : {}) };
}
