import { USAGE_THREAD_TURNS_MAX } from '@boite/contracts';
import type { AgentTotals, ProjectId, ProviderId, ThreadId, Usage, UsageHistory, UsageHistoryProject, UsageHistoryRow, UsageHistoryThread, UsagePrice, UsageThreadDetail, UsageThreadTurn } from '@boite/contracts';
import type { Core } from './core.ts';
import { invalidParams, notFound } from './errors.ts';
import { turnRoute, turnSums, usageGroups, type UsageGroup, type UsageSumRow, type UsageSums, type UsageThreadRow } from './journal/usage-sums.ts';
import { addSums } from './journal/usage-slots.ts';
import { priceUsage, pricingStatus } from './pricing/index.ts';

/** A year of days plus the closing edge. */
export const MAX_USAGE_EDGES = 367;

/** How many threads each ranking of `usage.history` keeps. */
export const TOP_THREADS = 10;

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsdEquivalent: null,
  };
}

function add(into: Usage, from: Usage): void {
  into.inputTokens += from.inputTokens;
  into.outputTokens += from.outputTokens;
  into.cacheReadTokens += from.cacheReadTokens;
  into.cacheWriteTokens += from.cacheWriteTokens;
  const hour = (into.cacheWriteHourTokens ?? 0) + (from.cacheWriteHourTokens ?? 0);
  if (hour > 0) into.cacheWriteHourTokens = hour;
  if (from.costUsdEquivalent !== null) into.costUsdEquivalent = (into.costUsdEquivalent ?? 0) + from.costUsdEquivalent;
}

/** Two reports of one turn as one; a cost neither carried stays unknown. */
export function sumUsage(left: Usage, right: Usage): Usage {
  const sum: Usage = { ...left, costUsdEquivalent: left.costUsdEquivalent };
  add(sum, right);
  return sum;
}

/** Every token the provider processed for these turns, cache included. */
export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** A provider removed since keeps its protocol through its shipped id. */
function protocolOf(core: Core, id: ProviderId): string | null {
  return core.providers.get(id)?.protocol ?? (id === 'claude' ? 'claude-sdk' : id === 'codex' ? 'codex-appserver' : null);
}

/**
 * Turns an older core recorded, read as their provider counted: Codex's input
 * held both caches and Claude Code wrote for an hour. Nothing in such a turn
 * says which protocol produced it, so this asks the provider's descriptor as
 * it is now, without rewriting the turn.
 */
function estimate(usage: Usage, protocol: string | null): Usage {
  if (protocol === 'codex-appserver') return { ...usage, inputTokens: Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens) };
  if (protocol === 'claude-sdk' && usage.cacheWriteTokens > 0) return { ...usage, cacheWriteHourTokens: usage.cacheWriteTokens };
  return usage;
}

/**
 * A group of turns as disjoint buckets: the one reading every total of the
 * core uses, so `usage.get`, `usage.history`, a session, a workflow and a
 * delegation team count an older turn the same way.
 */
function groupUsage(core: Core, group: UsageSums & { provider_id: ProviderId }): Usage {
  const usage = sumsToUsage(group);
  return group.legacy ? estimate(usage, protocolOf(core, group.provider_id)) : usage;
}

/** `usageGroups` summed per key. */
export function sumGroups(core: Core, groups: readonly UsageGroup[]): Map<string | null, Usage> {
  const sums = new Map<string | null, Usage>();
  for (const group of groups) {
    const usage = groupUsage(core, group);
    const into = sums.get(group.key);
    if (into === undefined) sums.set(group.key, usage);
    else add(into, usage);
  }
  return sums;
}

/** `usageGroups` summed whole. */
export function usageTotal(core: Core, groups: readonly UsageGroup[]): Usage {
  const total = emptyUsage();
  for (const group of groups) add(total, groupUsage(core, group));
  return total;
}

/**
 * The journal setting holding the running totals a session compacted in the
 * background starts with (`SwappedTotals`), written at the swap.
 */
export const SWAPPED_TOTALS_PREFIX = 'session-totals:';

/** The copy's totals, which an agent resuming the compacted session of `generation` restores. */
export interface SwappedTotals { generation: number; totals: AgentTotals }

/**
 * What an agent session already used: its last reported totals, else those a
 * swapped-in compacted session started with, else its turns (`Journal.sessionUsage`).
 */
export function sessionUsage(core: Core, threadId: ThreadId, generation: number | readonly number[], exceptTurnId: string): AgentTotals {
  const { reported, groups } = core.journal.sessionUsage(threadId, generation, exceptTurnId);
  if (reported !== null) return reported;
  const swapped = core.journal.getSetting(`${SWAPPED_TOTALS_PREFIX}${threadId}`) as SwappedTotals | undefined;
  if (swapped !== undefined && (typeof generation === 'number' ? [generation] : generation).includes(swapped.generation)) return swapped.totals;
  const usage = usageTotal(core, groups);
  return { costUsd: usage.costUsdEquivalent ?? 0, tokens: totalTokens(usage) };
}

/**
 * How far a turn's reported cost may exceed its tokens at public rates before
 * it reads as an agent's running total charged again rather than the turn's
 * own share. Set from the 7 201 priced turns of a real journal (2026-11-15):
 * the ratio's 95th percentile is 2.6, and the 357 turns above 3 all charged a
 * session's earlier turns again, most after a background compaction's swap.
 */
export const COST_GUARD = { ratio: 3, marginUsd: 0.25 };

/**
 * What the turn's tokens cost at rates when its reported cost is implausible
 * by `COST_GUARD`, else null: the cost stands, or no rate or token can judge it.
 */
export function implausibleCost(model: string | null, usage: Usage): number | null {
  const reported = usage.costUsdEquivalent;
  if (reported === null || totalTokens(usage) === 0) return null;
  const quote = priceUsage(model, usage);
  return quote !== null && reported > quote.cost * COST_GUARD.ratio + COST_GUARD.marginUsd ? quote.cost : null;
}

/** A turn's cost for a reader of one turn: the reported cost, else its tokens at rates, else null. */
export function costOrRates(model: string | null, usage: Usage): number | null {
  if (usage.costUsdEquivalent !== null) return usage.costUsdEquivalent;
  return totalTokens(usage) === 0 ? null : priceUsage(model, usage)?.cost ?? null;
}

export function usageOf(core: Core, threadId?: ThreadId): { byThread: Record<ThreadId, Usage>; total: Usage } {
  const groups = threadId === undefined
    ? usageGroups(core.journal.db, { key: 't.thread_id', where: '1' })
    : usageGroups(core.journal.db, { key: 't.thread_id', where: 't.thread_id = ?' }, threadId);
  return { byThread: Object.fromEntries(sumGroups(core, groups)) as Record<ThreadId, Usage>, total: usageTotal(core, groups) };
}

function checkEdges(edges: unknown): number[] {
  const valid =
    Array.isArray(edges) &&
    edges.length >= 2 &&
    edges.length <= MAX_USAGE_EDGES &&
    edges.every((edge, index) => typeof edge === 'number' && Number.isFinite(edge) && (index === 0 || edge > edges[index - 1]));
  if (!valid) {
    throw invalidParams(`edges: expected 2 to ${MAX_USAGE_EDGES} strictly ascending timestamps in milliseconds`, { field: 'edges' });
  }
  return edges as number[];
}

function sumsToUsage(sums: UsageSums): Usage {
  return {
    inputTokens: sums.input_tokens,
    outputTokens: sums.output_tokens,
    cacheReadTokens: sums.cache_read_tokens,
    cacheWriteTokens: sums.cache_write_tokens,
    ...(sums.cache_write_hour_tokens > 0 ? { cacheWriteHourTokens: sums.cache_write_hour_tokens } : {}),
    costUsdEquivalent: sums.cost,
  };
}

export interface Priced {
  usage: Usage;
  priced: number;
  price: UsagePrice | null;
}

/**
 * The API-equivalent cost of a group of turns: their tokens at the model's
 * public rates when the price list knows the model, else the costs the agents
 * reported. Rates come first because a reported cost is only as good as the
 * agent's own sum: Claude's is a running total the driver has to take apart,
 * Codex and Grok report none, and a rate prices every provider the same way.
 * Only what each turn stored decides it, never the provider's descriptor, so
 * editing or removing a provider leaves the turns recorded since as they were.
 * A turn that reported a cost and no token keeps its cost: rates price none.
 */
function priced(usage: Usage, sums: UsageSums, model: string | null): Priced {
  const quote = priceUsage(model, usage);
  if (quote === null || sums.reported === 0) return { usage, priced: sums.priced, price: quote?.price ?? null };
  return { usage: { ...usage, costUsdEquivalent: quote.cost + sums.tokenless_cost }, priced: sums.reported, price: quote.price };
}

/**
 * The turns of one provider and model priced the way `usage.history` prices
 * them (`priced`); a bot's daily budget reads the same rule (`agents/spend.ts`).
 */
export function priceGroup(core: Core, row: UsageSums & { provider_id: ProviderId; model: string | null }): Priced {
  return priced(groupUsage(core, row), row, row.model);
}

/** Rows of one sort key in the order `usageByBucket` returned them before slots: SQLite's, a null model first. */
function compareRows(a: UsageSumRow, b: UsageSumRow): number {
  const text = (left: string | null, right: string | null) => (left === right ? 0 : left === null ? -1 : right === null ? 1 : left < right ? -1 : 1);
  return a.bucket - b.bucket || text(a.provider_id, b.provider_id) || text(a.model, b.model) || a.legacy - b.legacy;
}

/** `rows` summed again per the key `keyOf` gives, keeping the first row's other columns. */
function regroup<T extends UsageSums>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const groups = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const into = groups.get(key);
    if (into === undefined) groups.set(key, { ...row });
    else addSums(into, row);
  }
  return [...groups.values()];
}

/** A thread's usage rows priced and summed, named as `usage.history` names a thread. */
function threadTotals(core: Core, rows: readonly UsageThreadRow[], providerId?: ProviderId): Map<ThreadId, UsageHistoryThread> {
  const byThread = new Map<ThreadId, UsageHistoryThread>();
  for (const row of rows) {
    if (providerId !== undefined && row.provider_id !== providerId) continue;
    const { usage } = priceGroup(core, row);
    const entry = byThread.get(row.thread_id);
    if (entry !== undefined) {
      entry.turns += row.turns;
      add(entry.usage, usage);
      continue;
    }
    byThread.set(row.thread_id, {
      threadId: row.thread_id,
      title: row.title,
      projectId: row.project_id,
      providerId: providerId ?? row.thread_provider_id,
      archived: row.archived !== 0,
      turns: row.turns,
      usage,
    });
  }
  return byThread;
}

/** The name of each project and whether it left the list; a row that is gone gives no name. */
function projectNames(core: Core, ids: readonly string[]): Map<string, { name: string; removed: boolean }> {
  const rows = core.journal.db.query('SELECT id, name, removed_at IS NOT NULL AS removed FROM projects WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(ids)) as { id: string; name: string; removed: number }[];
  return new Map(rows.map((row) => [row.id, { name: row.name, removed: row.removed !== 0 }]));
}

/**
 * Every project with a finished turn over the range, each group priced as a
 * history row and summed per project. Turns a removal erased count under no project.
 */
function projectTotals(core: Core, sums: readonly UsageSumRow[]): UsageHistoryProject[] {
  const totals = new Map<string | null, UsageHistoryProject>();
  for (const row of regroup(sums, (row) => JSON.stringify([row.project_id, row.provider_id, row.model, row.legacy]))) {
    const { usage } = priceGroup(core, row);
    const entry = totals.get(row.project_id);
    if (entry !== undefined) {
      entry.turns += row.turns;
      add(entry.usage, usage);
      continue;
    }
    totals.set(row.project_id, { projectId: row.project_id, name: null, removed: false, turns: row.turns, usage });
  }
  const names = projectNames(core, [...totals.keys()].filter((id): id is string => id !== null));
  for (const entry of totals.values()) {
    if (entry.projectId === null) continue;
    const named = names.get(entry.projectId);
    entry.name = named?.name ?? null;
    entry.removed = named?.removed ?? true;
  }
  return [...totals.values()];
}

export function usageHistory(core: Core, edges: number[], providerId?: ProviderId, projectId?: ProjectId | null): UsageHistory {
  const sums = core.journal.usageByBucket(edges);
  const kept = projectId === undefined ? sums : sums.filter((row) => row.project_id === projectId);
  const grouped = regroup(kept, (row) => JSON.stringify([row.bucket, row.provider_id, row.model, row.legacy])).sort(compareRows);
  // The turns an older core recorded come as their own group, which the row counts as estimated.
  const rows = new Map<string, UsageHistoryRow>();
  for (const row of grouped) {
    if (providerId !== undefined && row.provider_id !== providerId) continue;
    const cost = priceGroup(core, row);
    const estimated = row.legacy ? row.reported : 0;
    const key = JSON.stringify([row.bucket, row.provider_id, row.model]);
    const entry = rows.get(key);
    if (entry === undefined) {
      rows.set(key, {
        bucket: row.bucket,
        providerId: row.provider_id,
        model: row.model,
        turns: row.turns,
        reported: row.reported,
        priced: cost.priced,
        ...(estimated > 0 ? { estimated } : {}),
        usage: cost.usage,
        price: cost.price,
      });
      continue;
    }
    entry.turns += row.turns;
    entry.reported += row.reported;
    entry.priced += cost.priced;
    if (estimated > 0) entry.estimated = (entry.estimated ?? 0) + estimated;
    add(entry.usage, cost.usage);
    // The rate most of the joined writes paid, which neither group alone tells.
    entry.price = priceUsage(entry.model, entry.usage)?.price ?? entry.price ?? cost.price;
  }

  const threadRows = core.journal.usageByThread(edges[0]!, edges[edges.length - 1]!);
  const all = [...threadTotals(core, threadRows, providerId).values()].filter((thread) => projectId === undefined || thread.projectId === projectId);
  const rankings: ((thread: UsageHistoryThread) => number)[] = [
    (thread) => totalTokens(thread.usage),
    (thread) => thread.usage.costUsdEquivalent ?? 0,
    (thread) => thread.turns,
  ];
  const ranked = new Set<UsageHistoryThread>();
  for (const measure of rankings) {
    const order = all.filter((thread) => measure(thread) > 0).sort((a, b) => measure(b) - measure(a));
    for (const thread of order.slice(0, TOP_THREADS)) ranked.add(thread);
  }
  return { edges, rows: [...rows.values()], threads: [...ranked], projects: projectTotals(core, sums), pricing: pricingStatus() };
}

/** A group of one turn: its sums and route, priced as a history row. */
function priceTurn(core: Core, row: { usage: string | null; execution: string | null }, thread: { provider_id: string; model: string | null }) {
  const sums = turnSums(row.usage === null ? null : JSON.parse(row.usage) as Record<string, unknown>);
  const route = turnRoute(row.execution === null ? null : JSON.parse(row.execution) as { providerId?: unknown; model?: unknown } | null, thread);
  const cost = priceGroup(core, { ...sums, ...route });
  return { route, usage: sums.reported === 0 ? null : cost.usage, price: sums.reported === 0 ? null : cost.price };
}

/** One thread's finished turns over the range, each priced, and its subagents' totals (`usage.thread`). */
export function usageThread(core: Core, threadId: ThreadId, edges: number[]): UsageThreadDetail {
  const db = core.journal.db;
  const thread = db.query('SELECT id, title, project_id, provider_id, model, archived FROM threads WHERE id = ?').get(threadId) as
    { id: string; title: string; project_id: string | null; provider_id: string; model: string | null; archived: number } | null;
  if (thread === null) throw notFound(`threadId: no thread ${threadId}`, { field: 'threadId' });
  const from = edges[0]!;
  const to = edges[edges.length - 1]!;
  const newest = db.query(`SELECT id, finished_at, usage, execution FROM turns WHERE thread_id = ? AND finished_at >= ? AND finished_at < ?
    ORDER BY finished_at DESC, rowid DESC LIMIT ?`).all(threadId, from, to, USAGE_THREAD_TURNS_MAX + 1) as
    { id: string; finished_at: number; usage: string | null; execution: string | null }[];
  const truncated = newest.length > USAGE_THREAD_TURNS_MAX;
  const turns: UsageThreadTurn[] = newest.slice(0, USAGE_THREAD_TURNS_MAX).reverse().map((row) => {
    const { route, usage, price } = priceTurn(core, row, thread);
    return { turnId: row.id, finishedAt: row.finished_at, providerId: route.provider_id, model: route.model, usage, price };
  });
  const own = threadTotals(core, core.journal.usageByThread(from, to, [threadId])).get(threadId) ?? {
    threadId, title: thread.title, projectId: thread.project_id, providerId: thread.provider_id, archived: thread.archived !== 0, turns: 0, usage: emptyUsage(),
  };
  const childIds = (db.query('SELECT id FROM threads WHERE parent_thread_id = ?').all(threadId) as { id: string }[]).map((row) => row.id);
  const children = childIds.length === 0 ? [] : [...threadTotals(core, core.journal.usageByThread(from, to, childIds)).values()]
    .sort((a, b) => (b.usage.costUsdEquivalent ?? 0) - (a.usage.costUsdEquivalent ?? 0) || totalTokens(b.usage) - totalTokens(a.usage) || b.turns - a.turns);
  return { thread: own, turns, truncated, children };
}

function checkProject(projectId: unknown): ProjectId | null | undefined {
  if (projectId === undefined || projectId === null) return projectId;
  if (typeof projectId !== 'string' || !projectId.trim()) throw invalidParams('projectId: expected a project id or null', { field: 'projectId' });
  return projectId;
}

export function registerUsageMethods(core: Core): void {
  core.router.register('usage.get', (params) => usageOf(core, params.threadId));
  core.router.register('usage.history', (params) => {
    const edges = checkEdges(params?.edges);
    if (params.providerId !== undefined && (typeof params.providerId !== 'string' || !params.providerId.trim())) {
      throw invalidParams('providerId: expected a non-empty provider id', { field: 'providerId' });
    }
    return usageHistory(core, edges, params.providerId, checkProject(params.projectId));
  });
  core.router.register('usage.thread', (params) => {
    const edges = checkEdges(params?.edges);
    if (typeof params.threadId !== 'string' || !params.threadId.trim()) throw invalidParams('threadId: expected a thread id', { field: 'threadId' });
    return usageThread(core, params.threadId, edges);
  });
}
