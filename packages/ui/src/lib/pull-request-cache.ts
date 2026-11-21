import type { ThreadSummary } from '@boite/contracts';

type PullRequest = NonNullable<ThreadSummary['pullRequest']>;
interface CachedPullRequest {
  pullRequest: PullRequest | null;
  /** A link event can update the badge without having checked for automatic matches. */
  checkedAt: number | null;
  observedAt: number;
}

const STORAGE_PREFIX = 'boite.pull-requests.v1:';
const MAX_ENTRIES = 500;
const cache = new Map<string, CachedPullRequest>();
const pending = new Map<string, CachedPullRequest>();
let writeTimer: number | undefined;

function isEntry(value: unknown): value is CachedPullRequest {
  if (!value || typeof value !== 'object') return false;
  const { pullRequest: pr, checkedAt, observedAt } = value as Partial<CachedPullRequest>;
  if (!Number.isFinite(observedAt) || (checkedAt !== null && !Number.isFinite(checkedAt))) return false;
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
  return current.observedAt > incoming.observedAt ||
    (current.observedAt === incoming.observedAt && current.checkedAt === null && incoming.checkedAt !== null);
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
  const memory = cache.get(key);
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

export function rememberPullRequest(key: string, pullRequest: PullRequest | null, checkedAt: number | null = null): void {
  // An older request can finish after a newer link event, even in another window.
  const entry = { pullRequest, checkedAt, observedAt: checkedAt ?? Date.now() };
  keepInMemory(key, entry);
  pending.set(key, entry);
  if (writeTimer !== undefined) return;
  // The page owns the timer and flushes the batch on pagehide.
  writeTimer = window.setTimeout(save, 500);
  window.addEventListener('pagehide', save);
}
