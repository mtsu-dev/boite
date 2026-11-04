import type { ThreadSummary } from '@boite/contracts';
import type { ThreadState } from './thread-state';

/**
 * How many rows a project shows, those that need the user included, before
 * the ones at work and at rest fold under one `n more` row. Rows that need the
 * user never fold, so a busy project leaves room on the first screen for the
 * projects under it.
 */
export const ROW_BUDGET = 6;
export const LANES_STORAGE_KEY = 'boite.sidebar.more.v1';

/** The states that wait on the user's hand: a question, a failure, work that stopped short. */
export function needsHand(state: ThreadState | null): boolean {
  return state === 'waiting' || state === 'error' || state === 'interrupted';
}

const LIVE: ReadonlySet<ThreadState> = new Set(['working', 'queued', 'delegating', 'monitoring', 'background', 'watching']);
export function liveState(state: ThreadState | null): boolean {
  return state !== null && LIVE.has(state);
}

export type Lanes<T> = {
  /** Needs you first, then failed, never folded. */
  needs: T[];
  /** At work and shown inline (the working fold holds the rest), within the budget. */
  live: T[];
  /** At rest by recency, within what the budget leaves. */
  rest: T[];
  /** The rows past the budget, drawn only once `n more` opens. */
  hidden: T[];
  /** How many of `hidden` are at work, for the `n more` row's chip. */
  hiddenLive: number;
  /** How many rows the budget folds, opened or not: an opened project offers `Show fewer` while this is above 0. */
  foldable: number;
};

/**
 * Splits a project's drawn rows into lanes. `rows` arrive sorted (pins, then
 * activity); `keep` marks a row that never folds away: the open thread, a pin,
 * an unsent draft. Rows at work take the budget before rows at rest; folded
 * rows keep their order.
 */
export function threadLanes<T>(rows: readonly T[], stateOf: (row: T) => ThreadState | null, options: { expanded?: boolean; keep?: (row: T) => boolean; budget?: number } = {}): Lanes<T> {
  const waiting: T[] = [], failed: T[] = [], working: T[] = [], resting: T[] = [];
  for (const row of rows) {
    const state = stateOf(row);
    if (state === 'waiting') waiting.push(row);
    else if (needsHand(state)) failed.push(row);
    else if (liveState(state)) working.push(row);
    else resting.push(row);
  }
  const needs = [...waiting, ...failed];
  let room = Math.max(0, (options.budget ?? ROW_BUDGET) - needs.length);
  // A kept row past the budget takes no slot of its own: it already shows, so `n more` counts only what it hides.
  const split = (lane: T[]) => {
    const shown: T[] = [], folded: T[] = [];
    for (const row of lane) {
      if (room > 0) { shown.push(row); room -= 1; }
      else if (options.keep?.(row)) shown.push(row);
      else folded.push(row);
    }
    return [shown, folded] as const;
  };
  const [live, liveFolded] = split(working);
  const [rest, restFolded] = split(resting);
  const foldable = liveFolded.length + restFolded.length;
  if (options.expanded) return { needs, live: working, rest: resting, hidden: [], hiddenLive: 0, foldable };
  return { needs, live, rest, hidden: [...liveFolded, ...restFolded], hiddenLive: liveFolded.length, foldable };
}

/** Which projects have their `n more` row opened, remembered on this screen across reloads. */
export class MoreRows {
  open = $state<string[]>([]);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(LANES_STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) this.open = saved.filter((key): key is string => typeof key === 'string');
    }
    catch { /* Every project starts folded when storage is unavailable. */ }
  }

  isOpen(key: string): boolean {
    return this.open.includes(key);
  }

  toggle(key: string): void {
    this.open = this.isOpen(key) ? this.open.filter(value => value !== key) : [...this.open, key].slice(-200);
    try { localStorage.setItem(LANES_STORAGE_KEY, JSON.stringify(this.open)); }
    catch { /* Keep the choice for this session. */ }
  }
}

export const moreRows = new MoreRows();
