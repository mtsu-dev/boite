import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { addRemovedUsage, addSums, usageBySlots } from './usage-slots.ts';

/** What `usageByBucket` and `usageByThread` sum over a group of finished turns. */
export interface UsageSums {
  /** 1 for a group of reported turns an older core recorded (`Usage.buckets` absent), else 0. */
  legacy: number;
  turns: number;
  reported: number;
  priced: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** Of the cache writes, those to a one-hour cache. */
  cache_write_hour_tokens: number;
  /** Null when no turn of the group carried a price. */
  cost: number | null;
  /**
   * The cost reported by marked turns (`Usage.buckets`) that counted no
   * token, which no rate can price: a Claude compaction whose running totals
   * the driver could not measure (`mapUsage`). An unmarked one is left out:
   * cores before 2026-10-13 charged such turns a resumed session's whole total.
   */
  tokenless_cost: number;
}

/** Sums of the turns of one provider and model. */
export interface UsageGroupRow extends UsageSums {
  provider_id: string;
  model: string | null;
}

export interface UsageSumRow extends UsageGroupRow {
  bucket: number;
  /** Null for a thread in no project and for a turn a removal erased. */
  project_id: string | null;
}

export interface UsageThreadRow extends UsageSums {
  thread_id: string;
  /** The provider and model the turns of this row ran on; a thread that switched has one row per pair. */
  provider_id: string;
  model: string | null;
  title: string;
  project_id: string | null;
  thread_provider_id: string;
  archived: number;
}

/** Reported turns summed per key, provider and era (`usageGroups`). */
export interface UsageGroup extends UsageSums {
  key: string | null;
  provider_id: string;
}

/** Whether a turn's usage predates canonical buckets; groups split on it. */
const LEGACY = `CASE WHEN t.usage IS NOT NULL AND json_extract(t.usage, '$.buckets') IS NULL THEN 1 ELSE 0 END AS legacy`;

/** The sums over `x`, a set of turns with their `usage` JSON. */
const USAGE_SUMS = `COUNT(*) AS turns, COUNT(x.usage) AS reported,
  COUNT(json_extract(x.usage, '$.costUsdEquivalent')) AS priced,
  COALESCE(SUM(json_extract(x.usage, '$.inputTokens')), 0) AS input_tokens,
  COALESCE(SUM(json_extract(x.usage, '$.outputTokens')), 0) AS output_tokens,
  COALESCE(SUM(json_extract(x.usage, '$.cacheReadTokens')), 0) AS cache_read_tokens,
  COALESCE(SUM(json_extract(x.usage, '$.cacheWriteTokens')), 0) AS cache_write_tokens,
  COALESCE(SUM(json_extract(x.usage, '$.cacheWriteHourTokens')), 0) AS cache_write_hour_tokens,
  SUM(json_extract(x.usage, '$.costUsdEquivalent')) AS cost,
  COALESCE(SUM(CASE WHEN json_extract(x.usage, '$.buckets') IS NOT NULL AND COALESCE(json_extract(x.usage, '$.inputTokens'), 0) + COALESCE(json_extract(x.usage, '$.outputTokens'), 0)
    + COALESCE(json_extract(x.usage, '$.cacheReadTokens'), 0) + COALESCE(json_extract(x.usage, '$.cacheWriteTokens'), 0) = 0
    THEN json_extract(x.usage, '$.costUsdEquivalent') END), 0) AS tokenless_cost`;

/**
 * The provider and model a turn `t` of thread `th` ran on: its execution
 * snapshot, else its thread's, for a turn saved before snapshots.
 */
const TURN_ROUTE = `COALESCE(json_extract(t.execution, '$.providerId'), th.provider_id, '') AS provider_id,
  CASE WHEN t.execution IS NULL THEN th.model ELSE json_extract(t.execution, '$.model') END AS model`;

/**
 * `removed_turn_usage`: what `usageByBucket` counts of each finished turn a
 * project removal or a purge of the deleted conversations erased, so the usage
 * page keeps counting it. A row holds the exact time the turn finished, the
 * provider and model it ran on, resolved as `TURN_ROUTE` reads them, and its
 * `Usage` as stored, which holds token counts and a cost only (null when the
 * turn reported none). Nothing names the turn, its thread or its project.
 */
export function createRemovedTurnUsage(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS removed_turn_usage (
    finished_at INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT,
    usage TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS removed_turn_usage_by_finished ON removed_turn_usage (finished_at)');
}

/**
 * Copies the finished turns of `threadIds` into `removed_turn_usage`, in the
 * transaction that erases them, so a turn is counted from one table or the
 * other and never twice. An incognito conversation and the threads it started
 * leave nothing (`docs/internals/drafts.md`), even when a project removal takes them.
 */
export function keepRemovedTurnUsage(db: Database, threadIds: readonly string[]): void {
  const kept = `FROM turns t LEFT JOIN threads th ON th.id = t.thread_id
     WHERE t.thread_id IN (SELECT value FROM json_each(?1)) AND t.finished_at IS NOT NULL
       AND COALESCE(th.incognito, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM threads p WHERE p.id = th.parent_thread_id AND p.incognito = 1)`;
  db.query(`INSERT INTO removed_turn_usage (finished_at, provider_id, model, usage) SELECT t.finished_at, ${TURN_ROUTE}, t.usage ${kept}`).run(JSON.stringify(threadIds));
  // The slots count the copies as a removed turn: under no project. The caller takes back the turns' own shares as it erases them.
  addRemovedUsage(db, `SELECT t.finished_at AS f, t.usage AS u, t.execution AS e, NULL AS pid, th.provider_id AS tp, th.model AS tm ${kept}`, JSON.stringify(threadIds));
}

/**
 * Finished turns summed per bucket, project, provider and model: bucket `i`
 * holds the turns with `edges[i] <= finished_at < edges[i + 1]`, those still
 * in `turns` and those a removal erased (`removed_turn_usage`, no project).
 * Read from `usage_slots` (`usage-slots.ts`), and from the raw turns only in a
 * slot an edge cuts. A turn saved before execution snapshots counts under its
 * thread's provider and model. Token buckets are summed as each turn stored
 * them (`Usage`), the turns an older core recorded apart from the others.
 */
export function usageByBucket(db: Database, edges: readonly number[]): UsageSumRow[] {
  return usageBySlots(db, edges);
}

/** One finished turn as `turnsInRange` reads it: `[finished_at, thread_id, usage, execution]`. */
type TurnValues = [number, string, string | null, string | null];

/** The thread columns a usage row names. */
interface ThreadNames { id: string; title: string; project_id: string | null; provider_id: string; model: string | null; archived: number }

/** One turn's sums, read from its stored JSON as `USAGE_SUMS` reads it in SQL. */
export function turnSums(usage: Partial<Record<string, unknown>> | null): UsageSums {
  const number = (key: string) => (typeof usage?.[key] === 'number' ? usage[key] : 0);
  const cost = typeof usage?.costUsdEquivalent === 'number' ? usage.costUsdEquivalent : null;
  const marked = usage !== null && usage.buckets !== undefined && usage.buckets !== null;
  const tokens = number('inputTokens') + number('outputTokens') + number('cacheReadTokens') + number('cacheWriteTokens');
  return {
    legacy: usage !== null && !marked ? 1 : 0,
    turns: 1,
    reported: usage === null ? 0 : 1,
    priced: cost === null ? 0 : 1,
    input_tokens: number('inputTokens'),
    output_tokens: number('outputTokens'),
    cache_read_tokens: number('cacheReadTokens'),
    cache_write_tokens: number('cacheWriteTokens'),
    cache_write_hour_tokens: number('cacheWriteHourTokens'),
    cost,
    tokenless_cost: marked && tokens === 0 && cost !== null ? cost : 0,
  };
}

/** The provider and model a turn ran on, as `TURN_ROUTE` reads them. */
export function turnRoute(execution: { providerId?: unknown; model?: unknown } | null, thread: { provider_id: string; model: string | null } | undefined): { provider_id: string; model: string | null } {
  if (execution === null) return { provider_id: thread?.provider_id ?? '', model: thread?.model ?? null };
  return {
    provider_id: typeof execution.providerId === 'string' ? execution.providerId : thread?.provider_id ?? '',
    model: typeof execution.model === 'string' ? execution.model : null,
  };
}

/**
 * The same sums per thread, provider and model over `[from, to)`, with what a
 * list needs to name each thread: one read of the turns in range, each JSON
 * parsed once. The turns a removal erased name no thread and stay out.
 * `threadIds` keeps only those threads' turns.
 */
export function usageByThread(db: Database, from: number, to: number, threadIds?: readonly string[]): UsageThreadRow[] {
  const turns = (threadIds === undefined
    ? db.query('SELECT finished_at, thread_id, usage, execution FROM turns WHERE finished_at >= ? AND finished_at < ?').values(from, to)
    : db.query(`SELECT t.finished_at, t.thread_id, t.usage, t.execution FROM json_each(?) j CROSS JOIN turns t ON t.thread_id = j.value
        WHERE t.finished_at >= ? AND t.finished_at < ?`).values(JSON.stringify(threadIds), from, to)) as TurnValues[];
  const ids = [...new Set(turns.map((turn) => turn[1]))];
  const threads = new Map<string, ThreadNames>();
  for (const row of db.query('SELECT id, title, project_id, provider_id, model, archived FROM threads WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as ThreadNames[]) {
    threads.set(row.id, row);
  }
  const groups = new Map<string, UsageThreadRow>();
  for (const [, threadId, usageJson, executionJson] of turns) {
    const thread = threads.get(threadId);
    const sums = turnSums(usageJson === null ? null : JSON.parse(usageJson) as Record<string, unknown>);
    const route = turnRoute(executionJson === null ? null : JSON.parse(executionJson) as { providerId?: unknown; model?: unknown } | null, thread);
    const key = JSON.stringify([threadId, route.provider_id, route.model, sums.legacy]);
    const into = groups.get(key);
    if (into !== undefined) { addSums(into, sums); continue; }
    groups.set(key, {
      ...sums,
      thread_id: threadId,
      provider_id: route.provider_id,
      model: route.model,
      title: thread?.title ?? '',
      project_id: thread?.project_id ?? null,
      thread_provider_id: thread?.provider_id ?? '',
      archived: thread?.archived ?? 0,
    });
  }
  return [...groups.values()];
}

/**
 * The same sums per provider and model over the turns started since `since`
 * on `rootId` and every thread below it: its subagents at any depth
 * (`parent_thread_id`) and the steps of workflow runs rooted in that set.
 * Each thread's turns are read through the partial index
 * `turns_by_thread_queue`, whose `started_at IS NOT NULL` the query repeats;
 * the CROSS JOIN keeps the tree outside, else SQLite may walk the whole index.
 */
export function usageOfTree(db: Database, rootId: string, since: number): UsageGroupRow[] {
  return db
    .query(
      `WITH RECURSIVE tree(id) AS (
         SELECT ?
         UNION SELECT c.id FROM threads c JOIN tree ON c.parent_thread_id = tree.id
         UNION SELECT s.thread_id FROM workflow_runs r JOIN tree ON r.root_id = tree.id JOIN workflow_steps s ON s.run_id = r.id
       ),
       x AS (
         SELECT t.usage, ${LEGACY}, ${TURN_ROUTE}
         FROM tree CROSS JOIN turns AS t INDEXED BY turns_by_thread_queue ON t.thread_id = tree.id
         LEFT JOIN threads th ON th.id = t.thread_id
         WHERE t.queued_at >= ? AND t.started_at IS NOT NULL AND t.usage IS NOT NULL
       )
       SELECT provider_id, model, legacy, ${USAGE_SUMS}
       FROM x GROUP BY provider_id, model, legacy ORDER BY provider_id, model, legacy`,
    )
    .all(rootId, since) as UsageGroupRow[];
}

/**
 * The reported turns `scope.where` selects, summed per `scope.key`, provider
 * and era, for every reader that totals usage (`usage.ts`, `usageTotal`): `t`
 * is the turn, `th` its thread, and `scope.join` adds tables. A turn saved
 * before execution snapshots counts under its thread's provider.
 */
export function usageGroups(db: Database, scope: { key?: string; join?: string; where: string; includeUnreported?: boolean }, ...params: SQLQueryBindings[]): UsageGroup[] {
  return db
    .query(
      `WITH x AS (
         SELECT ${scope.key ?? 'NULL'} AS key, t.usage, ${LEGACY},
           COALESCE(json_extract(t.execution, '$.providerId'), th.provider_id, '') AS provider_id
         FROM turns t LEFT JOIN threads th ON th.id = t.thread_id ${scope.join ?? ''}
         WHERE ${scope.includeUnreported ? '' : 't.usage IS NOT NULL AND '}(${scope.where})
       )
       SELECT key, provider_id, legacy, ${USAGE_SUMS} FROM x GROUP BY key, provider_id, legacy`,
    )
    .all(...params) as UsageGroup[];
}
