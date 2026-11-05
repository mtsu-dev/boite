import type { ThreadSummary } from '@boite/contracts';

/**
 * A thread that waits on the user or failed first, as the Needs you filter and
 * the home's count group them, then the ones at work, then the rest.
 */
const LIVE: Record<ThreadSummary['status'], number> = { waiting: 0, error: 0, running: 1, queued: 2, idle: 4 };

/** The bands the Recent list draws a label over: the pins, what needs the user, what is at work, the rest by last message. */
export type ThreadBand = 'pinned' | 'needs' | 'working' | 'earlier';
const BAND: Record<ThreadSummary['status'], ThreadBand> = { waiting: 'needs', error: 'needs', running: 'working', queued: 'working', idle: 'earlier' };

/** When the user last spoke in it. `updatedAt` moves on every event, so ordering by it makes rows jitter. */
export function lastActivity(thread: Pick<ThreadSummary, 'lastUserMessageAt' | 'createdAt'>): number {
  return thread.lastUserMessageAt ?? thread.createdAt;
}

/** The sidebar's order, in both views: pinned threads, then live ones, then the last message. */
export function compareThreads(
  a: Pick<ThreadSummary, 'pinned' | 'status' | 'lastUserMessageAt' | 'createdAt'>,
  b: Pick<ThreadSummary, 'pinned' | 'status' | 'lastUserMessageAt' | 'createdAt'>
): number {
  return Number(b.pinned) - Number(a.pinned) || LIVE[a.status] - LIVE[b.status] || lastActivity(b) - lastActivity(a);
}

/**
 * The rows of a list sorted by `compareThreads` that open a band, by key. The
 * pins come first under their own label, whatever their state, so a pinned
 * row waiting on the user is not read as an unlabeled part of Needs you. A
 * list of one band draws no label, since it would only name the whole list.
 */
export function bandStarts<T>(rows: readonly T[], threadOf: (row: T) => Pick<ThreadSummary, 'pinned' | 'status'>, keyOf: (row: T) => string): Map<string, ThreadBand> {
  const starts = new Map<string, ThreadBand>();
  let current: ThreadBand | null = null;
  for (const row of rows) {
    const thread = threadOf(row);
    const band = thread.pinned ? 'pinned' : BAND[thread.status];
    if (band !== current) starts.set(keyOf(row), band);
    current = band;
  }
  return starts.size > 1 ? starts : new Map();
}
