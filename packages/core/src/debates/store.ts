import { createHash } from 'node:crypto';
import { DEBATE_LIMITS, DEBATE_OWNER, DEBATE_SUMMARY, DEBATE_SUMMARY_MODEL, DEBATE_SYSTEM, debateHandles, debateMention, debateOver, drawDebateLetters, threadActive } from '@boite/contracts';
import type { Debate, DebateParticipant, DebatePost, DebateReadOnly, DebateStatus, Message, Principal, RpcParams, ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, notFound, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { isAgentHeld } from '../agents/runtime.ts';
import { assertDriverRunnable } from '../drivers/index.ts';
import { childEnd } from '../delegation/completion.ts';
import type { ChildRoute } from '../delegation/routes.ts';
import { withLoad } from '../threads/records.ts';
import { clip, consensus, deliveredSummary, positionOf, roundPrompt, summaryPrompt, tally, voteOf } from './prompt.ts';

type Role = 'participant' | 'summary';
/** What the core keeps beside the debate and never sends: the turn each debater was asked in, to tell a late answer from the current one. */
interface Internal {
  /** Participant id to the turn asked this round; `starting` while `startTurn` runs, since a turn may end inside it. */
  turns: Record<string, string | null>;
  roundStartedAt: number;
  summaryTurn: string | null;
}
type Stored = Debate & { internal: Internal };
interface PostRow { debate_id: string; seq: number; id: string; round: number; author: string; text: string; to_id: string | null; in_reply_to: string | null; vote: string | null; created_at: number }

const STARTING = 'starting';
const LIST_LIMIT = 30;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const minutes = (count: number) => `${count} minute${count === 1 ? '' : 's'}`;

function readOnlyOf(core: Core, providerId: string): DebateReadOnly {
  const capabilities = core.providers.require(providerId).capabilities;
  return capabilities.planMode ? 'native' : capabilities.approvals ? 'approvals' : 'none';
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidParams(`${field}: expected a non-empty string`, { field });
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalidParams(`${field}: ${trimmed.length} characters; the limit is ${max}`, { field, expected: `at most ${max} characters` });
  return trimmed;
}
function whole(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalidParams(`${field}: expected a whole number from ${min} to ${max}`, { field, expected: `${min}-${max}` });
  return value;
}

/**
 * Debates between AIs (`docs/debates.md`). The core runs the rounds: each
 * debater is a delegated child in a read-only permission mode, asked once per
 * round with the others' last answers under letters; the salon is a thread
 * that runs no agent and only draws the posts. Every change reloads the debate
 * from SQLite, because a turn can end inside the `startTurn` that began it.
 */
export class Debates {
  readonly #core: Core;
  readonly #children = new Map<string, { debateId: string; role: Role }>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Parents with an ended debate whose summary or notice has not reached them. */
  readonly #undelivered = new Set<string>();
  /** Debaters asked while their previous turn was still stopping. */
  readonly #waiting = new Set<string>();
  readonly #off: () => void;
  #closed = false;
  /** What one minute of `timeoutMinutes` lasts; a test shortens it. */
  minuteMs = 60_000;

  constructor(core: Core) {
    this.#core = core;
    for (const row of core.journal.db.query('SELECT thread_id, debate_id, role FROM debate_children').all() as { thread_id: string; debate_id: string; role: Role }[]) this.#children.set(row.thread_id, { debateId: row.debate_id, role: row.role });
    for (const { id } of core.journal.db.query('SELECT id FROM debates WHERE parent_thread_id NOT IN (SELECT id FROM threads)').all() as { id: string }[]) this.#forget(id);
    // A core that died resumes no paid work by itself: its debates stop and say so. A handoff goes on (`resumeAfterRestart`).
    if (!core.threads.handoff.handedOver) for (const debate of this.#where("status IN ('running', 'summarizing')")) this.#end(debate.id, 'stopped', 'Boite restarted during the debate, so it stopped.', false);
    for (const debate of this.#where("status IN ('done', 'stopped', 'failed') AND json_extract(data, '$.delivered') = 0")) this.#undelivered.add(debate.parentThreadId);
    this.#off = core.bus.onCommitted((name, payload) => {
      if (this.#closed) return;
      try {
        if (name === 'turn.finished') this.#turnFinished(payload as Turn);
        else if (name === 'thread.updated') {
          const thread = payload as ThreadSummary;
          if (this.#waiting.has(thread.id)) this.#wake(thread.id);
          else if (thread.archived && !thread.parentThreadId && !thread.debateId) this.stopParent(thread.id, 'The thread that started it was archived.');
        } else if (name === 'thread.removed' && !(payload as { undoable?: boolean }).undoable) {
          const threadId = (payload as { threadId: string }).threadId;
          for (const debate of this.#where('parent_thread_id = ?', threadId)) this.#forget(debate.id);
        }
      } catch (error) { core.log('warn', `debates after ${name}: ${messageOf(error)}`); }
    });
  }

  // -- gate and ownership -------------------------------------------------------

  enabled(): boolean {
    const experiments = this.#core.clients.desktopExperiments() ?? this.#core.clients.current()?.experiments ?? [];
    return experiments.includes('debates');
  }
  gate(): void {
    if (!this.enabled()) throw refused('debates need the AI debates experiment, which is off in the desktop app (Settings, Experiments)', { reason: 'experiment-off' });
  }
  /** A debater's or a summarizer's thread. */
  owns(threadId: string): boolean { return this.#children.has(threadId); }
  /** The debate of that child is over: nothing will ask it again. */
  overFor(threadId: string): boolean {
    const entry = this.#children.get(threadId);
    const debate = entry ? this.#load(entry.debateId) : null;
    return !debate || debateOver(debate);
  }

  // -- records ------------------------------------------------------------------

  #where(where: string, ...args: string[]): Stored[] {
    return (this.#core.journal.db.query(`SELECT data FROM debates WHERE ${where} ORDER BY created_at DESC`).all(...args) as { data: string }[]).map(row => JSON.parse(row.data) as Stored);
  }
  #load(id: string): Stored | null {
    const row = this.#core.journal.db.query('SELECT data FROM debates WHERE id = ?').get(id) as { data: string } | null;
    return row ? JSON.parse(row.data) as Stored : null;
  }
  #require(id: unknown): Stored {
    if (typeof id !== 'string' || !id) throw invalidParams('debateId: expected a debate id', { field: 'debateId' });
    const debate = this.#load(id);
    if (!debate) throw notFound(`debate ${id} not found`, { debateId: id });
    return debate;
  }
  #save(debate: Stored): Stored {
    const now = Date.now();
    const saved = { ...debate, version: debate.version + 1, updatedAt: now };
    this.#core.journal.db.query('UPDATE debates SET status = ?, version = ?, data = ?, updated_at = ? WHERE id = ?').run(saved.status, saved.version, JSON.stringify(saved), now, saved.id);
    if (debateOver(saved) && !saved.delivered) this.#undelivered.add(saved.parentThreadId);
    this.#changed(saved);
    return saved;
  }
  /** Reloads, applies `change` and saves unless it returns false. */
  #mutate(id: string, change: (debate: Stored) => false | void): Stored | null {
    const debate = this.#load(id);
    if (!debate || change(debate) === false) return debate;
    return this.#save(debate);
  }
  #changed(debate: Debate): void {
    this.#core.bus.emit('debates.changed', { debateId: debate.id, threadId: debate.parentThreadId, salonThreadId: debate.salonThreadId, version: debate.version });
  }
  #public({ internal: _internal, ...debate }: Stored): Debate { return debate; }
  #posts(id: string, where = '', ...args: (string | number)[]): DebatePost[] {
    return (this.#core.journal.db.query(`SELECT * FROM debate_posts WHERE debate_id = ? ${where} ORDER BY seq`).all(id, ...args) as PostRow[]).map(row => ({
      id: row.id, debateId: row.debate_id, seq: row.seq, round: row.round, author: row.author, text: row.text, to: row.to_id, inReplyTo: row.in_reply_to, vote: row.vote, createdAt: row.created_at,
    }));
  }
  /** Writes a post and bumps the debate so every viewer reloads it. */
  #post(id: string, post: Omit<DebatePost, 'id' | 'debateId' | 'seq' | 'createdAt'> & { id?: string; turnId?: string | null }): DebatePost {
    const now = Date.now();
    const postId = post.id ?? newId('dpo_');
    const seq = this.#core.journal.db.transaction(() => {
      const next = ((this.#core.journal.db.query('SELECT MAX(seq) AS seq FROM debate_posts WHERE debate_id = ?').get(id) as { seq: number | null }).seq ?? 0) + 1;
      this.#core.journal.db.query('INSERT INTO debate_posts (debate_id, seq, id, round, author, text, to_id, in_reply_to, vote, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, next, postId, post.round, post.author, post.text, post.to, post.inReplyTo, post.vote, post.turnId ?? null, now);
      return next;
    })();
    this.#mutate(id, () => undefined);
    return { id: postId, debateId: id, seq, round: post.round, author: post.author, text: post.text, to: post.to, inReplyTo: post.inReplyTo, vote: post.vote, createdAt: now };
  }
  #system(id: string, round: number, line: string): void {
    this.#post(id, { round, author: DEBATE_SYSTEM, text: line, to: null, inReplyTo: null, vote: null });
  }

  // -- RPC ----------------------------------------------------------------------

  list(params: RpcParams<'debates.list'> = {}): { debates: Debate[] } {
    this.gate();
    const rows = params.threadId === undefined ? this.#where('1 = 1') : this.#where('parent_thread_id = ?', text(params.threadId, 'threadId', 128));
    return { debates: rows.slice(0, LIST_LIMIT).map(debate => this.#public(debate)) };
  }

  get(params: RpcParams<'debates.get'>): { debate: Debate; posts: DebatePost[] } {
    this.gate();
    const debate = this.#require(params?.debateId);
    return { debate: this.#public(debate), posts: this.#posts(debate.id) };
  }

  /**
   * Checks everything, creates the salon and every child thread in one go, then
   * asks round 1. Routes were read by the RPC (`prepareRoutes`) before this runs.
   */
  start(params: RpcParams<'debates.start'>): Debate {
    this.gate();
    const parent = this.#core.threads.require(text(params?.threadId, 'threadId', 128));
    if (parent.parentThreadId) throw refused('a subagent cannot start a debate; ask its parent', { threadId: parent.id });
    if (parent.teamId || parent.debateId) throw refused('a team chat or a debate salon cannot start a debate', { threadId: parent.id });
    if (parent.archived) throw refused('the thread is archived', { threadId: parent.id });
    const topic = text(params.topic, 'topic', DEBATE_LIMITS.topicChars);
    if (!Array.isArray(params.models)) throw invalidParams('models: expected a list of provider/model routes', { field: 'models' });
    const models = params.models.map((model, index) => text(model, `models[${index}]`, 256));
    if (models.length < DEBATE_LIMITS.participantsMin || models.length > DEBATE_LIMITS.participantsMax) throw invalidParams(`models: expected ${DEBATE_LIMITS.participantsMin} to ${DEBATE_LIMITS.participantsMax} debaters, got ${models.length}`, { field: 'models', expected: `${DEBATE_LIMITS.participantsMin}-${DEBATE_LIMITS.participantsMax}` });
    const angles = params.angles === undefined || params.angles === null ? null : Array.isArray(params.angles) ? params.angles.map((angle, index) => text(angle, `angles[${index}]`, DEBATE_LIMITS.angleChars)) : null;
    if (params.angles != null && angles === null) throw invalidParams('angles: expected a list of angles', { field: 'angles' });
    if (angles && angles.length !== models.length) throw invalidParams(`angles: expected one per debater, ${models.length}, got ${angles.length}`, { field: 'angles', expected: String(models.length) });
    const rounds = whole(params.rounds, 'rounds', DEBATE_LIMITS.roundsMin, DEBATE_LIMITS.roundsMax, DEBATE_LIMITS.roundsDefault);
    const timeoutMinutes = whole(params.timeoutMinutes, 'timeoutMinutes', 1, DEBATE_LIMITS.timeoutMinutesMax, DEBATE_LIMITS.timeoutMinutesDefault);
    const summary = params.summary === undefined || params.summary === null ? DEBATE_SUMMARY_MODEL : text(params.summary, 'summary', 256);
    const effort = params.effort === undefined || params.effort === null ? undefined : text(params.effort, 'effort', 32);
    const requestId = params.requestId === undefined ? null : text(params.requestId, 'requestId', 100);
    const fingerprint = hash([topic, models, rounds, summary, angles, effort ?? null, timeoutMinutes]);
    if (requestId !== null) {
      const known = this.#core.journal.db.query('SELECT id, fingerprint FROM debates WHERE parent_thread_id = ? AND request_id = ?').get(parent.id, requestId) as { id: string; fingerprint: string } | null;
      if (known) {
        if (known.fingerprint !== fingerprint) throw refused('requestId already used for a different debate', { field: 'requestId', expected: 'a fresh id' });
        return this.#public(this.#load(known.id)!);
      }
    }
    const config = this.#core.delegation.config(parent.id);
    if (config.enabled && config.paused) throw refused('this conversation\'s subagents are paused; resume them before a debate', { threadId: parent.id });

    const warnings: string[] = [];
    const route = (model: string, what: string): ChildRoute => {
      let resolved: ChildRoute;
      try {
        resolved = this.#core.delegation.resolve(parent.id, { profileId: null, model, ...(effort === undefined ? {} : { effort }) });
      } catch (error) {
        if (effort === undefined || !/^effort\b/.test(messageOf(error))) throw invalidParams(`${what}: ${messageOf(error)}`, { field: what });
        resolved = this.#core.delegation.resolve(parent.id, { profileId: null, model });
        warnings.push(`${resolved.name} has no ${effort} effort, so it runs at ${resolved.effort ?? 'its default'}.`);
      }
      const provider = this.#core.providers.require(resolved.providerId);
      assertDriverRunnable(provider.protocol, this.#core.providers.summary(provider.id), this.#core.accounts.require(resolved.accountId), () => this.#core.providers.launcherScriptOnly(provider.id));
      const owner = this.#core.workforce.resident.ownerOf(parent.id);
      const permissionMode = readOnlyOf(this.#core, resolved.providerId) === 'native' ? 'plan' as const : 'default' as const;
      if (owner && !this.#core.workforce.resident.allowed(owner, { ...resolved, permissionMode }, true)) throw refused(`${what}: account/model access was withdrawn from this bot`, { field: what });
      return resolved;
    };
    const routes = models.map((model, index) => route(model, `models[${index}]`));
    const summaryRoute = route(summary, 'summary');
    const names = routes.map(r => r.name);
    const handleOf = debateHandles(names);
    const letters = drawDebateLetters(routes.length);
    const now = Date.now();
    const id = newId('dbt_');
    const participants: DebateParticipant[] = routes.map((r, index) => {
      const readOnly = readOnlyOf(this.#core, r.providerId);
      if (readOnly === 'approvals') warnings.push(`${r.name} has no read-only mode: Boite refuses every permission it asks.`);
      if (readOnly === 'none') warnings.push(`${r.name} has no read-only mode and asks no permission: it could change files.`);
      return { id: `p${index + 1}`, letter: letters[index]!, name: r.name, handle: handleOf[index]!, providerId: r.providerId, model: r.model ?? '', effort: r.effort ?? null, angle: angles?.[index] ?? null, threadId: null, readOnly, absent: [], pending: false };
    });
    const summaryReadOnly = readOnlyOf(this.#core, summaryRoute.providerId);
    const salon: ThreadSummary = {
      id: newId('thr_'), projectId: null, debateId: id, title: `Debate · ${topic.replace(/\s+/g, ' ').slice(0, 100)}`, titleSource: 'user',
      providerId: parent.providerId, accountId: parent.accountId, model: parent.model, effort: parent.effort, speed: null, cwd: parent.cwd, branch: null, permissionMode: 'plan',
      status: 'idle', unread: false, archived: false, pinned: false, sessionId: null, sessionGeneration: 0, selectionVersion: 0, load: null, context: null, createdAt: now, updatedAt: now,
    };
    const debate: Stored = {
      id, topic, parentThreadId: parent.id, salonThreadId: salon.id, rounds, round: 0, status: 'running', participants,
      summarizer: { name: summaryRoute.name, providerId: summaryRoute.providerId, model: summaryRoute.model ?? '', effort: summaryRoute.effort ?? null, threadId: null, readOnly: summaryReadOnly },
      timeoutMinutes, concluding: false, consensus: false, note: null, summary: null, tally: [], delivered: false, roundDeadline: null, warnings,
      createdAt: now, updatedAt: now, finishedAt: null, version: 1, internal: { turns: {}, roundStartedAt: 0, summaryTurn: null },
    };
    this.#core.journal.append({ type: 'thread.created', threadId: salon.id, version: 1, payload: salon }, db => {
      this.#core.journal.putThread(salon);
      db.query('INSERT INTO debates (id, parent_thread_id, salon_thread_id, request_id, fingerprint, status, version, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
        .run(id, parent.id, salon.id, requestId, fingerprint, 'running', JSON.stringify(debate), now, now);
    });
    this.#core.bus.emit('thread.created', withLoad(this.#core, salon));
    // Every child exists before the first round, so a failure leaves no half-made debate running.
    try {
      const child = (r: ChildRoute, title: string, role: Role) => {
        const permissionMode = readOnlyOf(this.#core, r.providerId) === 'native' ? 'plan' as const : 'default' as const;
        const threadId = this.#core.delegation.createChild(parent, r, title.slice(0, 120), childId => {
          this.#core.journal.db.query('INSERT INTO debate_children (thread_id, debate_id, role) VALUES (?, ?, ?)').run(childId, id, role);
        }, undefined, false, { contextMode: null, permissionMode });
        this.#children.set(threadId, { debateId: id, role });
        return threadId;
      };
      const short = topic.replace(/\s+/g, ' ').slice(0, 60);
      for (const participant of participants) participant.threadId = child(routes[Number(participant.id.slice(1)) - 1]!, `Debate · ${participant.name}${participant.angle ? ` (${participant.angle})` : ''} · ${short}`, 'participant');
      debate.summarizer.threadId = child(summaryRoute, `Debate summary · ${summaryRoute.name} · ${short}`, 'summary');
      this.#save(debate);
    } catch (error) {
      // The children made so far are recorded, so the end puts them away; the caller reads the error itself.
      try { this.#save(debate); } catch { /* the row stays as it was inserted */ }
      this.#end(id, 'failed', `The debaters could not be created: ${messageOf(error)}`, false, false);
      throw error;
    }
    this.#card(parent, id, topic);
    this.#core.logs.info(`Debate ${id} started by ${parent.id} with ${participants.map(p => `${p.providerId}/${p.model}`).join(', ')}, ${rounds} round(s)`, {
      source: 'debates', event: 'debates.started', threadId: parent.id, data: { debateId: id, participants: participants.length, rounds, summary: `${summaryRoute.providerId}/${summaryRoute.model}`, warnings: warnings.length },
    });
    this.#beginRound(id, 1);
    return this.#public(this.#load(id)!);
  }

  /** The owner writes in the salon. Without `@`, every debater reads it next round; with one, only that debater. */
  post(params: RpcParams<'debates.post'>): DebatePost {
    this.gate();
    const debate = this.#require(params?.debateId);
    const body = text(params.text, 'text', DEBATE_LIMITS.postChars);
    if (params.id !== undefined) {
      const known = this.#posts(debate.id, 'AND id = ?', text(params.id, 'id', 100))[0];
      if (known) return known;
      if (this.#core.journal.db.query('SELECT 1 FROM debate_posts WHERE id = ?').get(params.id)) throw refused('id: already used in another debate', { field: 'id' });
    }
    if (debate.status !== 'running') throw refused(debate.status === 'summarizing' ? 'the debate is being summarized; the salon is closed to new messages' : 'the debate is over', { debateId: debate.id, status: debate.status });
    const to = debateMention(body, debate.participants);
    return this.#post(debate.id, { ...(params.id === undefined ? {} : { id: params.id }), round: debate.round + 1, author: DEBATE_OWNER, text: body, to, inReplyTo: null, vote: null });
  }

  /** Closes the round now: whoever has not answered is absent from it. */
  next(params: RpcParams<'debates.next'>): Debate {
    this.gate();
    const debate = this.#require(params?.debateId);
    if (debate.status !== 'running') throw refused('the debate is not between rounds', { debateId: debate.id, status: debate.status });
    this.#absentPending(debate.id, 'closed by the user');
    this.#closeRound(debate.id);
    return this.#public(this.#load(debate.id)!);
  }

  /** The round under way finishes, then the summary. */
  conclude(params: RpcParams<'debates.conclude'>): Debate {
    this.gate();
    const debate = this.#require(params?.debateId);
    if (debate.status !== 'running') return this.#public(debate);
    this.#mutate(debate.id, current => { if (current.concluding) return false; current.concluding = true; });
    this.#settleSoon(debate.id);
    return this.#public(this.#load(debate.id)!);
  }

  /** Stops every child; nothing goes back to the parent. An agent stops only a debate its own thread started. */
  stop(params: RpcParams<'debates.stop'>, principal: Principal): Debate {
    this.gate();
    const debate = this.#require(params?.debateId);
    if (principal === 'agent' && debate.parentThreadId !== params.threadId) throw refused('a debate is stopped by the thread that started it', { debateId: debate.id });
    if (debateOver(debate)) return this.#public(debate);
    this.#end(debate.id, 'stopped', principal === 'agent' ? 'Stopped by the agent that started it.' : 'Stopped by the user.', true, false);
    return this.#public(this.#load(debate.id)!);
  }

  /** Stop on the thread, or its archive, stops its debates; nothing goes back to it. Returns how many. */
  stopParent(threadId: string, why: string): number {
    let stopped = 0;
    for (const debate of this.#where("parent_thread_id = ? AND status IN ('running', 'summarizing')", threadId)) { this.#end(debate.id, 'stopped', why, true, false); stopped++; }
    return stopped;
  }

  // -- rounds -------------------------------------------------------------------

  #beginRound(id: string, round: number): void {
    const now = Date.now();
    const debate = this.#mutate(id, current => {
      if (current.status !== 'running') return false;
      current.round = round;
      current.roundDeadline = now + current.timeoutMinutes * this.minuteMs;
      current.internal.roundStartedAt = now;
      for (const participant of current.participants) {
        participant.pending = participant.threadId !== null;
        current.internal.turns[participant.id] = participant.pending ? STARTING : null;
      }
    });
    if (!debate || debate.status !== 'running' || debate.round !== round) return;
    this.#arm(debate);
    for (const participant of debate.participants) if (participant.threadId) this.#ask(id, participant.id, round);
    this.#settleSoon(id);
  }

  /** One debater's turn for the round, built from what the debate holds now. */
  #ask(id: string, participantId: string, round: number): void {
    const debate = this.#load(id);
    const participant = debate?.participants.find(p => p.id === participantId);
    if (!debate || !participant?.threadId || debate.status !== 'running' || debate.round !== round || !participant.pending) return;
    const posts = this.#posts(id, 'AND round IN (?, ?)', round - 1, round);
    const previous = posts.filter(post => post.round === round - 1 && debate.participants.some(p => p.id === post.author))
      .map(post => ({ letter: debate.participants.find(p => p.id === post.author)!.letter, text: post.text }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const owner = posts.filter(post => post.round === round && post.author === DEBATE_OWNER && (post.to === null || post.to === participantId));
    // Its last turn is still stopping (a closed round, a deadline): it is asked once that ends (`#wake`).
    if (this.#core.threads.isBusy(participant.threadId)) {
      this.#waiting.add(participant.threadId);
      this.#mutate(id, current => { current.internal.turns[participantId] = STARTING; });
      return;
    }
    this.#waiting.delete(participant.threadId);
    this.#mutate(id, current => { current.internal.turns[participantId] = STARTING; });
    try {
      const turn = this.#core.threads.startTurn(participant.threadId, { prompt: roundPrompt(debate, participant, round, previous, owner), display: `Debate round ${round} of ${debate.rounds}` }, { kind: 'delegation' });
      this.#mutate(id, current => {
        const now = current.participants.find(p => p.id === participantId);
        if (current.round !== round || !now?.pending || current.internal.turns[participantId] !== STARTING) return false;
        current.internal.turns[participantId] = turn.id;
      });
    } catch (error) {
      this.#absent(id, participantId, round, `could not start: ${messageOf(error)}`);
    }
  }

  /** A debater whose question waited for its stopping turn is asked once that thread is free. */
  #wake(threadId: string): void {
    if (!this.#waiting.has(threadId) || this.#core.threads.isBusy(threadId)) return;
    this.#waiting.delete(threadId);
    const entry = this.#children.get(threadId);
    const debate = entry ? this.#load(entry.debateId) : null;
    const participant = debate?.participants.find(p => p.threadId === threadId);
    if (!debate || !participant?.pending || debate.status !== 'running' || debate.internal.turns[participant.id] !== STARTING) return;
    this.#ask(debate.id, participant.id, debate.round);
  }

  #absent(id: string, participantId: string, round: number, why: string): void {
    let name = '';
    const debate = this.#mutate(id, current => {
      const participant = current.participants.find(p => p.id === participantId);
      if (current.round !== round || !participant?.pending) return false;
      participant.pending = false;
      if (!participant.absent.includes(round)) participant.absent.push(round);
      current.internal.turns[participantId] = null;
      name = participant.name;
    });
    if (!name || !debate) return;
    this.#system(id, round, `${name} did not answer round ${round}: ${why}.`);
    this.#settleSoon(id);
  }

  /** Every debater still asked is absent from the round, and its turn stops. */
  #absentPending(id: string, why: string): void {
    const debate = this.#load(id);
    if (!debate || debate.status !== 'running') return;
    for (const participant of debate.participants.filter(p => p.pending)) {
      this.#absent(id, participant.id, debate.round, why);
      if (participant.threadId) this.#stopChild(participant.threadId);
    }
  }

  #arm(debate: Debate): void {
    this.#disarm(debate.id);
    if (debate.roundDeadline === null || this.#closed) return;
    const timer = setTimeout(() => {
      this.#timers.delete(debate.id);
      try { this.#deadline(debate.id); } catch (error) { this.#core.log('warn', `debate ${debate.id} deadline: ${messageOf(error)}`); }
    }, Math.max(0, debate.roundDeadline - Date.now()));
    timer.unref?.();
    this.#timers.set(debate.id, timer);
  }
  #disarm(id: string): void {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
  }

  #deadline(id: string): void {
    const debate = this.#load(id);
    if (!debate || this.#closed) return;
    if (debate.status === 'running') {
      this.#absentPending(id, `no answer within ${minutes(debate.timeoutMinutes)}`);
      this.#closeRound(id);
    } else if (debate.status === 'summarizing') {
      if (debate.summarizer.threadId) this.#stopChild(debate.summarizer.threadId);
      this.#end(id, 'failed', `${debate.summarizer.name} wrote no summary within ${minutes(debate.timeoutMinutes * 2)}.`, true, true);
    }
  }

  /** Looks again once the current call is over: a turn may end inside the start that asked it. */
  #settleSoon(id: string): void {
    setTimeout(() => {
      if (this.#closed) return;
      try { this.#closeRound(id, true); } catch (error) { this.#core.log('warn', `debate ${id}: ${messageOf(error)}`); }
    }, 0).unref?.();
  }

  /** Ends the round once nobody is pending (or now, for `next`): stop, summary or the next round. */
  #closeRound(id: string, onlyWhenAnswered = false): void {
    const debate = this.#load(id);
    if (!debate || debate.status !== 'running' || debate.round === 0) return;
    if (debate.participants.some(p => p.pending)) {
      if (onlyWhenAnswered) return;
      this.#absentPending(id, 'closed early');
    }
    const round = debate.round;
    const answers = this.#posts(id, 'AND round = ?', round).filter(post => debate.participants.some(p => p.id === post.author));
    if (answers.length < 2) {
      if (round === 1) {
        this.#end(id, 'stopped', `Only ${answers.length} of ${debate.participants.length} debaters answered round 1; a debate needs two, so it stopped.`, true, true);
        return;
      }
      this.#mutate(id, current => { current.note = `Only ${answers.length} debater${answers.length === 1 ? '' : 's'} answered round ${round}, so the rounds ended there.`; });
      this.#system(id, round, `Only ${answers.length} debater${answers.length === 1 ? '' : 's'} answered round ${round}: the rounds end here and the summary follows.`);
      return this.#summarize(id);
    }
    if (round === 1 && debate.rounds > 1 && answers.length === debate.participants.length && consensus(answers.map(post => positionOf(post.text)))) {
      this.#mutate(id, current => { current.consensus = true; current.note = 'Every debater backed the same proposal in round 1, so the debate went straight to the summary.'; });
      this.#system(id, round, 'Every debater backed the same proposal: straight to the summary.');
      return this.#summarize(id);
    }
    if (round >= debate.rounds || debate.concluding) return this.#summarize(id);
    this.#beginRound(id, round + 1);
  }

  // -- summary and delivery -----------------------------------------------------

  #summarize(id: string): void {
    const posts = this.#posts(id);
    const debate = this.#mutate(id, current => {
      if (current.status !== 'running') return false;
      const last = posts.filter(post => post.round === current.round && post.vote !== null && current.participants.some(p => p.id === post.author));
      const positions = new Map<string, string>();
      for (const post of posts) {
        const participant = current.participants.find(p => p.id === post.author);
        const position = participant ? positionOf(post.text) : null;
        if (participant && position) positions.set(participant.letter, position);
      }
      current.tally = tally(last.map(post => ({ participantId: post.author, vote: post.vote! })), positions);
      current.status = 'summarizing';
      current.roundDeadline = Date.now() + current.timeoutMinutes * 2 * this.minuteMs;
      current.internal.summaryTurn = STARTING;
    });
    if (!debate || debate.status !== 'summarizing') return;
    this.#arm(debate);
    const threadId = debate.summarizer.threadId;
    if (!threadId) return void this.#end(id, 'failed', 'The summarizer has no thread.', true, true);
    try {
      const turn = this.#core.threads.startTurn(threadId, { prompt: summaryPrompt(debate, posts), display: 'Summarize the debate' }, { kind: 'delegation' });
      this.#mutate(id, current => { if (current.internal.summaryTurn !== STARTING) return false; current.internal.summaryTurn = turn.id; });
    } catch (error) {
      this.#end(id, 'failed', `The summarizer could not start: ${messageOf(error)}`, true, true);
    }
  }

  #turnFinished(turn: Turn): void {
    const entry = this.#children.get(turn.threadId);
    if (!entry) {
      // The parent finished a turn of its own: a held summary may go now.
      if (this.#undelivered.has(turn.threadId)) setTimeout(() => { if (!this.#closed) this.#deliverAll(turn.threadId); }, 0).unref?.();
      return;
    }
    if (childEnd(this.#core, turn).kind === 'maintenance') return;
    if (this.#waiting.has(turn.threadId)) setTimeout(() => { if (!this.#closed) this.#wake(turn.threadId); }, 0).unref?.();
    const debate = this.#load(entry.debateId);
    if (!debate) return;
    // A restart handoff stopped it on purpose: the next core asks again (`resumeAfterRestart`).
    if (turn.status === 'stopped' && this.#core.threads.handoff.active) return;
    if (entry.role === 'summary') return this.#summaryFinished(debate, turn);
    const participant = debate.participants.find(p => p.threadId === turn.threadId);
    const asked = participant ? debate.internal.turns[participant.id] : null;
    if (!participant?.pending || debate.status !== 'running' || (asked !== turn.id && !(asked === STARTING && turn.queuedAt >= debate.internal.roundStartedAt))) return;
    const answer = turn.status === 'done' ? this.#answer(turn) : '';
    if (!answer) return this.#absent(debate.id, participant.id, debate.round, turn.status === 'done' ? 'its answer was empty' : turn.status === 'stopped' ? 'its turn was stopped' : `its turn failed${turn.error ? ` (${turn.error.slice(0, 200)})` : ''}`);
    const round = debate.round;
    const replied = this.#posts(debate.id, 'AND round = ? AND author = ? AND to_id = ?', round, DEBATE_OWNER, participant.id).at(-1)?.id ?? null;
    const last = round === debate.rounds && debate.rounds > 1;
    this.#core.journal.db.transaction(() => {
      this.#post(debate.id, { round, author: participant.id, text: clip(answer, DEBATE_LIMITS.answerChars), to: null, inReplyTo: replied, vote: last ? voteOf(answer) : null, turnId: turn.id });
      this.#mutate(debate.id, current => {
        const now = current.participants.find(p => p.id === participant.id)!;
        now.pending = false;
        current.internal.turns[participant.id] = null;
      });
    })();
    this.#settleSoon(debate.id);
  }

  #summaryFinished(debate: Stored, turn: Turn): void {
    const asked = debate.internal.summaryTurn;
    if (debate.status !== 'summarizing' || (asked !== turn.id && !(asked === STARTING && turn.queuedAt >= debate.updatedAt - 60_000))) return;
    const answer = turn.status === 'done' ? this.#answer(turn) : '';
    if (!answer) return void this.#end(debate.id, 'failed', `${debate.summarizer.name} wrote no summary: ${turn.status === 'done' ? 'its answer was empty' : turn.error ?? turn.status}.`, true, true);
    this.#post(debate.id, { round: debate.round, author: DEBATE_SUMMARY, text: clip(answer, DEBATE_LIMITS.answerChars), to: null, inReplyTo: null, vote: null, turnId: turn.id });
    this.#mutate(debate.id, current => { current.summary = clip(answer, DEBATE_LIMITS.answerChars); });
    this.#end(debate.id, 'done', null, false, true);
  }

  /** The whole text of a turn's last answer. */
  #answer(turn: Turn): string {
    const rows = this.#core.journal.db.query(`SELECT (SELECT group_concat(json_extract(value, '$.text'), char(10))
      FROM json_each(messages.parts) WHERE json_extract(value, '$.type') = 'text') AS answer
      FROM messages WHERE turn_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 8`).all(turn.id) as { answer: string | null }[];
    for (const row of rows) if (row.answer?.trim()) return row.answer.trim();
    return '';
  }

  /**
   * The debate is over. `stopTurns` stops what still runs; the children are put
   * away; `deliver` hands the summary, or why there is none, to the parent.
   * A stop the user or the agent asked for delivers nothing.
   */
  #end(id: string, status: Exclude<DebateStatus, 'running' | 'summarizing'>, note: string | null, stopTurns: boolean, deliver = true): void {
    this.#disarm(id);
    const debate = this.#mutate(id, current => {
      if (debateOver(current)) return false;
      current.status = status;
      if (note) current.note = note;
      current.roundDeadline = null;
      current.concluding = false;
      current.finishedAt = Date.now();
      for (const participant of current.participants) participant.pending = false;
      current.internal.turns = {};
      current.internal.summaryTurn = null;
      if (!deliver) current.delivered = true;
    });
    if (!debate || debate.status !== status) return;
    if (note) this.#system(id, debate.round, note);
    const children = [...debate.participants.map(p => p.threadId), debate.summarizer.threadId].filter((threadId): threadId is string => threadId !== null);
    if (stopTurns) for (const threadId of children) this.#stopChild(threadId);
    for (const threadId of children) {
      try { this.#core.delegation.retirements.check(threadId); } catch (error) { this.#core.log('warn', `debate ${id}: retiring ${threadId}: ${messageOf(error)}`); }
    }
    this.#core.logs.info(`Debate ${id} ${status}${note ? `: ${note}` : ''}`, { source: 'debates', event: `debates.${status}`, threadId: debate.parentThreadId, data: { debateId: id, rounds: debate.round } });
    if (deliver && !this.#closed) setTimeout(() => { if (!this.#closed) this.#deliver(id); }, 0).unref?.();
  }

  #stopChild(threadId: string): void {
    const thread = this.#core.journal.getThread(threadId);
    if (!thread || !threadActive(thread.status)) return;
    try { this.#core.threads.stopTurn(threadId); } catch (error) { this.#core.log('warn', `debate child ${threadId} not stopped: ${messageOf(error)}`); }
  }

  #deliverAll(parentId: string): void {
    for (const debate of this.#where("parent_thread_id = ? AND status IN ('done', 'stopped', 'failed') AND json_extract(data, '$.delivered') = 0", parentId)) this.#deliver(debate.id);
  }

  /** The summary, or why there is none, as one turn of the parent once it is idle; its next finished turn retries. */
  #deliver(id: string): void {
    const debate = this.#load(id);
    if (!debate || debate.delivered || !debateOver(debate)) return;
    const parent = this.#core.journal.getThread(debate.parentThreadId);
    const delivered = () => {
      this.#mutate(id, current => { if (current.delivered) return false; current.delivered = true; });
      if (!this.#where("parent_thread_id = ? AND status IN ('done', 'stopped', 'failed') AND json_extract(data, '$.delivered') = 0", debate.parentThreadId).length) this.#undelivered.delete(debate.parentThreadId);
    };
    if (!parent || parent.archived) return delivered();
    if (threadActive(parent.status)) { this.#core.threads.cacheKeepalive.yieldTo(parent.id); return; }
    const topic = debate.topic.replace(/\s+/g, ' ').slice(0, 120);
    const prompt = debate.status === 'done'
      ? deliveredSummary(debate)
      : `Debate ${debate.id} on ${JSON.stringify(topic)} ended without a summary (${debate.status}): ${debate.note ?? 'no reason given'}`;
    try {
      this.#core.threads.startTurn(parent.id, { prompt, display: debate.status === 'done' ? `Debate summary: ${topic}` : `Debate ended without a summary: ${topic}` }, { kind: 'delegation' });
      delivered();
    } catch (error) {
      if (isAgentHeld(error)) this.#core.agentRuntime.whenAdmitted(parent.id, `debate:${id}`, () => this.#deliver(id));
      this.#core.log('warn', `debate ${id} summary not delivered: ${messageOf(error)}`);
    }
  }

  /** The card in the conversation that started the debate, on the turn that runs the command. */
  #card(parent: ThreadSummary, debateId: string, topic: string): void {
    const turn = this.#core.journal.runningTurn(parent.id);
    if (turn === null) return;
    const message: Message = { id: newId('msg_'), threadId: parent.id, turnId: turn.id, role: 'assistant', parts: [{ type: 'debate', debateId, topic: topic.slice(0, 300) }], state: 'complete', createdAt: Date.now() };
    this.#core.journal.append({ type: 'message.started', threadId: parent.id, version: 1, payload: message }, () => this.#core.journal.putMessage(message));
    this.#core.bus.emit('message.started', message);
    this.#core.bus.emit('message.completed', { threadId: parent.id, messageId: message.id, state: 'complete' });
  }

  /** The parent is gone for good: so are the debate's rows and its salon. */
  #forget(id: string): void {
    const debate = this.#load(id);
    this.#disarm(id);
    this.#core.journal.db.transaction(() => {
      for (const table of ['debate_posts', 'debate_children']) this.#core.journal.db.query(`DELETE FROM ${table} WHERE debate_id = ?`).run(id);
      this.#core.journal.db.query('DELETE FROM debates WHERE id = ?').run(id);
    })();
    for (const [threadId, entry] of this.#children) if (entry.debateId === id) this.#children.delete(threadId);
    if (debate && this.#core.journal.getThread(debate.salonThreadId)) {
      this.#core.journal.deleteThreads([debate.salonThreadId]);
      this.#core.bus.emit('thread.removed', { threadId: debate.salonThreadId, undoable: false });
    }
  }

  // -- lifecycle ----------------------------------------------------------------

  /**
   * After a restart handoff: rounds get their deadline back, a debater the
   * handoff cut is asked again, and so is a summarizer. Summaries held for a
   * parent go once it is idle.
   */
  resumeAfterRestart(): void {
    if (this.#closed) return;
    for (const parentId of [...this.#undelivered]) this.#deliverAll(parentId);
    for (const debate of this.#where("status IN ('running', 'summarizing')")) {
      this.#arm(debate);
      if (debate.status === 'running') {
        for (const participant of debate.participants.filter(p => p.pending && p.threadId)) {
          const thread = this.#core.journal.getThread(participant.threadId!);
          if (thread && !threadActive(thread.status)) this.#ask(debate.id, participant.id, debate.round);
        }
        this.#settleSoon(debate.id);
      } else if (debate.summarizer.threadId) {
        const thread = this.#core.journal.getThread(debate.summarizer.threadId);
        if (thread && !threadActive(thread.status)) {
          this.#mutate(debate.id, current => { current.status = 'running'; });
          this.#summarize(debate.id);
        }
      }
    }
  }

  /** The core stops: no deadline fires and no round starts while it drains. */
  beginClose(): void {
    this.#closed = true;
    for (const id of [...this.#timers.keys()]) this.#disarm(id);
  }
  close(): void {
    this.beginClose();
    this.#off();
  }
}
