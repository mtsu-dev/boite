import type { ThreadSummary } from '@boite/contracts';

type PullRequest = NonNullable<ThreadSummary['pullRequest']>;
export interface PullRequestObservation {
  observedAt: number;
  /** A link event can update the badge without having checked for automatic matches. */
  checkedAt: number | null;
  order?: [source: string, sequence: number];
  manual?: true;
}

interface CachedPullRequest extends PullRequestObservation {
  pullRequest: PullRequest | null;
}

const STORAGE_PREFIX = 'boite.pull-requests.v1:';
const MAX_ENTRIES = 500;
const source = Math.random().toString(36).slice(2);
let sequence = 0;
const cache = new Map<string, CachedPullRequest>();
const pending = new Map<string, CachedPullRequest>();
const linkObservations = new WeakMap<object, PullRequestObservation>();
let writeTimer: number | undefined;

export function observePullRequest(manual = false): PullRequestObservation {
  const observedAt = Date.now();
  return { observedAt, checkedAt: observedAt, order: [source, ++sequence], ...(manual ? { manual: true } : {}) };
}

/** The header and card see the same event, even when the first one starts a lookup. */
export function observePullRequestLinks(event: object): PullRequestObservation {
  const previous = linkObservations.get(event);
  if (previous) return previous;
  const observation = { ...observePullRequest(), checkedAt: null };
  linkObservations.set(event, observation);
  return observation;
}

function isEntry(value: unknown): value is CachedPullRequest {
  if (!value || typeof value !== 'object') return false;
  const { pullRequest: pr, checkedAt, observedAt, order } = value as Partial<CachedPullRequest>;
  if (!Number.isFinite(observedAt) || (checkedAt !== null && !Number.isFinite(checkedAt))) return false;
  if (order !== undefined && (!Array.isArray(order) || typeof order[0] !== 'string' || !Number.isSafeInteger(order[1]))) return false;
  return pr === null || (!!pr && Number.isSafeInteger(pr.number) && pr.number > 0 &&
    typeof pr.url === 'string' && pr.url.startsWith('https://') &&
    (pr.state === 'OPEN' || pr.state === 'CLOSED' || pr.state === 'MERGED'));
}

function read(key: string): CachedPullRequest | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (isEntry(saved)) return saved;
  } catch { /* A missing or unreadable cache leaves the badge lookup usable. */ }
}

function supersedes(current: CachedPullRequest, incoming: CachedPullRequest): boolean {
  if (current.observedAt !== incoming.observedAt) return current.observedAt > incoming.observedAt;
  // A lookup started by a link event can replace that event in the same millisecond.
  if ((current.checkedAt === null || incoming.checkedAt === null) &&
      current.order && incoming.order && current.order[0] === incoming.order[0]) {
    return current.order[1] > incoming.order[1];
  }
  // Across windows, link events win ties. Explicit refreshes win ties with automatic checks.
  return incoming.checkedAt !== null && (current.checkedAt === null || (current.manual === true && incoming.manual !== true));
}

function prune(): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  if (keys.length <= MAX_ENTRIES) return;
  const byAge = keys.map(key => ({ key, observedAt: read(key)?.observedAt ?? 0 })).sort((a, b) => a.observedAt - b.observedAt);
  for (const { key } of byAge.slice(0, keys.length - MAX_ENTRIES)) localStorage.removeItem(key);
}

function save(): void {
  try {
    window.clearTimeout(writeTimer);
    window.removeEventListener('pagehide', save);
    let grew = false;
    // Each window writes only its changed keys. Other windows keep their own updates.
    for (const [key, entry] of pending) {
      const storageKey = STORAGE_PREFIX + key;
      const previous = read(storageKey);
      if (previous && supersedes(previous, entry)) continue;
      localStorage.setItem(storageKey, JSON.stringify(entry));
      grew ||= !previous;
    }
    if (grew) prune();
  } catch { /* The page or its storage is unavailable. */ }
  finally {
    writeTimer = undefined;
    pending.clear();
  }
}

export function cachedPullRequest(key: string): CachedPullRequest | undefined {
  const memory = cache.get(key) ?? pending.get(key);
  const saved = read(STORAGE_PREFIX + key);
  const entry = saved && (!memory || supersedes(saved, memory)) ? saved : memory;
  if (entry) keepInMemory(key, entry);
  return entry;
}

function keepInMemory(key: string, entry: CachedPullRequest): void {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

export function rememberPullRequest(key: string, pullRequest: PullRequest | null, observation: PullRequestObservation): PullRequest | null {
  const entry: CachedPullRequest = { ...observation, pullRequest };
  // A tracker must use the winner from its own pending writes or another window's saved result.
  const current = cachedPullRequest(key);
  if (current && supersedes(current, entry)) return current.pullRequest;
  keepInMemory(key, entry);
  pending.set(key, entry);
  if (writeTimer === undefined) {
    // The page owns the timer and flushes the batch on pagehide.
    writeTimer = window.setTimeout(save, 500);
    window.addEventListener('pagehide', save);
  }
  return pullRequest;
}
