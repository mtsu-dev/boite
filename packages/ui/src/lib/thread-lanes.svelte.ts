import type { ThreadSummary } from '@boite/contracts';
import type { ThreadState } from './thread-state';

/**
 * How many rows a project shows, those that need the user included, before
 * the ones at work and at rest fold under one `n more` row. Needs-you rows
 * fold past `NEEDS_BUDGET` behind their own `n more need you` row, so a busy
 * project leaves room on the first screen for the projects under it.
 */
export const ROW_BUDGET = 6;
export const NEEDS_BUDGET = 3;
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
  /** Needs you first, then failed, the first `NEEDS_BUDGET` shown. */
  needs: T[];
  /** The needs-you rows past that, drawn once `n more need you` opens. */
  needsHidden: T[];
  /** How many needs-you rows fold, opened or not: an opened lane offers `Show fewer` while this is above 0. */
  needsFoldable: number;
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
 * rows keep their order. `away` folds every row that does not need the user,
 * at work or at rest, as a project that does not hold the open thread does:
 * its `n more` row still counts the work, so six of eight projects fit the
 * first screen. `needsExpanded` opens the needs-you fold.
 */
export function threadLanes<T>(rows: readonly T[], stateOf: (row: T) => ThreadState | null, options: { expanded?: boolean; needsExpanded?: boolean; keep?: (row: T) => boolean; budget?: number; needsBudget?: number; away?: boolean } = {}): Lanes<T> {
  const waiting: T[] = [], failed: T[] = [], working: T[] = [], resting: T[] = [];
  for (const row of rows) {
    const state = stateOf(row);
    if (state === 'waiting') waiting.push(row);
    else if (needsHand(state)) failed.push(row);
    else if (liveState(state)) working.push(row);
    else resting.push(row);
  }
  // A kept row past a budget takes no slot of its own: it already shows, so `n more` counts only what it hides.
  const split = (lane: T[], room: number) => {
    const shown: T[] = [], folded: T[] = [];
    for (const row of lane) {
      if (room > 0) { shown.push(row); room -= 1; }
      else if (options.keep?.(row)) shown.push(row);
      else folded.push(row);
    }
    return [shown, folded, room] as const;
  };
  // A fold that would hide one row shows it: `1 more` takes the height of the row it hides.
  const asking = [...waiting, ...failed];
  const [needsCut, needsCutFolded] = split(asking, options.needsBudget ?? NEEDS_BUDGET);
  const [needsShown, needsFolded] = needsCutFolded.length === 1 ? [asking, []] : [needsCut, needsCutFolded];
  const needs = options.needsExpanded ? asking : needsShown;
  const needsHidden = options.needsExpanded ? [] : needsFolded;
  const [liveCut, liveCutFolded, left] = split(working, options.away ? 0 : Math.max(0, (options.budget ?? ROW_BUDGET) - needsShown.length));
  const [restCut, restCutFolded] = split(resting, options.away ? 0 : left);
  const single = liveCutFolded.length + restCutFolded.length === 1;
  const [live, liveFolded] = single ? [working, []] : [liveCut, liveCutFolded];
  const [rest, restFolded] = single ? [resting, []] : [restCut, restCutFolded];
  const foldable = liveFolded.length + restFolded.length;
  const lanes = { needs, needsHidden, needsFoldable: needsFolded.length, foldable };
  if (options.expanded) return { ...lanes, live: working, rest: resting, hidden: [], hiddenLive: 0 };
  return { ...lanes, live, rest, hidden: [...liveFolded, ...restFolded], hiddenLive: liveFolded.length };
}

/** What a project's lanes drew, by row key, and the options they were drawn with. */
export type LaneHold = { needs: string[]; live: string[]; rest: string[]; options: string };

export function laneHold<T>(lanes: Lanes<T>, keyOf: (row: T) => string, options: string): LaneHold {
  return { needs: lanes.needs.map(keyOf), live: lanes.live.map(keyOf), rest: lanes.rest.map(keyOf), options };
}

/**
 * The lanes drawn in the places `held` recorded, while the pointer rests on
 * the list or a row has keyboard focus: a thread that changes state keeps its
 * row where it was, so nothing jumps under the pointer or the click about to
 * land. Each row is the fresh one, so its ring and time change at once; a row
 * gone from the project leaves at once; a row the held lanes did not draw
 * waits in the folds, whose counts are the fresh ones. `fresh` is what
 * `threadLanes` makes now, with the same options as `held`.
 */
export function holdLanes<T>(fresh: Lanes<T>, held: LaneHold, keyOf: (row: T) => string): Lanes<T> {
  const asking = [...fresh.needs, ...fresh.needsHidden];
  const live = new Set([...fresh.live, ...fresh.hidden.slice(0, fresh.hiddenLive)].map(keyOf));
  const rows = new Map([...asking, ...fresh.live, ...fresh.rest, ...fresh.hidden].map(row => [keyOf(row), row]));
  const place = (keys: string[]) => keys.flatMap(key => rows.get(key) ?? []);
  const lanes = { needs: place(held.needs), live: place(held.live), rest: place(held.rest) };
  const same = (a: T[], b: T[]) => a.length === b.length && a.every((row, index) => row === b[index]);
  if (same(lanes.needs, fresh.needs) && same(lanes.live, fresh.live) && same(lanes.rest, fresh.rest)) return fresh;
  const drawn = new Set([...held.needs, ...held.live, ...held.rest]);
  const needsHidden = asking.filter(row => !drawn.has(keyOf(row)));
  const askingKeys = new Set(asking.map(keyOf));
  const hidden = [...fresh.live, ...fresh.rest, ...fresh.hidden].filter(row => !drawn.has(keyOf(row)) && !askingKeys.has(keyOf(row)));
  return {
    ...lanes,
    needsHidden,
    needsFoldable: needsHidden.length ? Math.max(fresh.needsFoldable, needsHidden.length) : fresh.needsFoldable,
    hidden,
    hiddenLive: hidden.filter(row => live.has(keyOf(row))).length,
    foldable: hidden.length ? Math.max(fresh.foldable, hidden.length) : fresh.foldable
  };
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
