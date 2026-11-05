import type { ThreadSummary } from '@boite/contracts';

/**
 * Where a thread counts (`inbox`'s `threadLiveKind`): needs the user, at work,
 * or neither. The sort and the bands read the same classification as the
 * tabs' counts, so a band holds every row its tab counts.
 */
export type LiveKind = 'needs' | 'working' | null;

type OrderFields = Pick<ThreadSummary, 'pinned' | 'status' | 'lastUserMessageAt' | 'createdAt' | 'subagentQuestions'>;

/**
 * The classification a list reads when it has no store to ask about delegated
 * agents: the status, and a child's question riding on its parent, which makes
 * that parent need the user as the count says.
 */
export function statusLive(thread: Pick<ThreadSummary, 'status' | 'subagentQuestions'>): LiveKind {
  if (thread.subagentQuestions?.length) return 'needs';
  return thread.status === 'waiting' || thread.status === 'error' ? 'needs' : thread.status === 'idle' ? null : 'working';
}

/**
 * A thread that waits on the user or failed first, as the Needs you filter and
 * the home's count group them, then the ones at work (its own turn, then a
 * queued one, then work it left running), then the rest.
 */
function rank(thread: Pick<ThreadSummary, 'status'>, live: LiveKind): number {
  if (live === 'needs') return 0;
  if (live === 'working') return thread.status === 'running' ? 1 : thread.status === 'queued' ? 2 : 3;
  return 4;
}

/** The bands the Recent list draws a label over: the pins, what needs the user, what is at work, the rest by last message. */
export type ThreadBand = 'pinned' | 'needs' | 'working' | 'earlier';

/** When the user last spoke in it. `updatedAt` moves on every event, so ordering by it makes rows jitter. */
export function lastActivity(thread: Pick<ThreadSummary, 'lastUserMessageAt' | 'createdAt'>): number {
  return thread.lastUserMessageAt ?? thread.createdAt;
}

/**
 * A row's place read from its store (`inbox`'s `storeOrder`): where it counts,
 * and since when it waits on the user, the age its row shows.
 */
export interface OrderKey { live: LiveKind; waited?: number | null }

function orderKey(thread: OrderFields, key: LiveKind | OrderKey | undefined): OrderKey {
  return key === undefined ? { live: statusLive(thread) } : typeof key === 'object' && key !== null ? key : { live: key };
}

/**
 * The sidebar's order, in both views: pinned threads, then live ones, then the
 * last message. Two rows that need the user compare the age they show, the
 * newest wait first, so the band's ages read in order; a wait's start is fixed
 * once it begins, so rows do not jitter. A list that reads a store passes each
 * thread's key (`storeOrder`) or count classification (`threadLiveKind`);
 * `sort(compareThreads)` reads the status.
 */
export function compareThreads(a: OrderFields, b: OrderFields, keyA?: LiveKind | OrderKey, keyB?: LiveKind | OrderKey): number {
  const ka = orderKey(a, keyA);
  const kb = orderKey(b, keyB);
  const ranked = Number(b.pinned) - Number(a.pinned) || rank(a, ka.live) - rank(b, kb.live);
  if (ranked) return ranked;
  const waited = ka.live === 'needs' && ka.waited != null && kb.waited != null ? kb.waited - ka.waited : 0;
  return waited || lastActivity(b) - lastActivity(a);
}

/**
 * The rows of a list sorted by `compareThreads` that open a band, by key. The
 * pins come first under their own label, whatever their state, so a pinned
 * row waiting on the user is not read as an unlabeled part of Needs you. A
 * list of one band draws no label, since it would only name the whole list.
 */
export function bandStarts<T>(
  rows: readonly T[],
  threadOf: (row: T) => Pick<ThreadSummary, 'pinned' | 'status' | 'subagentQuestions'>,
  keyOf: (row: T) => string,
  liveOf: (row: T) => LiveKind = row => statusLive(threadOf(row))
): Map<string, ThreadBand> {
  const starts = new Map<string, ThreadBand>();
  let current: ThreadBand | null = null;
  for (const row of rows) {
    const thread = threadOf(row);
    const live = liveOf(row);
    const band: ThreadBand = thread.pinned ? 'pinned' : live ?? 'earlier';
    if (band !== current) starts.set(keyOf(row), band);
    current = band;
  }
  return starts.size > 1 ? starts : new Map();
}
