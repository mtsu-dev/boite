import type { ThreadId, Timestamp } from './ids';

/**
 * The council (`docs/internals/council.md`), after Theo Browne's council skill
 * (t3dotgg/tstack, MIT): delegated agents of different providers each answer
 * one request alone and read-only, with a score out of 10. They never read each
 * other's answers. Their answers return to the starting thread; its user's
 * instructions determine how it uses them and whether another round runs.
 * The owner follows it in a salon, a projectless thread that runs no agent,
 * and may write there.
 */
export const COUNCIL_LIMITS = {
  membersMin: 2,
  membersMax: 6,
  /** Per round: a review at xhigh effort often takes more than ten minutes. */
  timeoutMinutesDefault: 30,
  timeoutMinutesMax: 120,
  /** A request, or what changed since the last round. */
  requestChars: 12_000,
  /** What one member is told beside the request all of them read. */
  roleChars: 200,
  /** An owner's message in the salon. */
  postChars: 4000,
  /** What one answer keeps in the salon; the rest stays in the member's thread. */
  answerChars: 12_000,
  /** What one round's answers may take in the message to the parent, shared evenly between the members. */
  deliveredChars: 24_000,
} as const;

/**
 * One flagship per provider. The catalogue does not say which model of a
 * provider is its flagship, so the default is written here; `--models` replaces it.
 */
export const COUNCIL_DEFAULT_MODELS = ['claude/claude-opus-5-5', 'codex/gpt-6.1-sol', 'antigravity/gemini-4-argon'] as const;
export const COUNCIL_DEFAULT_EFFORT = 'xhigh';

/**
 * A member as `--models` writes it: `provider/model`, or `provider/model:effort`
 * for a level of its own. Only a colon after the last slash splits, and the
 * caller keeps the whole text when it is itself a listed route, as a model id
 * may hold a colon.
 */
export function councilSplitEffort(entry: string): { model: string; effort: string } | null {
  const at = entry.lastIndexOf(':');
  if (at <= entry.lastIndexOf('/') || at === entry.length - 1) return null;
  const model = entry.slice(0, at).trim(), effort = entry.slice(at + 1).trim();
  return model && effort ? { model, effort } : null;
}

const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** The strongest of a model's levels that is not above the one asked. Null when none can be compared, as names like `fast` cannot. */
export function councilNearestEffort(levels: readonly string[], asked: string): string | null {
  const limit = EFFORT_ORDER.indexOf(asked);
  return levels.filter(level => EFFORT_ORDER.includes(level) && EFFORT_ORDER.indexOf(level) <= limit)
    .sort((a, b) => EFFORT_ORDER.indexOf(b) - EFFORT_ORDER.indexOf(a))[0] ?? null;
}

/**
 * The experiment's id, under the feature's first name. Every device stores it
 * and an app drops the ids it does not know, so a new id would turn the feature
 * off for whoever had it on, and an older phone would keep reporting this one.
 */
export const COUNCIL_EXPERIMENT = 'debates';

/** The owner's posts. */
export const COUNCIL_OWNER = 'owner';
/** What the parent says changed before a new round. */
export const COUNCIL_AUTHOR = 'author';
/** The salon's own lines: a member that did not answer, a stop. */
export const COUNCIL_SYSTEM = 'system';
/** A summary written for a debate stored before the council, still readable in its salon. */
export const COUNCIL_LEGACY_SUMMARY = 'summary';

/**
 * `running`: a round is under way. `waiting`: the round ended, its answers go or
 * went to the parent, and the members stay for the next one. Then one of the
 * three ends: `done` closed between rounds, `stopped` cut during one, `failed`.
 */
export type CouncilStatus = 'running' | 'waiting' | 'done' | 'stopped' | 'failed';

/**
 * How a member is kept from changing anything. `native`: the provider's own
 * read-only mode (plan, a read-only sandbox, write and shell tools off).
 * `approvals`: no such mode, so Boite refuses every permission request of the
 * member. `none`: the provider asks for nothing and has no read-only mode,
 * reported at start.
 */
export type CouncilReadOnly = 'native' | 'approvals' | 'none';

export interface CouncilMember {
  /** `p1`, `p2`… in launch order. */
  id: string;
  /** The model's name, unique in this council: the salon and the table name it so. */
  name: string;
  /** What `@` matches in the salon: the name's first word, made unique. */
  handle: string;
  providerId: string;
  model: string;
  effort: string | null;
  /** What this member alone is told beside the request, every round. Absent when it has none. */
  role?: string;
  /** Its delegated thread, the same every round; null before it is created. */
  threadId: ThreadId | null;
  readOnly: CouncilReadOnly;
  /** Rounds it did not answer in time. */
  absent: number[];
  /** Asked in the current round and not answered yet. */
  pending: boolean;
  /** Its score per round, by position; null when it gave none. Never made up. */
  scores: (number | null)[];
}

export interface Council {
  /** `cnl_…`, or `dbt_…` for a debate stored before the council. */
  id: string;
  request: string;
  /** The thread that started it: each round's answers come back there. */
  parentThreadId: ThreadId;
  /** The salon. */
  salonThreadId: ThreadId;
  /** The round under way or last played, 0 before the first. */
  round: number;
  /** Rounds that closed; a round stopped halfway is not one and stays out of the table. */
  roundsDone: number;
  status: CouncilStatus;
  members: CouncilMember[];
  timeoutMinutes: number;
  /** Why it stopped or failed, for the owner. */
  note: string | null;
  /** The last round's answers, or why there are none, reached the parent. */
  delivered: boolean;
  /** When the current round closes on its own. */
  roundDeadline: Timestamp | null;
  /** Read-only levels short of `native` and efforts a model lacks, named at start. */
  warnings: string[];
  /** A debate stored before the council: read-only history without scores. */
  legacy?: true;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt: Timestamp | null;
  /** Bumped by every change of the council or its posts. */
  version: number;
}

export interface CouncilPost {
  id: string;
  councilId: string;
  /** Order in the council, from 1. */
  seq: number;
  /** The round it belongs to: an owner's message belongs to the round it will be read in. */
  round: number;
  /** A member id, `owner`, `author`, `system`, or `summary` in a stored debate. */
  author: string;
  text: string;
  /** An owner's message aimed at one member (`@handle`), null for all. */
  to: string | null;
  /** The owner's message a targeted member answers. */
  inReplyTo: string | null;
  createdAt: Timestamp;
}

/** Each model's name made unique: the same route twice would read as one row of the table. */
export function councilNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map(name => {
    let unique = name;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name} ${n}`;
    taken.add(unique.toLowerCase());
    return unique;
  });
}

/** Each model's name made into a word `@` can match: its first word, then the whole name, then numbered. */
export function councilHandles(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map(name => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const first = (words[0] ?? 'ai').replace(/[^\p{L}\p{N}_.-]/gu, '') || 'ai';
    const whole = words.join('-').replace(/[^\p{L}\p{N}_.-]/gu, '') || first;
    let handle = [first, whole].find(candidate => !taken.has(candidate.toLowerCase())) ?? first;
    for (let n = 2; taken.has(handle.toLowerCase()); n++) handle = `${first}${n}`;
    taken.add(handle.toLowerCase());
    return handle;
  });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What may not follow a mention: more of a word, or a dot that goes on with
 * one, so `@GPT-5.5` is not found in `@GPT-5.5.1`. A sentence's full stop may.
 */
export const COUNCIL_MENTION_END = '(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}_-])';

/** The member a text names first with `@handle` or `@name`, case-insensitive. */
export function councilMention(text: string, members: readonly Pick<CouncilMember, 'id' | 'handle' | 'name'>[]): string | null {
  let first: { id: string; at: number } | null = null;
  for (const member of members) {
    for (const word of [member.name, member.handle]) {
      const match = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escape(word.trim())}${COUNCIL_MENTION_END}`, 'iu').exec(text);
      if (match && word.trim() !== '' && (first === null || match.index < first.at)) first = { id: member.id, at: match.index };
    }
  }
  return first?.id ?? null;
}

/** Finished one way or another: no round or delivery is left to run. */
export function councilOver(council: Pick<Council, 'status'>): boolean {
  return council.status === 'done' || council.status === 'stopped' || council.status === 'failed';
}

/** The words of the table. Agents and pull requests read them in English, the salon in the app's language. */
export const COUNCIL_TABLE_WORDS = { title: 'Council review', rounds: 'Rounds: {count}', delegate: 'Delegate', round: 'Round {round}', noScore: 'no score' };

/** A score as the table writes it; no score is never a number. */
export function councilScore(score: number | null | undefined, noScore: string = COUNCIL_TABLE_WORDS.noScore): string {
  return typeof score === 'number' ? `${score}/10` : noScore;
}

const cell = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|');

/** A role on one line, cut to what a row or a heading can hold. */
export function councilRoleBrief(role: string | undefined): string {
  const line = role?.replace(/\s+/g, ' ').trim() ?? '';
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

/** A member as the table, the round's message and `delegate list` name it: its name, then its effort and the start of its role. */
export function councilLabel(member: Pick<CouncilMember, 'name' | 'effort' | 'role'>): string {
  const extra = [member.effort, councilRoleBrief(member.role)].filter(Boolean);
  return extra.length > 0 ? `${member.name} (${extra.join(', ')})` : member.name;
}

/** The `## Council review` section: the same text for a pull request's description, a final reply and the salon. */
export function councilTable(council: Pick<Council, 'roundsDone' | 'members'>, words: typeof COUNCIL_TABLE_WORDS = COUNCIL_TABLE_WORDS): string {
  const rounds = Array.from({ length: council.roundsDone }, (_, index) => index);
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    `## ${words.title}`,
    '',
    words.rounds.replace('{count}', String(council.roundsDone)),
    '',
    row([words.delegate, ...rounds.map(index => words.round.replace('{round}', String(index + 1)))]),
    row(['---', ...rounds.map(() => '---')]),
    ...council.members.map(member => row([cell(councilLabel(member)), ...rounds.map(index => councilScore(member.scores[index], words.noScore))])),
  ].join('\n');
}

export interface CouncilRpcMethods {
  /**
   * Starts a council from the thread `threadId` and returns at once. `models`
   * are `provider/model` routes of `boite delegate models`, one per member, each
   * with its own level as `provider/model:effort` or else `effort`; without them,
   * `COUNCIL_DEFAULT_MODELS`. A provider may sit more than once; the same model
   * at the same effort may not. A level written on a route that its model lacks
   * refuses the council, as does a route that cannot run: a member is never
   * replaced. `roles` gives a member, named as `models` writes it, a text of its
   * own beside the request. Refused while the experiment is off.
   */
  'council.start': {
    params: { threadId: ThreadId; request: string; models?: string[]; effort?: string | null; roles?: Record<string, string>; timeoutMinutes?: number; requestId?: string };
    result: Council;
  };
  /**
   * A fresh round: the same members, with their efforts and roles, in the same
   * threads review again from zero. `request` replaces the council's request from
   * this round on. `changes` is kept in the salon and reaches the members only
   * with `sendChanges`. `threadId` is the calling agent's thread.
   */
  'council.again': { params: { councilId: string; changes?: string; request?: string; sendChanges?: boolean; threadId?: ThreadId; requestId?: string }; result: Council };
  /** The councils a thread started, or every council for the owner without one. Newest first. */
  'council.list': { params: { threadId?: ThreadId }; result: { councils: Council[] } };
  'council.get': { params: { councilId: string }; result: { council: Council; posts: CouncilPost[] } };
  /** The `## Council review` section so far. `threadId` is the calling agent's thread. */
  'council.table': { params: { councilId: string; threadId?: ThreadId }; result: { table: string; council: Council } };
  /** The owner writes in the salon: read by every member next round, or by one named with `@`. `id` makes a retry return the same post. */
  'council.post': { params: { councilId: string; text: string; id?: string }; result: CouncilPost };
  /** Closes the current round now: who has not answered is absent from it, with no score. */
  'council.closeRound': { params: { councilId: string }; result: Council };
  /** Ends the council and stops what still runs; nothing goes back to the parent. `threadId` is the calling agent's thread. */
  'council.stop': { params: { councilId: string; threadId?: ThreadId }; result: Council };
}

export interface CouncilRpcEvents {
  /** Invalidation: a council or its posts changed. `threadId` is the parent thread. */
  'council.changed': { councilId: string; threadId: ThreadId; salonThreadId: ThreadId; version: number };
}
