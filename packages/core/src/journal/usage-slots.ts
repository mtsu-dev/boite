import type { Database } from 'bun:sqlite';
import type { UsageSums } from './usage-sums.ts';

/**
 * `usage_slots`: the sums `usageByBucket` reads, per 15-minute slot of
 * `finished_at`, project, provider, model and era. Every local midnight is a
 * multiple of 15 minutes from UTC, so a day of any time zone is whole slots.
 * The journal's writers keep it equal to the finished turns plus
 * `removed_turn_usage`, in the transaction of every write: a turn rewritten
 * gives back its old share first (`writeTurnUsage`), a thread whose project,
 * provider or model changes moves its turns' shares (`writeThreadUsage`), and
 * erased turns give theirs back (`eraseThreadUsage`) while a removal's kept
 * copies count under no project (`keepRemovedTurnUsage`). A row whose turns
 * reach 0 is deleted, so an erased incognito conversation leaves no row.
 * `project_id` and `model` are NOT NULL keys: '' is no project, `no_model`
 * marks a null model. Not triggers: a trigger on `turns` naming `threads`
 * would fail every rebuild of `threads` a migration makes.
 */
export const SLOT_MS = 900_000;

const SUM_COLUMNS = ['turns', 'reported', 'priced', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cache_write_hour_tokens', 'cost', 'tokenless_cost'] as const;

/**
 * Adds (`sign` 1) or takes back (-1) the share of the turns `source` selects.
 * `source` gives `f` (finished_at), `u` (usage), `e` (execution), `pid`
 * (project), `tp` and `tm` (the thread's provider and model), as `TURN_ROUTE`
 * and `LEGACY` in `usage-sums.ts` read them.
 */
function slotDelta(sign: 1 | -1, source: string): string {
  const s = sign === 1 ? '' : '-';
  const sum = (path: string) => `${s}COALESCE(SUM(json_extract(x.usage, '$.${path}')), 0)`;
  return `INSERT INTO usage_slots (slot, project_id, provider_id, model, no_model, legacy, ${SUM_COLUMNS.join(', ')})
    SELECT x.slot, x.pid, x.provider_id, COALESCE(x.model, ''), x.model IS NULL, x.legacy,
      ${s}COUNT(*), ${s}COUNT(x.usage), ${s}COUNT(json_extract(x.usage, '$.costUsdEquivalent')),
      ${sum('inputTokens')}, ${sum('outputTokens')}, ${sum('cacheReadTokens')}, ${sum('cacheWriteTokens')}, ${sum('cacheWriteHourTokens')},
      ${sum('costUsdEquivalent')},
      ${s}COALESCE(SUM(CASE WHEN json_extract(x.usage, '$.buckets') IS NOT NULL AND COALESCE(json_extract(x.usage, '$.inputTokens'), 0) + COALESCE(json_extract(x.usage, '$.outputTokens'), 0)
        + COALESCE(json_extract(x.usage, '$.cacheReadTokens'), 0) + COALESCE(json_extract(x.usage, '$.cacheWriteTokens'), 0) = 0
        THEN json_extract(x.usage, '$.costUsdEquivalent') END), 0)
    FROM (
      SELECT CAST(r.f / ${SLOT_MS} AS INTEGER) AS slot, COALESCE(r.pid, '') AS pid, r.u AS usage,
        COALESCE(json_extract(r.e, '$.providerId'), r.tp, '') AS provider_id,
        CASE WHEN r.e IS NULL THEN r.tm ELSE json_extract(r.e, '$.model') END AS model,
        CASE WHEN r.u IS NOT NULL AND json_extract(r.u, '$.buckets') IS NULL THEN 1 ELSE 0 END AS legacy
      FROM (${source}) r WHERE r.f IS NOT NULL
    ) x WHERE true
    GROUP BY x.slot, x.pid, x.provider_id, x.model, x.legacy
    ON CONFLICT (slot, project_id, provider_id, model, no_model, legacy) DO UPDATE SET
      ${SUM_COLUMNS.map((column) => `${column} = ${column} + excluded.${column}`).join(', ')}`;
}

/** Drops the rows the last deltas emptied. */
function dropEmpty(db: Database): void {
  db.query('DELETE FROM usage_slots WHERE turns = 0').run();
}

/** The stored turns of the threads in `?1` (a JSON array), with their thread's row. */
const STORED_THREAD_TURNS = `SELECT t.finished_at AS f, t.usage AS u, t.execution AS e, th.project_id AS pid, th.provider_id AS tp, th.model AS tm
  FROM json_each(?1) j CROSS JOIN turns t ON t.thread_id = j.value LEFT JOIN threads th ON th.id = t.thread_id WHERE t.finished_at IS NOT NULL`;

/** Creates the table, then sums every finished turn and removed turn into it: the migration's build. */
export function createUsageSlots(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS usage_slots (
    slot INTEGER NOT NULL, project_id TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL, no_model INTEGER NOT NULL, legacy INTEGER NOT NULL,
    turns INTEGER NOT NULL, reported INTEGER NOT NULL, priced INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL,
    cache_write_hour_tokens INTEGER NOT NULL, cost REAL NOT NULL, tokenless_cost REAL NOT NULL,
    PRIMARY KEY (slot, project_id, provider_id, model, no_model, legacy)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS usage_slots_empty ON usage_slots (turns) WHERE turns = 0;`);
  rebuildUsageSlots(db);
}

/** Sums every finished turn and removed turn again. */
export function rebuildUsageSlots(db: Database): void {
  db.exec('DELETE FROM usage_slots');
  db.exec(slotDelta(1, `SELECT t.finished_at AS f, t.usage AS u, t.execution AS e, th.project_id AS pid, th.provider_id AS tp, th.model AS tm
    FROM turns t LEFT JOIN threads th ON th.id = t.thread_id WHERE t.finished_at IS NOT NULL`));
  db.exec(slotDelta(1, 'SELECT finished_at AS f, usage AS u, NULL AS e, NULL AS pid, provider_id AS tp, model AS tm FROM removed_turn_usage'));
}

/** The columns of a turn its slot share depends on. */
export interface TurnUsageColumns { id: string; thread_id: string; finished_at: number | null; usage: string | null; execution: string | null }

/** Before `turn` is written over its row: takes back the stored row's share and adds the new one's, when they differ. */
export function writeTurnUsage(db: Database, turn: TurnUsageColumns): void {
  const stored = db.query('SELECT thread_id, finished_at, usage, execution FROM turns WHERE id = ?').get(turn.id) as Omit<TurnUsageColumns, 'id'> | null;
  if (stored === null ? turn.finished_at === null
    : stored.thread_id === turn.thread_id && stored.finished_at === turn.finished_at && stored.usage === turn.usage && stored.execution === turn.execution) return;
  if (stored !== null && stored.finished_at !== null) {
    db.query(slotDelta(-1, `SELECT t.finished_at AS f, t.usage AS u, t.execution AS e, th.project_id AS pid, th.provider_id AS tp, th.model AS tm
      FROM turns t LEFT JOIN threads th ON th.id = t.thread_id WHERE t.id = ?1`)).run(turn.id);
  }
  if (turn.finished_at !== null) {
    db.query(slotDelta(1, `SELECT ?1 AS f, ?2 AS u, ?3 AS e, th.project_id AS pid, th.provider_id AS tp, th.model AS tm
      FROM (SELECT 1) LEFT JOIN threads th ON th.id = ?4`)).run(turn.finished_at, turn.usage, turn.execution, turn.thread_id);
  }
  dropEmpty(db);
}

/** Before a thread row is written: moves its turns' shares when its project, provider or model changes. */
export function writeThreadUsage(db: Database, thread: { id: string; project_id: string | null; provider_id: string; model: string | null }): void {
  const stored = db.query('SELECT project_id, provider_id, model FROM threads WHERE id = ?').get(thread.id) as Omit<typeof thread, 'id'> | null;
  if (stored !== null && stored.project_id === thread.project_id && stored.provider_id === thread.provider_id && stored.model === thread.model) return;
  if (db.query('SELECT 1 FROM turns WHERE thread_id = ? AND finished_at IS NOT NULL LIMIT 1').get(thread.id) === null) return;
  const ids = JSON.stringify([thread.id]);
  db.query(slotDelta(-1, STORED_THREAD_TURNS)).run(ids);
  db.query(slotDelta(1, `SELECT t.finished_at AS f, t.usage AS u, t.execution AS e, ?2 AS pid, ?3 AS tp, ?4 AS tm
    FROM turns t WHERE t.thread_id = ?1 AND t.finished_at IS NOT NULL`)).run(thread.id, thread.project_id, thread.provider_id, thread.model);
  dropEmpty(db);
}

/** Before the turns of `threadIds` are erased: takes their shares back. */
export function eraseThreadUsage(db: Database, threadIds: readonly string[]): void {
  db.query(slotDelta(-1, STORED_THREAD_TURNS)).run(JSON.stringify(threadIds));
  dropEmpty(db);
}

/** After rows were copied to `removed_turn_usage`: the turns `source` selects count again, under no project. */
export function addRemovedUsage(db: Database, source: string, ...params: string[]): void {
  db.query(slotDelta(1, source)).run(...params);
}

/** Sums of one bucket, project, provider, model and era. */
export interface UsageSlotRow extends UsageSums {
  bucket: number;
  project_id: string | null;
  provider_id: string;
  model: string | null;
}

/** `[bucket, from, to)`: a span of milliseconds read from the raw turns. */
type Segment = [number, number, number];

/**
 * Finished turns summed per bucket, project, provider and model, from the
 * whole slots inside each bucket and from the raw turns of a slot an edge cuts
 * (an edge that is not a multiple of 15 minutes), so any edges stay exact.
 */
export function usageBySlots(db: Database, edges: readonly number[]): UsageSlotRow[] {
  const ranges: Segment[] = [];
  const segments: Segment[] = [];
  const first = edges[0]!;
  const last = edges[edges.length - 1]!;
  for (let index = 0; index + 1 < edges.length; index++) {
    const lo = Math.ceil(edges[index]! / SLOT_MS);
    const hi = Math.floor(edges[index + 1]! / SLOT_MS);
    if (hi > lo) ranges.push([index, lo, hi]);
  }
  // The slots an edge falls inside, each read once from the turns and cut at every edge.
  const cut = new Set<number>();
  for (const edge of edges) if (edge % SLOT_MS !== 0) cut.add(Math.floor(edge / SLOT_MS));
  for (const slot of cut) {
    const from = Math.max(slot * SLOT_MS, first);
    const to = Math.min((slot + 1) * SLOT_MS, last);
    for (let index = 0; index + 1 < edges.length; index++) {
      const lo = Math.max(from, edges[index]!);
      const hi = Math.min(to, edges[index + 1]!);
      if (hi > lo) segments.push([index, lo, hi]);
    }
  }
  const rows = ranges.length === 0 ? [] : db.query(
    `WITH b AS (SELECT json_extract(value, '$[0]') AS i, json_extract(value, '$[1]') AS lo, json_extract(value, '$[2]') AS hi FROM json_each(?))
     SELECT b.i AS bucket, NULLIF(s.project_id, '') AS project_id, s.provider_id, CASE WHEN s.no_model THEN NULL ELSE s.model END AS model, s.legacy,
       ${SUM_COLUMNS.filter((column) => column !== 'cost').map((column) => `SUM(s.${column}) AS ${column}`).join(', ')},
       CASE WHEN SUM(s.priced) = 0 THEN NULL ELSE SUM(s.cost) END AS cost
     FROM b JOIN usage_slots s ON s.slot >= b.lo AND s.slot < b.hi
     GROUP BY b.i, s.project_id, s.provider_id, s.model, s.no_model, s.legacy`,
  ).all(JSON.stringify(ranges)) as UsageSlotRow[];
  if (segments.length === 0) return rows;
  return mergeSlotRows([...rows, ...usageByTurns(db, segments)]);
}

/**
 * The same sums read from the turns themselves over `segments`, those still
 * in `turns` and those a removal erased: what the slots must always equal.
 */
export function usageByTurns(db: Database, segments: readonly Segment[]): UsageSlotRow[] {
  return db.query(
    `WITH b AS (SELECT json_extract(value, '$[0]') AS i, json_extract(value, '$[1]') AS lo, json_extract(value, '$[2]') AS hi FROM json_each(?)),
     x AS (
       SELECT b.i AS bucket, th.project_id, t.usage,
         CASE WHEN t.usage IS NOT NULL AND json_extract(t.usage, '$.buckets') IS NULL THEN 1 ELSE 0 END AS legacy,
         COALESCE(json_extract(t.execution, '$.providerId'), th.provider_id, '') AS provider_id,
         CASE WHEN t.execution IS NULL THEN th.model ELSE json_extract(t.execution, '$.model') END AS model
       FROM b JOIN turns t ON t.finished_at >= b.lo AND t.finished_at < b.hi
       LEFT JOIN threads th ON th.id = t.thread_id
       UNION ALL
       SELECT b.i, NULL, t.usage, CASE WHEN t.usage IS NOT NULL AND json_extract(t.usage, '$.buckets') IS NULL THEN 1 ELSE 0 END, t.provider_id, t.model
       FROM b JOIN removed_turn_usage t ON t.finished_at >= b.lo AND t.finished_at < b.hi
     )
     SELECT bucket, project_id, provider_id, model, legacy, COUNT(*) AS turns, COUNT(x.usage) AS reported,
       COUNT(json_extract(x.usage, '$.costUsdEquivalent')) AS priced,
       COALESCE(SUM(json_extract(x.usage, '$.inputTokens')), 0) AS input_tokens,
       COALESCE(SUM(json_extract(x.usage, '$.outputTokens')), 0) AS output_tokens,
       COALESCE(SUM(json_extract(x.usage, '$.cacheReadTokens')), 0) AS cache_read_tokens,
       COALESCE(SUM(json_extract(x.usage, '$.cacheWriteTokens')), 0) AS cache_write_tokens,
       COALESCE(SUM(json_extract(x.usage, '$.cacheWriteHourTokens')), 0) AS cache_write_hour_tokens,
       SUM(json_extract(x.usage, '$.costUsdEquivalent')) AS cost,
       COALESCE(SUM(CASE WHEN json_extract(x.usage, '$.buckets') IS NOT NULL AND COALESCE(json_extract(x.usage, '$.inputTokens'), 0) + COALESCE(json_extract(x.usage, '$.outputTokens'), 0)
         + COALESCE(json_extract(x.usage, '$.cacheReadTokens'), 0) + COALESCE(json_extract(x.usage, '$.cacheWriteTokens'), 0) = 0
         THEN json_extract(x.usage, '$.costUsdEquivalent') END), 0) AS tokenless_cost
     FROM x GROUP BY bucket, project_id, provider_id, model, legacy`,
  ).all(JSON.stringify(segments)) as UsageSlotRow[];
}

/** Rows of one key summed into one. */
function mergeSlotRows(rows: readonly UsageSlotRow[]): UsageSlotRow[] {
  const merged = new Map<string, UsageSlotRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.bucket, row.project_id, row.provider_id, row.model, row.legacy]);
    const into = merged.get(key);
    if (into === undefined) { merged.set(key, { ...row }); continue; }
    addSums(into, row);
  }
  return [...merged.values()];
}

/** Adds `from`'s sums into `into`; a cost neither carried stays null. */
export function addSums(into: UsageSums, from: UsageSums): void {
  into.turns += from.turns;
  into.reported += from.reported;
  into.priced += from.priced;
  into.input_tokens += from.input_tokens;
  into.output_tokens += from.output_tokens;
  into.cache_read_tokens += from.cache_read_tokens;
  into.cache_write_tokens += from.cache_write_tokens;
  into.cache_write_hour_tokens += from.cache_write_hour_tokens;
  into.tokenless_cost += from.tokenless_cost;
  if (from.cost !== null) into.cost = (into.cost ?? 0) + from.cost;
}
