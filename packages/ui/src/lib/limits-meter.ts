import type { AccountQuota } from '@boite/contracts';
import { quotaAccountName, quotaCredits, quotaTone, remainingPercent } from './quota-reader.svelte';

/**
 * What the list's limits line has to say, when it has anything to say: a
 * provider (or one of its models) that no account can serve any more, or the
 * little its best account has left.
 */
export interface LimitsNotice {
  /** `out`: nothing left on any account. `low`: the best account runs low. */
  kind: 'out' | 'low';
  provider: string;
  /** The window that binds, as the core labels it. */
  window: string;
  /** The window is one model's or one group's (`Fable weekly`), not the whole account's. */
  scoped: boolean;
  /** What the best account has left in that window, whole percent; 0 when out. */
  left: number;
  /** Out: when the first account serves again, null when no reset is known. */
  until: number | null;
  /** The best account's name. */
  account: string;
  /** How many accounts were counted: the line names the account past one. */
  accounts: number;
}

/** A window that bounds the whole account: a bare period, no model or group named. */
function general(label: string): boolean {
  return label.split(' · ').every((part) => /^(\d+(\.\d+)? hours|Daily|Weekly|Monthly|Credits|Quota)$/.test(part));
}

/** What one account can still give to a scope (a model's window, or everything), and the window that says so. */
interface Room { row: AccountQuota; left: number; window: string; scoped: boolean; resetsAt: number | null }

/**
 * An account's room for `scope`: the least left among its account-wide windows
 * and that scope's own window. Null when nothing is known of it (no reading)
 * or when it keeps serving past its windows (credits): such an account is
 * never counted out.
 */
function room(row: AccountQuota, scope: string | null): Room | null {
  if (row.windows.length === 0 || quotaCredits(row) !== null) return null;
  let found: Room | null = null;
  for (const window of row.windows) {
    const wide = general(window.label);
    if (!wide && window.label !== scope) continue;
    const left = remainingPercent(window.usedPercent);
    // Among spent windows the latest reset is the one to wait for.
    const later = found !== null && left === 0 && found.left === 0 && (window.resetsAt === null || (found.resetsAt !== null && window.resetsAt > found.resetsAt));
    if (found === null || left < found.left || later) found = { row, left, window: window.label, scoped: !wide, resetsAt: window.resetsAt };
  }
  return found;
}

/**
 * The accounts that can stand in for each other: a subscription gateway's
 * entries of one provider (it moves work to another by itself), and the
 * accounts signed in here for one provider (another is one pick away). An
 * entry the gateway cannot use (disabled, in error) is left out while another
 * can serve.
 */
function groups(rows: readonly AccountQuota[]): AccountQuota[][] {
  const found = new Map<string, AccountQuota[]>();
  for (const row of rows) {
    const key = `${row.gateway ? `gateway:${row.gateway.kind}` : 'here'}:${row.providerId}`;
    found.set(key, [...(found.get(key) ?? []), row]);
  }
  return [...found.values()].map((members) => {
    const usable = members.filter((row) => !row.gateway || row.gateway.status === 'ready' || row.gateway.status === 'cooldown');
    return usable.length > 0 ? usable : members;
  });
}

/**
 * The one thing worth a line, or null when every provider can still work:
 * - a provider no account can serve (each one spent in some account-wide
 *   window), until the first of them resets;
 * - one model's window spent on every account that has it, the others too;
 * - the best account of a provider below the low mark (`quotaTone`).
 * One account at 0 % says nothing while another of the same provider has
 * room: a gateway switches by itself, so nothing is blocked. Out comes before
 * low, the whole provider before one model, then the least left.
 */
export function limitsNotice(rows: readonly AccountQuota[]): LimitsNotice | null {
  const notices: LimitsNotice[] = [];
  for (const members of groups(rows)) {
    const scopes: (string | null)[] = [null, ...new Set(members.flatMap((row) => row.windows.map((window) => window.label).filter((label) => !general(label))))];
    let wholeOut = false;
    for (const scope of scopes) {
      const rooms = members.map((row) => room(row, scope));
      // An account nothing is known of may still serve: nothing to announce.
      if (rooms.some((entry) => entry === null)) continue;
      const known = rooms as Room[];
      if (known.length === 0) continue;
      // A model's window says nothing more once the whole provider is out.
      if (scope !== null && (wholeOut || !known.some((entry) => entry.scoped))) continue;
      const best = known.reduce((a, b) => (b.left > a.left ? b : a));
      const tone = quotaTone(100 - best.left);
      if (tone === 'ok') continue;
      const resets = known.map((entry) => entry.resetsAt).filter((at): at is number => at !== null);
      if (tone === 'out' && scope === null) wholeOut = true;
      notices.push({
        kind: tone, provider: best.row.providerName, window: best.window, scoped: scope !== null, left: Math.floor(best.left),
        until: tone === 'out' && resets.length === known.length ? Math.min(...resets) : null,
        account: quotaAccountName(best.row), accounts: known.length,
      });
    }
  }
  const rank = (notice: LimitsNotice) => (notice.kind === 'out' ? 0 : 2) + (notice.scoped ? 1 : 0);
  notices.sort((a, b) => rank(a) - rank(b) || a.left - b.left);
  return notices[0] ?? null;
}
