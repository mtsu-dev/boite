import type { ThreadId, Timestamp } from './ids';

/**
 * Debates between AIs (`docs/debates.md`): a few delegated agents answer one
 * topic in rounds, blind first, then reading each other under anonymous
 * letters, and a fresh agent that did not debate writes the summary that goes
 * back to the thread that started it. The owner follows them in a salon, a
 * projectless thread that runs no agent, and may write there.
 */
export const DEBATE_LIMITS = {
  participantsMin: 2,
  participantsMax: 6,
  roundsMin: 1,
  roundsMax: 5,
  roundsDefault: 3,
  timeoutMinutesDefault: 10,
  timeoutMinutesMax: 60,
  topicChars: 4000,
  angleChars: 200,
  /** An owner's message in the salon. */
  postChars: 4000,
  /** What one answer keeps; the rest is cut with a mark. */
  answerChars: 12_000,
  /** What reaches the parent thread, like a delegation result. */
  summaryChars: 4000
} as const;

export const DEBATE_SUMMARY_MODEL = 'claude/claude-opus-5-5';
/** The owner's posts. */
export const DEBATE_OWNER = 'owner';
/** The summarizer's post. */
export const DEBATE_SUMMARY = 'summary';
/** The salon's own lines: a round that could not go on, a stop. */
export const DEBATE_SYSTEM = 'system';

/** `running`: rounds go on. `summarizing`: the summarizer writes. Then one of the three ends. */
export type DebateStatus = 'running' | 'summarizing' | 'done' | 'stopped' | 'failed';

/**
 * How a debater is kept from changing anything. `native`: the provider's own
 * read-only mode (plan, a read-only sandbox, write and shell tools off).
 * `approvals`: no such mode, so Boite refuses every permission request of the
 * debater. `none`: the provider asks for nothing and has no read-only mode,
 * reported at start.
 */
export type DebateReadOnly = 'native' | 'approvals' | 'none';

export interface DebateParticipant {
  /** `p1`, `p2`… in launch order. */
  id: string;
  /** The anonymous letter the other debaters read: drawn once at start, then fixed. */
  letter: string;
  /** The model's name as the owner reads it. */
  name: string;
  /** What `@` matches in the salon: the name's first word, made unique. */
  handle: string;
  providerId: string;
  model: string;
  effort: string | null;
  /** The angle it argues from (`--angles`), null without one. */
  angle: string | null;
  /** Its delegated thread, null before it is created. */
  threadId: ThreadId | null;
  readOnly: DebateReadOnly;
  /** Rounds it did not answer in time. */
  absent: number[];
  /** Asked in the current round and not answered yet. */
  pending: boolean;
}

export interface DebateSummarizer {
  name: string;
  providerId: string;
  model: string;
  effort: string | null;
  threadId: ThreadId | null;
  readOnly: DebateReadOnly;
}

/** One proposal of the last round's votes. */
export interface DebateTally {
  proposal: string;
  votes: number;
  /** Debaters who voted at all. */
  of: number;
  /** Participant ids. */
  voters: string[];
}

export interface Debate {
  /** `dbt_…` */
  id: string;
  topic: string;
  /** The thread that started it: the summary comes back there. */
  parentThreadId: ThreadId;
  /** The salon. */
  salonThreadId: ThreadId;
  rounds: number;
  /** The round under way or last played, 0 before the first. */
  round: number;
  status: DebateStatus;
  participants: DebateParticipant[];
  summarizer: DebateSummarizer;
  timeoutMinutes: number;
  /** The owner asked to conclude: the current round ends, then the summary. */
  concluding: boolean;
  /** Everyone defended the same proposal in round 1, so the debate went straight to the summary. */
  consensus: boolean;
  /** Why it stopped, failed or skipped rounds, for the owner. */
  note: string | null;
  summary: string | null;
  tally: DebateTally[];
  /** The summary reached the parent thread. */
  delivered: boolean;
  /** When the current round closes on its own. */
  roundDeadline: Timestamp | null;
  /** Read-only levels short of `native`, named at start. */
  warnings: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt: Timestamp | null;
  /** Bumped by every change of the debate or its posts. */
  version: number;
}

export interface DebatePost {
  id: string;
  debateId: string;
  /** Order in the debate, from 1. */
  seq: number;
  /** The round it belongs to: an owner's message belongs to the round it will be read in. */
  round: number;
  /** A participant id, `owner`, `summary` or `system`. */
  author: string;
  text: string;
  /** An owner's message aimed at one participant (`@handle`), null for all. */
  to: string | null;
  /** The owner's message a targeted debater answers. */
  inReplyTo: string | null;
  /** The proposal a last-round answer voted for, as written. */
  vote: string | null;
  createdAt: Timestamp;
}

const LETTERS = 'ABCDEF';

/** The letters for `count` debaters, in a random order drawn once. */
export function drawDebateLetters(count: number, random: () => number = Math.random): string[] {
  const letters = LETTERS.slice(0, count).split('');
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [letters[i], letters[j]] = [letters[j]!, letters[i]!];
  }
  return letters;
}

/** Each model's name made into a word `@` can match: its first word, then the whole name, then numbered. */
export function debateHandles(names: string[]): string[] {
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
export const DEBATE_MENTION_END = '(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}_-])';

/** The participant a text names first with `@handle` or `@name`, case-insensitive. */
export function debateMention(text: string, participants: readonly Pick<DebateParticipant, 'id' | 'handle' | 'name'>[]): string | null {
  let first: { id: string; at: number } | null = null;
  for (const participant of participants) {
    for (const word of [participant.name, participant.handle]) {
      const match = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escape(word.trim())}${DEBATE_MENTION_END}`, 'iu').exec(text);
      if (match && word.trim() !== '' && (first === null || match.index < first.at)) first = { id: participant.id, at: match.index };
    }
  }
  return first?.id ?? null;
}

/** Finished one way or another: no round, summary or delivery is left to run. */
export function debateOver(debate: Pick<Debate, 'status'>): boolean {
  return debate.status === 'done' || debate.status === 'stopped' || debate.status === 'failed';
}

export interface DebatesRpcMethods {
  /**
   * Starts a debate from the thread `threadId` and returns at once. `models`
   * are `provider/model` routes of `boite delegate models`, one per debater;
   * `angles`, when given, one per debater. Refused while the `debates`
   * experiment is off.
   */
  'debates.start': {
    params: { threadId: ThreadId; topic: string; models: string[]; rounds?: number; summary?: string; angles?: string[]; effort?: string | null; timeoutMinutes?: number; requestId?: string };
    result: Debate;
  };
  /** The debates a thread started, or every debate for the owner without one. Newest first. */
  'debates.list': { params: { threadId?: ThreadId }; result: { debates: Debate[] } };
  'debates.get': { params: { debateId: string }; result: { debate: Debate; posts: DebatePost[] } };
  /** The owner writes in the salon: read by every debater next round, or by one named with `@`. `id` makes a retry return the same post. */
  'debates.post': { params: { debateId: string; text: string; id?: string }; result: DebatePost };
  /** Closes the current round now: who has not answered is absent from it. */
  'debates.next': { params: { debateId: string }; result: Debate };
  /** Lets the current round finish, then writes the summary. */
  'debates.conclude': { params: { debateId: string }; result: Debate };
  /** Stops every debater and the summarizer; nothing goes back to the parent. `threadId` is the calling agent's thread. */
  'debates.stop': { params: { debateId: string; threadId?: ThreadId }; result: Debate };
}

export interface DebatesRpcEvents {
  /** Invalidation: a debate or its posts changed. `threadId` is the parent thread. */
  'debates.changed': { debateId: string; threadId: ThreadId; salonThreadId: ThreadId; version: number };
}
