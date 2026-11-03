/**
 * Debates between AIs, as `packages/core/src/debates/store.ts` keeps them: the
 * same checks, refusals and salon thread. Nothing runs here: the debaters get
 * no thread and never answer, so a round waits for Next round, Conclude or
 * Stop, and a summary is a line this client writes after a short wait.
 * `?fake=1&debates=1` seeds a thread with a finished debate and one under way.
 */
import {
  DEBATE_LIMITS,
  DEBATE_OWNER,
  DEBATE_SUMMARY,
  DEBATE_SUMMARY_MODEL,
  DEBATE_SYSTEM,
  debateHandles,
  debateMention,
  debateOver,
  drawDebateLetters,
  RpcErrorCode,
  type Debate,
  type DebateParticipant,
  type DebatePost,
  type DebateReadOnly,
  type DebateStatus,
  type DebateTally,
  type Message,
  type Thread
} from '@boite/contracts';
import { RpcFailure } from '../client';
import { delegationConfig, pickModel } from './delegation';
import { toSummary } from './shared';
import type { FakeContext, FakeMethods } from './context';

type DebateMethods = Pick<FakeMethods, `debates.${string}` & keyof FakeMethods>;

const refused = (message: string, data: Record<string, unknown> = {}) => new RpcFailure({ code: RpcErrorCode.Refused, message, data });
const invalid = (message: string, data: Record<string, unknown>) => new RpcFailure({ code: RpcErrorCode.InvalidParams, message, data });

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field}: expected a non-empty string`, { field });
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${field}: ${trimmed.length} characters; the limit is ${max}`, { field, expected: `at most ${max} characters` });
  return trimmed;
}
function whole(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalid(`${field}: expected a whole number from ${min} to ${max}`, { field, expected: `${min}-${max}` });
  return value;
}

interface DebateState { debates: Map<string, Debate>; posts: Map<string, DebatePost[]>; requests: Map<string, { id: string; fingerprint: string }> }
const states = new WeakMap<FakeContext, DebateState>();
function state(ctx: FakeContext): DebateState {
  let found = states.get(ctx);
  if (!found) states.set(ctx, found = { debates: new Map(), posts: new Map(), requests: new Map() });
  return found;
}

function readOnlyOf(ctx: FakeContext, providerId: string): DebateReadOnly {
  const capabilities = ctx.providers.find(provider => provider.id === providerId)?.capabilities;
  return capabilities?.planMode ? 'native' : capabilities?.approvals ? 'approvals' : 'none';
}

/** The votes of the last round grouped as written, most votes first: the core also merges near wordings. */
function tallyOf(debate: Debate, posts: DebatePost[]): DebateTally[] {
  const votes = posts.filter(post => post.round === debate.round && post.vote !== null && debate.participants.some(p => p.id === post.author));
  const groups: DebateTally[] = [];
  for (const post of votes) {
    const group = groups.find(entry => entry.proposal.toLowerCase() === post.vote!.toLowerCase());
    if (group) group.voters.push(post.author), group.votes += 1;
    else groups.push({ proposal: post.vote!, votes: 1, of: 0, voters: [post.author] });
  }
  for (const group of groups) group.of = votes.length;
  return groups.sort((a, b) => b.votes - a.votes);
}

/** The salon: a projectless thread that runs no agent, on the parent's selection, as the core makes it. */
function salonOf(ctx: FakeContext, parent: Thread, debateId: string, topic: string): Thread {
  const now = ctx.now();
  const thread: Thread = {
    id: `t-${++ctx.seq}`, projectId: null, debateId, title: `Debate · ${topic.replace(/\s+/g, ' ').slice(0, 100)}`, titleSource: 'user',
    providerId: parent.providerId, accountId: parent.accountId, model: parent.model, effort: parent.effort, speed: null, cwd: parent.cwd, branch: null, permissionMode: 'plan',
    status: 'idle', unread: false, archived: false, pinned: false, sessionId: null, sessionGeneration: 0, selectionVersion: 0, load: null, context: null,
    createdAt: now, updatedAt: now, messages: [], messagesBefore: null, turns: [], commands: []
  };
  ctx.threads.set(thread.id, thread);
  ctx.emit('thread.created', structuredClone(toSummary(thread)));
  return thread;
}

export function debateMethods(ctx: FakeContext): DebateMethods {
  const gate = () => {
    const experiments = ctx.desktopExperiments ?? ctx.clientPreferences?.experiments ?? [];
    if (!experiments.includes('debates')) throw refused('debates need the AI debates experiment, which is off in the desktop app (Settings, Experiments)', { reason: 'experiment-off' });
  };
  const all = () => [...state(ctx).debates.values()].sort((a, b) => b.createdAt - a.createdAt);
  const postsOf = (id: string) => state(ctx).posts.get(id) ?? [];
  const require = (id: unknown): Debate => {
    if (typeof id !== 'string' || !id) throw invalid('debateId: expected a debate id', { field: 'debateId' });
    const debate = state(ctx).debates.get(id);
    if (!debate) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `debate ${id} not found`, data: { debateId: id } });
    return debate;
  };
  const save = (debate: Debate, change: (draft: Debate) => void): Debate => {
    const next = structuredClone(debate);
    change(next);
    next.version += 1;
    next.updatedAt = ctx.now();
    state(ctx).debates.set(next.id, next);
    ctx.emit('debates.changed', { debateId: next.id, threadId: next.parentThreadId, salonThreadId: next.salonThreadId, version: next.version });
    return next;
  };
  const post = (debate: Debate, entry: Omit<DebatePost, 'id' | 'debateId' | 'seq' | 'createdAt'> & { id?: string }): DebatePost => {
    const list = state(ctx).posts.get(debate.id) ?? [];
    const made: DebatePost = { ...entry, id: entry.id ?? `dpo-${++ctx.seq}`, debateId: debate.id, seq: list.length + 1, createdAt: ctx.now() };
    state(ctx).posts.set(debate.id, [...list, made]);
    save(state(ctx).debates.get(debate.id)!, () => undefined);
    return structuredClone(made);
  };
  const system = (debate: Debate, line: string) => post(debate, { round: debate.round, author: DEBATE_SYSTEM, text: line, to: null, inReplyTo: null, vote: null });

  const end = (id: string, status: Exclude<DebateStatus, 'running' | 'summarizing'>, note: string | null, deliver: boolean): Debate => {
    const ended = save(state(ctx).debates.get(id)!, draft => {
      draft.status = status;
      if (note) draft.note = note;
      draft.roundDeadline = null;
      draft.concluding = false;
      draft.finishedAt = ctx.now();
      for (const participant of draft.participants) participant.pending = false;
      if (!deliver) draft.delivered = true;
    });
    if (note) system(ended, note);
    return state(ctx).debates.get(id)!;
  };
  /** The summarizer of this client: a short wait, then a line that says what the core's would hold. */
  const summarize = (id: string) => {
    const debate = save(state(ctx).debates.get(id)!, draft => {
      draft.tally = tallyOf(draft, postsOf(id));
      draft.status = 'summarizing';
      draft.roundDeadline = Date.now() + draft.timeoutMinutes * 2 * 60_000;
    });
    setTimeout(() => {
      const current = state(ctx).debates.get(id);
      if (!current || current.status !== 'summarizing') return;
      const summary = `${debate.summarizer.name} would summarize the ${current.round} round${current.round === 1 ? '' : 's'} on ${JSON.stringify(current.topic)} here: each proposal, the votes and the disagreements left.`;
      post(current, { round: current.round, author: DEBATE_SUMMARY, text: summary, to: null, inReplyTo: null, vote: null });
      save(state(ctx).debates.get(id)!, draft => { draft.summary = summary; draft.delivered = true; });
      end(id, 'done', null, true);
    }, ctx.delayMs * 20);
  };
  const absentPending = (debate: Debate, why: string) => {
    for (const participant of debate.participants.filter(p => p.pending)) {
      const current = save(state(ctx).debates.get(debate.id)!, draft => {
        const entry = draft.participants.find(p => p.id === participant.id)!;
        entry.pending = false;
        if (!entry.absent.includes(draft.round)) entry.absent.push(draft.round);
      });
      system(current, `${participant.name} did not answer round ${current.round}: ${why}.`);
    }
  };
  const closeRound = (id: string) => {
    const debate = state(ctx).debates.get(id)!;
    const answers = postsOf(id).filter(entry => entry.round === debate.round && debate.participants.some(p => p.id === entry.author));
    if (answers.length < 2) {
      if (debate.round === 1) return void end(id, 'stopped', `Only ${answers.length} of ${debate.participants.length} debaters answered round 1; a debate needs two, so it stopped.`, true);
      save(debate, draft => { draft.note = `Only ${answers.length} debater${answers.length === 1 ? '' : 's'} answered round ${debate.round}, so the rounds ended there.`; });
      system(debate, `Only ${answers.length} debater${answers.length === 1 ? '' : 's'} answered round ${debate.round}: the rounds end here and the summary follows.`);
      return summarize(id);
    }
    if (debate.round >= debate.rounds || debate.concluding) return summarize(id);
    beginRound(id, debate.round + 1);
  };
  const beginRound = (id: string, round: number) => {
    save(state(ctx).debates.get(id)!, draft => {
      draft.round = round;
      draft.roundDeadline = Date.now() + draft.timeoutMinutes * 60_000;
      for (const participant of draft.participants) participant.pending = true;
    });
  };

  // As the core: archiving the thread that started a debate stops it, and nothing goes back.
  ctx.bus.observe('thread.updated', thread => {
    if (!thread.archived || thread.parentThreadId || thread.debateId) return;
    for (const debate of all()) if (debate.parentThreadId === thread.id && !debateOver(debate)) end(debate.id, 'stopped', 'The thread that started it was archived.', false);
  });

  return {
    'debates.start': async (params) => {
      gate();
      const parent = ctx.thread(text(params?.threadId, 'threadId', 128));
      if (parent.parentThreadId) throw refused('a subagent cannot start a debate; ask its parent', { threadId: parent.id });
      if (parent.teamId || parent.debateId) throw refused('a team chat or a debate salon cannot start a debate', { threadId: parent.id });
      if (parent.archived) throw refused('the thread is archived', { threadId: parent.id });
      const topic = text(params.topic, 'topic', DEBATE_LIMITS.topicChars);
      if (!Array.isArray(params.models)) throw invalid('models: expected a list of provider/model routes', { field: 'models' });
      const models = params.models.map((model, index) => text(model, `models[${index}]`, 256));
      if (models.length < DEBATE_LIMITS.participantsMin || models.length > DEBATE_LIMITS.participantsMax) {
        throw invalid(`models: expected ${DEBATE_LIMITS.participantsMin} to ${DEBATE_LIMITS.participantsMax} debaters, got ${models.length}`, { field: 'models', expected: `${DEBATE_LIMITS.participantsMin}-${DEBATE_LIMITS.participantsMax}` });
      }
      const angles = params.angles === undefined || params.angles === null ? null : Array.isArray(params.angles) ? params.angles.map((angle, index) => text(angle, `angles[${index}]`, DEBATE_LIMITS.angleChars)) : null;
      if (params.angles != null && angles === null) throw invalid('angles: expected a list of angles', { field: 'angles' });
      if (angles && angles.length !== models.length) throw invalid(`angles: expected one per debater, ${models.length}, got ${angles.length}`, { field: 'angles', expected: String(models.length) });
      const rounds = whole(params.rounds, 'rounds', DEBATE_LIMITS.roundsMin, DEBATE_LIMITS.roundsMax, DEBATE_LIMITS.roundsDefault);
      const timeoutMinutes = whole(params.timeoutMinutes, 'timeoutMinutes', 1, DEBATE_LIMITS.timeoutMinutesMax, DEBATE_LIMITS.timeoutMinutesDefault);
      const summary = params.summary === undefined || params.summary === null ? DEBATE_SUMMARY_MODEL : text(params.summary, 'summary', 256);
      const effort = params.effort === undefined || params.effort === null ? undefined : text(params.effort, 'effort', 32);
      const requestId = params.requestId === undefined ? null : text(params.requestId, 'requestId', 100);
      const fingerprint = JSON.stringify([topic, models, rounds, summary, angles, effort ?? null, timeoutMinutes]);
      const known = requestId === null ? undefined : state(ctx).requests.get(`${parent.id}\n${requestId}`);
      if (known) {
        if (known.fingerprint !== fingerprint) throw refused('requestId already used for a different debate', { field: 'requestId', expected: 'a fresh id' });
        return structuredClone(state(ctx).debates.get(known.id)!);
      }
      const config = delegationConfig(ctx, parent.id);
      if (config.enabled && config.paused) throw refused('this conversation\'s subagents are paused; resume them before a debate', { threadId: parent.id });
      const warnings: string[] = [];
      const route = (model: string, field: string) => {
        try {
          return pickModel(ctx, parent, config, model, effort);
        } catch (error) {
          throw invalid(`${field}: ${error instanceof Error ? error.message : String(error)}`, { field });
        }
      };
      const routes = models.map((model, index) => route(model, `models[${index}]`));
      const summaryRoute = route(summary, 'summary');
      const handles = debateHandles(routes.map(r => r.name));
      const letters = drawDebateLetters(routes.length);
      const id = `dbt_${++ctx.seq}`;
      const participants: DebateParticipant[] = routes.map((r, index) => {
        const readOnly = readOnlyOf(ctx, r.providerId);
        if (readOnly === 'approvals') warnings.push(`${r.name} has no read-only mode: Boite refuses every permission it asks.`);
        if (readOnly === 'none') warnings.push(`${r.name} has no read-only mode and asks no permission: it could change files.`);
        return { id: `p${index + 1}`, letter: letters[index]!, name: r.name, handle: handles[index]!, providerId: r.providerId, model: r.model ?? '', effort: r.effort ?? null, angle: angles?.[index] ?? null, threadId: null, readOnly, absent: [], pending: false };
      });
      const salon = salonOf(ctx, parent, id, topic);
      const now = ctx.now();
      const debate: Debate = {
        id, topic, parentThreadId: parent.id, salonThreadId: salon.id, rounds, round: 0, status: 'running', participants,
        summarizer: { name: summaryRoute.name, providerId: summaryRoute.providerId, model: summaryRoute.model ?? '', effort: summaryRoute.effort ?? null, threadId: null, readOnly: readOnlyOf(ctx, summaryRoute.providerId) },
        timeoutMinutes, concluding: false, consensus: false, note: null, summary: null, tally: [], delivered: false, roundDeadline: null, warnings,
        createdAt: now, updatedAt: now, finishedAt: null, version: 0
      };
      state(ctx).debates.set(id, debate);
      if (requestId !== null) state(ctx).requests.set(`${parent.id}\n${requestId}`, { id, fingerprint });
      beginRound(id, 1);
      return structuredClone(state(ctx).debates.get(id)!);
    },
    'debates.list': async (params) => {
      gate();
      const threadId = params?.threadId === undefined ? undefined : text(params.threadId, 'threadId', 128);
      return { debates: structuredClone(all().filter(debate => threadId === undefined || debate.parentThreadId === threadId).slice(0, 30)) };
    },
    'debates.get': async (params) => {
      gate();
      const debate = require(params?.debateId);
      return { debate: structuredClone(debate), posts: structuredClone(postsOf(debate.id)) };
    },
    'debates.post': async (params) => {
      gate();
      const debate = require(params?.debateId);
      const body = text(params.text, 'text', DEBATE_LIMITS.postChars);
      if (params.id !== undefined) {
        const id = text(params.id, 'id', 100);
        const mine = postsOf(debate.id).find(entry => entry.id === id);
        if (mine) return structuredClone(mine);
        if (all().some(other => postsOf(other.id).some(entry => entry.id === id))) throw refused('id: already used in another debate', { field: 'id' });
      }
      if (debate.status !== 'running') throw refused(debate.status === 'summarizing' ? 'the debate is being summarized; the salon is closed to new messages' : 'the debate is over', { debateId: debate.id, status: debate.status });
      const to = debateMention(body, debate.participants);
      return post(debate, { ...(params.id === undefined ? {} : { id: params.id }), round: debate.round + 1, author: DEBATE_OWNER, text: body, to, inReplyTo: null, vote: null });
    },
    'debates.next': async (params) => {
      gate();
      const debate = require(params?.debateId);
      if (debate.status !== 'running') throw refused('the debate is not between rounds', { debateId: debate.id, status: debate.status });
      absentPending(debate, 'closed by the user');
      closeRound(debate.id);
      return structuredClone(state(ctx).debates.get(debate.id)!);
    },
    'debates.conclude': async (params) => {
      gate();
      const debate = require(params?.debateId);
      if (debate.status !== 'running' || debate.concluding) return structuredClone(debate);
      return structuredClone(save(debate, draft => { draft.concluding = true; }));
    },
    'debates.stop': async (params) => {
      gate();
      const debate = require(params?.debateId);
      if (ctx.bus.principal === 'agent' && debate.parentThreadId !== params.threadId) throw refused('a debate is stopped by the thread that started it', { debateId: debate.id });
      if (debateOver(debate)) return structuredClone(debate);
      return structuredClone(end(debate.id, 'stopped', ctx.bus.principal === 'agent' ? 'Stopped by the agent that started it.' : 'Stopped by the user.', false));
    }
  };
}

/**
 * `?fake=1&debates=1`: a thread that started two debates, one finished with its
 * summary and votes, one in round 2 of 3 with a debater still writing and an
 * owner's message to one AI. The experiment itself stays the app's to turn on.
 */
export function seedDebatesDemo(ctx: FakeContext): void {
  const at = ctx.now();
  const parent: Thread = {
    id: 't-debate', projectId: 'p-boite', title: 'Pick the cache for the sync engine', titleSource: 'prompt', providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null,
    speed: null, cwd: 'C:\\src\\boite', branch: null, permissionMode: 'default', status: 'idle', unread: false, archived: false, pinned: false, sessionId: 'sess-debate',
    sessionGeneration: 0, selectionVersion: 0, load: null, context: null, createdAt: at, updatedAt: at + 120_000, messagesBefore: null, commands: [],
    turns: [{ id: 'turn-debate-1', threadId: 't-debate', status: 'done', queuedAt: at, startedAt: at, finishedAt: at + 90_000, usage: null, error: null }],
    messages: []
  };
  ctx.threads.set(parent.id, parent);
  const cast = (names: [string, string, string | null][]): DebateParticipant[] => names.map(([name, providerId, angle], index) => ({
    id: `p${index + 1}`, letter: 'BCA'[index]!, name, handle: debateHandles(names.map(entry => entry[0]))[index]!, providerId, model: name.toLowerCase().replace(/\s+/g, '-'),
    effort: 'xhigh', angle, threadId: null, readOnly: 'native', absent: [], pending: false
  }));
  const summarizer = { name: 'Opus 5.5', providerId: 'claude', model: 'claude-opus-5-5', effort: 'xhigh', threadId: null, readOnly: 'native' as const };
  const base = { parentThreadId: parent.id, timeoutMinutes: 10, concluding: false, consensus: false, note: null, delivered: false, roundDeadline: null, warnings: [], tally: [], summary: null, finishedAt: null, version: 1 };

  const done: Debate = {
    ...base, id: 'dbt_demo_done', topic: 'Where should the sync engine keep its cache?', salonThreadId: '', rounds: 3, round: 3, status: 'done', delivered: true,
    participants: cast([['Sonnet 5.5', 'claude', null], ['GPT-6 Astra', 'codex', null], ['Gemini 4 Pro', 'gemini', null]]), summarizer,
    tally: [{ proposal: 'SQLite next to the journal', votes: 3, of: 3, voters: ['p1', 'p2', 'p3'] }],
    summary: '**SQLite next to the journal** won 3 / 3: one file to back up, transactions already in place.\n\n- Agreement: no second database, and the cache is rebuilt from the journal after a crash.\n- Disagreement: GPT-6 Astra would still cap it at 200 MB; Gemini 4 Pro would let the owner choose.',
    createdAt: at, updatedAt: at + 60_000, finishedAt: at + 60_000
  };
  const live: Debate = {
    ...base, id: 'dbt_demo_live', topic: 'How should the phone get the debate posts: push or pull?', salonThreadId: '', rounds: 3, round: 2, status: 'running',
    participants: cast([['Sonnet 5.5', 'claude', 'Battery first'], ['GPT-6 Astra', 'codex', 'Latency first'], ['Gemini 4 Pro', 'gemini', 'Simplicity first']]), summarizer,
    roundDeadline: Date.now() + 7 * 60_000, createdAt: at + 70_000, updatedAt: at + 110_000
  };
  live.participants[1]!.pending = true;
  for (const debate of [done, live]) {
    const salon = salonOf(ctx, parent, debate.id, debate.topic);
    debate.salonThreadId = salon.id;
    state(ctx).debates.set(debate.id, debate);
  }
  const posts = (debate: Debate, rows: [number, string, string, (string | null)?, (string | null)?][]) => state(ctx).posts.set(debate.id, rows.map(([round, author, body, to, vote], index) => ({
    id: `dpo-demo-${debate.id}-${index + 1}`, debateId: debate.id, seq: index + 1, round, author, text: body, to: to ?? null, inReplyTo: null, vote: vote ?? null, createdAt: debate.createdAt + index * 5000
  })));
  posts(done, [
    [1, 'p1', 'Position: SQLite next to the journal\n\nOne file to back up, and the journal already gives us transactions.'],
    [1, 'p2', 'Position: an in-memory LRU, rebuilt at start\n\nNothing to migrate, and the journal is the truth anyway.'],
    [1, 'p3', 'Position: SQLite, in its own file\n\nA separate file can be wiped without touching the journal.'],
    [2, 'p2', 'Position: SQLite next to the journal\n\nOpinion B convinced me: a cold start that rebuilds everything is too slow on a phone. My objection stands on size: cap it.'],
    [2, 'p1', 'Position: SQLite next to the journal, capped\n\nAgreed on a cap. A separate file (Opinion A) doubles the backup story for little gain.'],
    [2, 'p3', 'Position: SQLite next to the journal\n\nFine, if a reset command empties the cache tables.'],
    [3, 'p1', 'Position: SQLite next to the journal\n\nVote: SQLite next to the journal', null, 'SQLite next to the journal'],
    [3, 'p2', 'Position: SQLite next to the journal, capped at 200 MB\n\nVote: SQLite next to the journal', null, 'SQLite next to the journal'],
    [3, 'p3', 'Position: SQLite next to the journal\n\nVote: SQLite next to the journal', null, 'SQLite next to the journal'],
    [3, DEBATE_SUMMARY, done.summary!],
  ]);
  posts(live, [
    [1, 'p1', 'Position: pull when the salon is open\n\nA phone that never opens the salon should pay nothing. Read `debates.get` on `debates.changed` while the tab is visible.'],
    [1, 'p2', 'Position: push every post\n\nThe owner follows a live debate; a pull after each change doubles the round trips.'],
    [1, 'p3', 'Position: invalidation events, then pull\n\nThe core already sends ids and versions for teams. Do the same and keep one code path.'],
    [2, DEBATE_OWNER, '@Gemini what about a phone that was asleep for an hour?', 'p3'],
    [2, 'p3', 'Position: invalidation events, then pull\n\nA phone that wakes reads once and is current: the version tells it whether anything changed. Objection to Opinion A: "only while visible" misses the card in the thread.'],
    [2, 'p1', 'Position: invalidation, then pull while visible\n\nOpinion C is right about the card. I keep my point on battery: no read while the app is in the background.'],
  ]);
  const message = (id: string, debate: Debate, lead: string): Message => ({ id, threadId: parent.id, turnId: 'turn-debate-1', role: 'assistant', parts: [{ type: 'text', text: lead }, { type: 'debate', debateId: debate.id, topic: debate.topic }], state: 'complete', createdAt: debate.createdAt });
  parent.messages.push(
    { id: 'm-debate-1', threadId: parent.id, turnId: 'turn-debate-1', role: 'user', parts: [{ type: 'text', text: 'Ask a few AIs where the sync engine should keep its cache, then how the phone should follow a debate.' }], state: 'complete', createdAt: at },
    message('m-debate-2', done, 'Three AIs debated the cache. The summary is back:'),
    message('m-debate-3', live, 'A second debate is under way on how the phone follows it.'),
  );
  ctx.touch(parent);
}
