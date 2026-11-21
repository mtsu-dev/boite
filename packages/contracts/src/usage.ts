import type { ProjectId, ProviderId, ThreadId, Timestamp, TurnId } from './ids';

/**
 * Tokens as four disjoint buckets, whatever the provider counts: `inputTokens`
 * holds neither the cache reads nor the cache writes, so the four add up to
 * what the model processed. The driver normalises them and the turn keeps
 * them as stored (`buckets`); nothing downstream depends on the provider that
 * ran it.
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * Of `cacheWriteTokens`, those written to a one-hour cache, which Anthropic
   * bills at twice the input rate. Absent when none were, and on turns an
   * older core recorded with no cache writes.
   */
  cacheWriteHourTokens?: number;
  /**
   * 1 on a turn's usage whose core normalised it into the buckets above.
   * Absent on a turn an older core recorded, whose split followed its
   * provider (Codex's input then held the cache), and on sums of turns.
   */
  buckets?: 1;
  /** API-equivalent cost. On a subscription this is not money spent; the UI says so. */
  costUsdEquivalent: number | null;
}

/**
 * An agent's own running totals as one of its turns ended, for an agent that
 * saves them with its session and restores them on resume (Claude: the
 * result's `total_cost_usd` and the tokens of its `modelUsage`).
 */
export interface AgentTotals {
  costUsd: number;
  /** Every token of the totals, cache included. */
  tokens: number;
  /**
   * The same tokens as `Usage` buckets, which a turn whose own usage reports
   * nothing (a Claude compaction) is measured against. Absent on turns an
   * older core recorded.
   */
  held?: Omit<Usage, 'buckets' | 'costUsdEquivalent'>;
  /**
   * The agent version seen restoring the session's totals on a resume, as a
   * result with tokens of its own showed. A later result with none, a Claude
   * compaction, reads as restored only from a process of that version.
   */
  restores?: string;
  /**
   * The thread's session generation these totals belong to, when it is not
   * the one the turn started on: a turn that took a session compacted in the
   * background ends on the next generation, which resumes from its totals.
   */
  sessionGeneration?: number;
}

/** Public API prices in US dollars per million tokens. */
export interface TokenRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The public model a usage row was priced as, with the rates its tokens were charged. */
export interface UsagePrice {
  /** The id in the core's price list, such as `claude-opus-5-5`. */
  model: string;
  rates: TokenRates;
}

/**
 * The finished turns of one provider and model whose `finishedAt` falls in
 * `[edges[bucket], edges[bucket + 1])` of a `usage.history` call.
 */
export interface UsageHistoryRow {
  bucket: number;
  providerId: ProviderId;
  /** Null when the turn ran on the provider's default model. */
  model: string | null;
  /** Finished turns, whether or not the agent reported its usage. */
  turns: number;
  /** Turns among them that carried a usage report. */
  reported: number;
  /**
   * Turns among them with an API-equivalent cost: every reported turn when the
   * row has a `price`, else the turns whose agent reported a cost.
   */
  priced: number;
  /**
   * Reported turns among them that an older core recorded (`Usage.buckets`
   * absent). Their split and hour writes are estimated from the protocol the
   * provider has now, so editing or removing it can change them. Absent when
   * none, and from an older core.
   */
  estimated?: number;
  /**
   * Sums over the reported turns, in the buckets each turn stored.
   * `costUsdEquivalent` is the tokens at `price`'s rates, or the sum
   * of the costs the agent reported when no rate matched the model; null when
   * neither gave one.
   */
  usage: Usage;
  /** The public rates the row was priced at. Null when none matched its model; absent from an older core. */
  price?: UsagePrice | null;
}

export interface UsageHistoryThread {
  threadId: ThreadId;
  title: string;
  projectId: ProjectId | null;
  providerId: ProviderId;
  archived: boolean;
  turns: number;
  usage: Usage;
}

/** What one project spent over a `usage.history` range. */
export interface UsageHistoryProject {
  /** Null for turns of threads that belong to no project. */
  projectId: ProjectId | null;
  /** The project's name, kept after it is removed; null when no row names it. */
  name: string | null;
  /** True when the project was removed from the list: its turns still count. */
  removed: boolean;
  turns: number;
  usage: Usage;
}

/** Where the public rates of a `usage.history` answer came from. */
export interface UsagePricing {
  /** `live`: fetched from `source` at `updatedAt`; `bundled`: the table shipped with this core. */
  origin: 'live' | 'bundled';
  source: string;
  updatedAt: Timestamp;
  /** Models the table prices. */
  models: number;
}

export interface UsageHistory {
  edges: Timestamp[];
  rows: UsageHistoryRow[];
  /**
   * The threads that spent the most over the whole range, by tokens, by cost
   * and by turns, so a client can rank by any of the three. Unordered.
   */
  threads: UsageHistoryThread[];
  /**
   * Every project with a finished turn in the range, with its totals, removed
   * projects included. Ignores the `projectId` filter so a client can offer
   * the others. Absent from an older core.
   */
  projects?: UsageHistoryProject[];
  /** Absent from an older core. */
  pricing?: UsagePricing;
}

/** One finished turn of a `usage.thread` answer. */
export interface UsageThreadTurn {
  turnId: TurnId;
  finishedAt: Timestamp;
  providerId: ProviderId;
  model: string | null;
  /** Its own usage, priced like a history row; null when the agent reported none. */
  usage: Usage | null;
  price: UsagePrice | null;
}

export interface UsageThreadDetail {
  thread: UsageHistoryThread;
  /** Turns that reported usage and turns that have a price across the entire filtered range. */
  reported: number;
  priced: number;
  /** Finished turns in the range, oldest first, at most `USAGE_THREAD_TURNS_MAX` (the newest). */
  turns: UsageThreadTurn[];
  /** True when older turns in the range were left out. */
  truncated: boolean;
  /** The thread's subagents with their own totals over the range, biggest first. */
  children: UsageHistoryThread[];
}

export const USAGE_THREAD_TURNS_MAX = 2000;

export interface UsageRpcMethods {
  'usage.get': {
    params: { threadId?: ThreadId };
    result: { byThread: Record<ThreadId, Usage>; total: Usage };
  };
  /**
   * Finished turns summed per bucket, provider and model. `edges` are 2 to 367
   * ascending timestamps chosen by the client, usually its local midnights, so
   * a day follows the reader's calendar whatever the core's time zone.
   * Optional `providerId` filters execution snapshots before ranking threads.
   * Optional `projectId` keeps the turns of one project's threads; `null`
   * keeps the turns of threads in no project.
   */
  'usage.history': { params: { edges: Timestamp[]; providerId?: ProviderId; projectId?: ProjectId | null }; result: UsageHistory };
  /**
   * One thread's finished turns over `[edges[0], edges[last])`, each priced,
   * for the page of a thread that spent much. Removed projects' threads too.
   * Optional `providerId` filters its turns and subagents by execution provider.
   */
  'usage.thread': { params: { threadId: ThreadId; edges: Timestamp[]; providerId?: ProviderId }; result: UsageThreadDetail };
}
