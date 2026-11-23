import { USAGE_THREAD_TURNS_MAX } from '@boite/contracts';
import type { ProjectId, ThreadId, TokenRates, Usage, UsageHistory, UsageHistoryProject, UsageHistoryRow, UsageHistoryThread, UsagePrice, UsagePricing, UsageThreadDetail, UsageThreadTurn } from '@boite/contracts';

/**
 * The ledger `?fake=1` answers `usage.history` from: about a hundred days of
 * several providers, with a weekday rhythm, derived from the calendar day so a
 * reload draws the same page. It follows the core's contract: the four token
 * buckets are disjoint, a model with public rates is priced at them, and a
 * model without rates or a reported cost has a null cost.
 */

/** A turn the fake itself finished during this session. */
export interface FakeFinishedTurn {
  at: number;
  threadId: ThreadId;
  title: string;
  projectId: string | null;
  providerId: string;
  model: string | null;
  usage: Usage;
}

/** The rates the core's price list gives these models, USD per million tokens. */
function rated(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): UsagePrice {
  const rates: TokenRates = { input, output, cacheRead, cacheWrite };
  return { model, rates };
}

interface Profile {
  providerId: string;
  /** `price` is what the core prices the model at; a reported cost stands in where it has none. */
  models: { id: string | null; share: number; price?: UsagePrice; reported?: TokenRates }[];
  /** Turns on a busy weekday. */
  perDay: number;
  /** Days before today the provider was first used. */
  since: number;
  /** Chance that a day has no turn at all. */
  idle: number;
  /** Tokens per turn: input without cache, output, cache read, cache write. */
  tokens: [number, number, number, number];
  /** Its turns write the one-hour cache, as Claude Code does. */
  hourCache?: boolean;
  /**
   * The threads its turns land in, most recent first, in `p-boite` unless
   * `project` says otherwise (null: no project); `parent` makes it a subagent.
   */
  threads: { id: ThreadId; title: string; project?: ProjectId | null; parent?: ThreadId }[];
}

/** The projects the ledger names besides the seeded ones (`seed.ts`): one removed since. */
const LEDGER_PROJECTS: Record<string, { name: string; removed: boolean }> = {
  'p-boite': { name: 'boite', removed: false },
  'p-notes': { name: 'notes', removed: false },
  'p-prototype': { name: 'prototype', removed: true },
};

/** Where the ledger says its rates came from, as the core's bundled table would. */
const LEDGER_PRICING: UsagePricing = { origin: 'bundled', source: 'https://models.dev/api.json', updatedAt: Date.UTC(2026, 10, 12), models: 412 };

const PROFILES: Profile[] = [
  {
    providerId: 'claude',
    // Claude Code writes its cache for an hour, twice the input rate.
    models: [
      { id: 'claude-opus-5-5', share: 0.45, price: rated('claude-opus-5-5', 4, 20, 0.2, 8) },
      { id: 'claude/claude-opus-5-5', share: 0.15, price: rated('claude-opus-5-5', 4, 20, 0.2, 8) },
      { id: 'claude-sonnet-5-5', share: 0.3, price: rated('claude-sonnet-5-5', 2, 10, 0.1, 4) },
      { id: 'claude-haiku-5-5', share: 0.1, price: rated('claude-haiku-5-5', 0.1, 0.5, 0.01, 0.2) },
    ],
    perDay: 42, since: 104, idle: 0.03,
    tokens: [2_600, 1_800, 61_000, 7_200],
    hourCache: true,
    threads: [
      { id: 't-trace', title: 'Finish the trace tab' },
      { id: 'u-claude-panel', title: 'Right panel with changes and files' },
      { id: 'u-claude-cli', title: 'boite CLI for agents', parent: 't-trace' },
      { id: 'u-claude-phone', title: 'Phone settings split', project: 'p-notes' },
      { id: 'u-claude-dictation', title: 'Dictation and attachments' },
      { id: 'u-claude-platform', title: 'Isolate the OS backends' },
      { id: 'u-claude-onboarding', title: 'First run without a provider' },
    ],
  },
  {
    providerId: 'codex',
    models: [{ id: 'gpt-6.1-sol', share: 0.75, price: rated('gpt-6.1-sol', 2, 10, 0.1, 2.5) }, { id: null, share: 0.25 }],
    perDay: 22, since: 92, idle: 0.1,
    tokens: [8_400, 2_300, 39_000, 0],
    threads: [
      { id: 't-scheduler', title: 'Port the scheduler' },
      { id: 'u-codex-install', title: 'Managed Codex install' },
      { id: 'u-codex-quota', title: 'Read the Codex rate limits' },
      { id: 'u-codex-review', title: 'Review the journal migration', parent: 't-scheduler' },
    ],
  },
  {
    providerId: 'opencode',
    models: [{ id: null, share: 1, reported: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0 } }],
    perDay: 8, since: 71, idle: 0.3,
    tokens: [5_800, 1_300, 21_000, 0],
    threads: [
      { id: 't-bench', title: 'Bench against legacy' },
      { id: 'u-opencode-acp', title: 'ACP permission cards', project: 'p-prototype' },
    ],
  },
  {
    providerId: 'grok',
    models: [{ id: 'grok-code-fast-2', share: 1 }],
    perDay: 10, since: 37, idle: 0.25,
    tokens: [7_200, 1_600, 18_000, 0],
    threads: [
      { id: 'u-grok-search', title: 'Workspace search ranking' },
      { id: 'u-grok-titles', title: 'Shorter thread titles', project: null },
    ],
  },
  {
    providerId: 'antigravity',
    models: [{ id: null, share: 1 }],
    perDay: 5, since: 23, idle: 0.5,
    tokens: [9_500, 2_100, 12_000, 0],
    threads: [{ id: 'u-antigravity-quota', title: 'Antigravity quota reader' }],
  },
  {
    providerId: 'pi',
    models: [{ id: 'claude-sonnet-5-5', share: 1, price: rated('claude-sonnet-5-5', 2, 10, 0.1, 2.5) }],
    perDay: 4, since: 58, idle: 0.55,
    tokens: [3_100, 1_200, 26_000, 3_000],
    threads: [{ id: 't-descriptors', title: 'Review the descriptor loader' }],
  },
  {
    providerId: 'muse', models: [{ id: 'default', share: 1 }],
    perDay: 6, since: 17, idle: 0.2,
    tokens: [3_500, 1_500, 15_000, 0],
    threads: [{ id: 'u-muse-tools', title: 'Map the Muse tools' }],
  },
];

const DAY = 86_400_000;

/** A small deterministic generator, so a day draws the same numbers every time. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function localMidnight(at: number): Date {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day;
}

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null };
}

function addUsage(into: Usage, from: Usage): void {
  into.inputTokens += from.inputTokens;
  into.outputTokens += from.outputTokens;
  into.cacheReadTokens += from.cacheReadTokens;
  into.cacheWriteTokens += from.cacheWriteTokens;
  const hour = (into.cacheWriteHourTokens ?? 0) + (from.cacheWriteHourTokens ?? 0);
  if (hour > 0) into.cacheWriteHourTokens = hour;
  if (from.costUsdEquivalent !== null) into.costUsdEquivalent = (into.costUsdEquivalent ?? 0) + from.costUsdEquivalent;
}

interface Group {
  at: number;
  threadId: ThreadId;
  parentId?: ThreadId;
  title: string;
  projectId: string | null;
  providerId: string;
  model: string | null;
  turns: number;
  reported: number;
  priced: number;
  usage: Usage;
  price: UsagePrice | null;
}

/** What one calendar day of the seed spent, as groups of turns sharing a thread and a model. */
function seededDay(day: Date, today: Date, now: number): Group[] {
  const age = Math.round((today.getTime() - day.getTime()) / DAY);
  const weekday = day.getDay();
  const rhythm = weekday === 0 ? 0.18 : weekday === 6 ? 0.3 : 1;
  // Busier towards today, the way a project picks up.
  const trend = 0.55 + 0.5 * Math.max(0, 1 - age / 100);
  // Today is still going.
  const elapsed = age === 0 ? Math.max(0.2, (now - day.getTime()) / DAY) : 1;
  const stamp = day.getFullYear() * 10_000 + (day.getMonth() + 1) * 100 + day.getDate();
  const groups: Group[] = [];
  PROFILES.forEach((profile, index) => {
    if (age > profile.since) return;
    const draw = random(stamp * 31 + index * 7919);
    if (draw() < profile.idle) return;
    const count = Math.round(profile.perDay * rhythm * trend * elapsed * (0.55 + draw() * 0.9));
    if (count === 0) return;
    const thread = profile.threads[Math.floor(age / 5) % profile.threads.length]!;
    for (const model of profile.models) {
      const turns = Math.round(count * model.share);
      if (turns === 0) continue;
      const reported = turns - (draw() < 0.3 ? 1 : 0);
      const scale = reported * (0.75 + draw() * 0.5);
      const [input, output, cacheRead, cacheWrite] = profile.tokens.map((tokens) => Math.round(tokens * scale)) as [number, number, number, number];
      const rates = model.price?.rates ?? model.reported ?? null;
      const usage: Usage = {
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        ...(profile.hourCache && cacheWrite > 0 ? { cacheWriteHourTokens: cacheWrite } : {}),
        costUsdEquivalent: rates === null ? null : (input * rates.input + output * rates.output + cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite) / 1_000_000,
      };
      groups.push({
        at: day.getTime() + Math.min(DAY - 1, (13 + index) * 3_600_000),
        threadId: thread.id,
        ...(thread.parent === undefined ? {} : { parentId: thread.parent }),
        title: thread.title,
        projectId: thread.project === undefined ? 'p-boite' : thread.project,
        providerId: profile.providerId,
        model: model.id,
        turns,
        reported,
        priced: rates === null ? 0 : reported,
        usage,
        price: model.price ?? null,
      });
    }
  });
  return groups.filter((group) => group.at <= now);
}

type ProjectName = Pick<UsageHistoryProject, 'name' | 'removed'>;
type ThreadName = Pick<UsageHistoryThread, 'title' | 'projectId' | 'providerId' | 'archived'>;

interface LedgerOptions {
  seeded: boolean;
  finished: FakeFinishedTurn[];
  projects?: ReadonlyMap<ProjectId, ProjectName>;
  threads?: ReadonlyMap<ThreadId, ThreadName>;
  visibleOnly?: boolean;
  now?: number;
}

function projectName(options: LedgerOptions, projectId: ProjectId): ProjectName | undefined {
  return options.projects?.get(projectId) ?? LEDGER_PROJECTS[projectId];
}

function visibleGroup(group: Group, options: LedgerOptions): boolean {
  // Seeded turns can name a project different from the current thread's.
  return !options.visibleOnly || options.threads?.has(group.threadId) === true
    && (group.projectId === null || options.projects?.get(group.projectId)?.removed === false);
}

/** The ledger's groups over `[edges[0], edges[last])`. */
function ledger(edges: readonly number[], options: LedgerOptions): Group[] {
  const now = options.now ?? Date.now();
  const first = edges[0]!;
  const last = edges[edges.length - 1]!;
  const groups: Group[] = [];
  if (options.seeded) {
    const today = localMidnight(now);
    for (let day = localMidnight(first); day.getTime() < last && day.getTime() <= now; day.setDate(day.getDate() + 1)) {
      groups.push(...seededDay(new Date(day), today, now));
    }
  }
  for (const turn of options.finished) {
    // A turn finished here is priced like the seeded ones: at its model's rates when the ledger lists them.
    const price = PROFILES.find((profile) => profile.providerId === turn.providerId)?.models.find((model) => model.id === turn.model)?.price ?? null;
    const usage = { ...turn.usage };
    if (price !== null) usage.costUsdEquivalent = (usage.inputTokens * price.rates.input + usage.outputTokens * price.rates.output + usage.cacheReadTokens * price.rates.cacheRead + usage.cacheWriteTokens * price.rates.cacheWrite) / 1_000_000;
    groups.push({ ...turn, turns: 1, reported: 1, priced: usage.costUsdEquivalent === null ? 0 : 1, usage, price });
  }
  return groups.filter((group) => group.at >= first && group.at < last);
}

/** A thread's totals over the groups given, named as `usage.history` names it. */
function threadTotals(groups: readonly Group[], options: LedgerOptions, providerId?: string): Map<ThreadId, UsageHistoryThread> {
  const threads = new Map<ThreadId, UsageHistoryThread>();
  for (const group of groups) {
    const named = options.threads?.get(group.threadId);
    const thread = threads.get(group.threadId) ?? {
      threadId: group.threadId,
      title: named?.title ?? group.title,
      projectId: group.projectId,
      providerId: providerId ?? named?.providerId ?? group.providerId,
      archived: named?.archived ?? (group.threadId.startsWith('u-') || (group.projectId !== null && projectName(options, group.projectId)?.removed === true)),
      turns: 0,
      usage: emptyUsage(),
    };
    thread.turns += group.turns;
    addUsage(thread.usage, group.usage);
    threads.set(group.threadId, thread);
  }
  return threads;
}

/** Whether the ledger or this session's turns know `threadId`. */
export function fakeUsageKnows(threadId: ThreadId, finished: readonly FakeFinishedTurn[]): boolean {
  return finished.some((turn) => turn.threadId === threadId) || PROFILES.some((profile) => profile.threads.some((thread) => thread.id === threadId));
}

export function fakeUsageHistory(edges: number[], options: LedgerOptions & { providerId?: string; projectId?: ProjectId | null }): UsageHistory {
  const groups = ledger(edges, options);
  const projects = new Map<ProjectId | null, UsageHistoryProject>();
  for (const group of groups) {
    const known = group.projectId === null ? undefined : projectName(options, group.projectId);
    const project = projects.get(group.projectId) ?? { projectId: group.projectId, name: group.projectId === null ? null : known?.name ?? null, removed: group.projectId !== null && (known?.removed ?? true), turns: 0, usage: emptyUsage() };
    project.turns += group.turns;
    addUsage(project.usage, group.usage);
    projects.set(group.projectId, project);
  }
  const { projectId } = options;
  const hiddenProject = options.visibleOnly && typeof projectId === 'string' && options.projects?.get(projectId)?.removed !== false;
  const kept = hiddenProject ? [] : groups.filter(group => (options.providerId === undefined || group.providerId === options.providerId)
    && (projectId === undefined || group.projectId === projectId));
  const rows = new Map<string, UsageHistoryRow>();
  for (const group of kept) {
    let bucket = 0;
    while (edges[bucket + 1]! <= group.at) bucket += 1;
    const key = `${bucket}\u0000${group.providerId}\u0000${group.model ?? ''}`;
    const row = rows.get(key) ?? { bucket, providerId: group.providerId, model: group.model, turns: 0, reported: 0, priced: 0, usage: emptyUsage(), price: group.price };
    row.turns += group.turns;
    row.reported += group.reported;
    row.priced += group.priced;
    addUsage(row.usage, group.usage);
    rows.set(key, row);
  }
  const ordered = [...rows.values()].sort((a, b) => a.bucket - b.bucket || a.providerId.localeCompare(b.providerId) || (a.model ?? '').localeCompare(b.model ?? ''));
  const eligible = options.visibleOnly ? kept.filter(group => visibleGroup(group, options)) : kept;
  return {
    edges: [...edges], rows: ordered, threads: [...threadTotals(eligible, options, options.providerId).values()],
    projects: [...projects.values()].filter(project => !options.visibleOnly || !project.removed),
    pricing: { ...LEDGER_PRICING },
  };
}

/**
 * `usage.thread` over the ledger: each group's turns spread one minute apart
 * from its time, the group's usage shared between its reported turns.
 */
export function fakeUsageThread(threadId: ThreadId, edges: number[], options: LedgerOptions & { providerId?: string }): UsageThreadDetail {
  const { providerId } = options;
  const groups = ledger(edges, options).filter(group => (providerId === undefined || group.providerId === providerId)
    && visibleGroup(group, options));
  const own = groups.filter((group) => group.threadId === threadId);
  const turns: UsageThreadTurn[] = [];
  let reported = 0;
  let priced = 0;
  for (const group of own) {
    reported += group.reported;
    priced += group.priced;
    for (let index = 0; index < group.turns; index++) {
      const share = (count: number) => Math.round(count / Math.max(1, group.reported));
      const usage: Usage | null = index >= group.reported ? null : {
        inputTokens: share(group.usage.inputTokens),
        outputTokens: share(group.usage.outputTokens),
        cacheReadTokens: share(group.usage.cacheReadTokens),
        cacheWriteTokens: share(group.usage.cacheWriteTokens),
        ...(group.usage.cacheWriteHourTokens ? { cacheWriteHourTokens: share(group.usage.cacheWriteHourTokens) } : {}),
        costUsdEquivalent: group.usage.costUsdEquivalent === null ? null : group.usage.costUsdEquivalent / Math.max(1, group.reported),
      };
      turns.push({ turnId: `${threadId}-${group.at}-${group.model ?? 'default'}-${index}`, finishedAt: group.at + index * 60_000, providerId: group.providerId, model: group.model, usage, price: usage === null ? null : group.price });
    }
  }
  turns.sort((a, b) => a.finishedAt - b.finishedAt);
  const truncated = turns.length > USAGE_THREAD_TURNS_MAX;
  const finished = options.finished.find((turn) => turn.threadId === threadId);
  const named = PROFILES.flatMap((profile) => profile.threads.map((thread) => ({ ...thread, providerId: profile.providerId }))).find((thread) => thread.id === threadId);
  const known = options.threads?.get(threadId);
  const thread = threadTotals(own, options, providerId).get(threadId) ?? {
    threadId,
    title: known?.title ?? named?.title ?? finished?.title ?? '',
    projectId: known ? known.projectId : named === undefined ? finished?.projectId ?? null : named.project === undefined ? 'p-boite' : named.project,
    providerId: providerId ?? known?.providerId ?? named?.providerId ?? finished?.providerId ?? '',
    archived: known?.archived ?? threadId.startsWith('u-'),
    turns: 0,
    usage: emptyUsage(),
  };
  const cost = (entry: UsageHistoryThread) => entry.usage.costUsdEquivalent ?? 0;
  const tokens = (entry: UsageHistoryThread) => entry.usage.inputTokens + entry.usage.outputTokens + entry.usage.cacheReadTokens + entry.usage.cacheWriteTokens;
  const children = [...threadTotals(groups.filter(group => group.parentId === threadId), options, providerId).values()]
    .sort((a, b) => cost(b) - cost(a) || tokens(b) - tokens(a) || b.turns - a.turns);
  return { thread, reported, priced, turns: truncated ? turns.slice(-USAGE_THREAD_TURNS_MAX) : turns, truncated, children };
}
