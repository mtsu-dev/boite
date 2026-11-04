import { createHash } from 'node:crypto';
import { COUNCIL_AUTHOR, COUNCIL_DEFAULT_EFFORT, COUNCIL_DEFAULT_MODELS, COUNCIL_EXPERIMENT, COUNCIL_LEGACY_SUMMARY, COUNCIL_LIMITS, COUNCIL_OWNER, COUNCIL_SYSTEM, councilHandles, councilMention, councilNames, councilNearestEffort, councilOver, councilTable, threadActive } from '@boite/contracts';
import type { Council, CouncilMember, CouncilPost, CouncilReadOnly, CouncilStatus, Message, Principal, RpcParams, ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, notFound, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { isAgentHeld } from '../agents/runtime.ts';
import { assertDriverRunnable } from '../drivers/index.ts';
import { childEnd } from '../delegation/completion.ts';
import { catalog, providersNamed, type ChildRoute } from '../delegation/routes.ts';
import { withLoad } from '../threads/records.ts';
import { modelsFor } from '../threads/selection.ts';
import { clip, endedMessage, hasScoreLine, roundMessage, roundPrompt, scoreOf } from './prompt.ts';

/** What the core keeps beside the council and never sends. */
interface Internal {
  /** Member id to the turn asked this round; `starting` while `startTurn` runs, since a turn may end inside it. */
  turns: Record<string, string | null>;
  roundStartedAt: number;
  /** `again`'s request ids and what each asked, so a retry starts no second round. */
  again: Record<string, string>;
}
type Stored = Council & { internal: Internal };
/** A debate written before the council: its row holds these names. */
type StoredDebate = Omit<Stored, 'request' | 'members' | 'roundsDone' | 'status'> & { topic: string; participants: Omit<CouncilMember, 'scores'>[]; status: string };
interface PostRow { debate_id: string; seq: number; id: string; round: number; author: string; text: string; to_id: string | null; in_reply_to: string | null; turn_id: string | null; created_at: number }

const STARTING = 'starting';
const LIST_LIMIT = 30;
const UNDELIVERED = "status != 'running' AND status != 'summarizing' AND json_extract(data, '$.delivered') = 0";
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const minutes = (count: number) => `${count} minute${count === 1 ? '' : 's'}`;

function readOnlyOf(core: Core, providerId: string): CouncilReadOnly {
  const capabilities = core.providers.require(providerId).capabilities;
  return capabilities.planMode ? 'native' : capabilities.approvals ? 'approvals' : 'none';
}

/**
 * What a member's read-only level leaves open, said before its first round.
 * OpenCode's plan mode allows commands (`opencode debug agent plan`). OpenCode 2
 * was not measured, so it is warned the same rather than vouched for.
 */
export function readOnlyWarning(name: string, providerId: string, readOnly: CouncilReadOnly): string | null {
  if (readOnly === 'approvals') return `${name} has no read-only mode: Boite refuses every permission it asks.`;
  if (readOnly === 'none') return `${name} has no read-only mode and asks no permission: it could change files.`;
  return providerId === 'opencode' || providerId === 'opencode-v2' ? `${name} runs in OpenCode's plan mode, which refuses edits and allows commands: only its instructions keep those read-only.` : null;
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

/** A row as this core reads it: a stored debate becomes history without scores, and its rounds and votes stay behind. */
function fromRow(data: string): Stored {
  const raw = JSON.parse(data) as Stored | StoredDebate;
  if (!('topic' in raw)) return raw;
  const { topic, participants, status, ...rest } = raw;
  return {
    id: rest.id, parentThreadId: rest.parentThreadId, salonThreadId: rest.salonThreadId, round: rest.round, timeoutMinutes: rest.timeoutMinutes, note: rest.note, delivered: rest.delivered,
    roundDeadline: rest.roundDeadline, warnings: rest.warnings, createdAt: rest.createdAt, updatedAt: rest.updatedAt, finishedAt: rest.finishedAt, version: rest.version,
    request: topic, legacy: true, roundsDone: rest.round,
    status: status === 'done' || status === 'stopped' || status === 'failed' ? status : 'running',
    members: participants.map(participant => ({
      id: participant.id, name: participant.name, handle: participant.handle, providerId: participant.providerId, model: participant.model, effort: participant.effort,
      threadId: participant.threadId, readOnly: participant.readOnly, absent: participant.absent, pending: false, scores: [],
    })),
    internal: { turns: {}, roundStartedAt: 0, again: {} },
  };
}

/**
 * The council (`docs/council.md`). The core runs the rounds: each member is a
 * delegated child in a read-only permission mode, asked once per round, alone;
 * the salon is a thread that runs no agent and only draws the posts. A closed
 * round goes back to the parent as one message, and the members stay for the
 * next round until the parent ends the council. Every change reloads the
 * council from SQLite, because a turn can end inside the `startTurn` that began it.
 */
export class CouncilStore {
  readonly #core: Core;
  /** A member's thread to its council. */
  readonly #children = new Map<string, string>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Parents with a council whose last answers or notice have not reached them. */
  readonly #undelivered = new Set<string>();
  /** Members asked while their previous turn was still stopping. */
  readonly #waiting = new Set<string>();
  readonly #off: () => void;
  #closed = false;
  /** What one minute of `timeoutMinutes` lasts; a test shortens it. */
  minuteMs = 60_000;
  /** Closing, or the journal already shut: a crashed core closes it while timers and the startup tick may still fire. */
  get #gone(): boolean { return this.#closed || this.#core.journal.isClosed(); }
  /** A turn from before this can only be the startup recovery closing what the last core left open, no member's failure. */
  readonly #startedAt = Date.now();

  constructor(core: Core) {
    this.#core = core;
    for (const row of core.journal.db.query('SELECT thread_id, debate_id FROM debate_children').all() as { thread_id: string; debate_id: string }[]) this.#children.set(row.thread_id, row.debate_id);
    for (const { id } of core.journal.db.query('SELECT id FROM debates WHERE parent_thread_id NOT IN (SELECT id FROM threads)').all() as { id: string }[]) this.#forget(id);
    // A core that died resumes no paid work by itself: its rounds stop and say so. A handoff goes on (`resumeAfterRestart`).
    if (!core.threads.handoff.handedOver) for (const council of this.#where("status IN ('running', 'summarizing')")) this.#end(council.id, 'stopped', 'Boite restarted during the round, so it stopped.', false);
    for (const council of this.#where(UNDELIVERED)) this.#undelivered.add(council.parentThreadId);
    this.#off = core.bus.onCommitted((name, payload) => {
      if (this.#gone) return;
      try {
        if (name === 'turn.finished') this.#turnFinished(payload as Turn);
        else if (name === 'thread.updated') {
          const thread = payload as ThreadSummary;
          if (this.#waiting.has(thread.id)) this.#wake(thread.id);
          else if (thread.archived && !thread.parentThreadId && !thread.councilId) this.stopParent(thread.id, 'The thread that started it was archived.');
        } else if (name === 'thread.removed' && !(payload as { undoable?: boolean }).undoable) {
          const threadId = (payload as { threadId: string }).threadId;
          for (const council of this.#where('parent_thread_id = ?', threadId)) this.#forget(council.id);
        }
      } catch (error) { core.log('warn', `council after ${name}: ${messageOf(error)}`); }
    });
  }

  // -- gate and ownership -------------------------------------------------------

  enabled(): boolean {
    const experiments = this.#core.clients.desktopExperiments() ?? this.#core.clients.current()?.experiments ?? [];
    return experiments.includes(COUNCIL_EXPERIMENT);
  }
  gate(): void {
    if (!this.enabled()) throw refused('the council needs the Council experiment, which is off in the desktop app (Settings, Experiments)', { reason: 'experiment-off' });
  }
  /** A member's thread. */
  owns(threadId: string): boolean { return this.#children.has(threadId); }
  /** That thread is a member of a council this parent started, whose answers are the parent's to read. */
  memberOf(parentId: string, threadId: string): boolean {
    const councilId = this.#children.get(threadId);
    return councilId !== undefined && this.#load(councilId)?.parentThreadId === parentId;
  }
  /** A round of this parent's is under way: its message has not come yet. Between rounds nothing runs. */
  running(parentId: string): boolean {
    return this.#core.journal.db.query("SELECT 1 FROM debates WHERE parent_thread_id = ? AND status = 'running' LIMIT 1").get(parentId) !== null;
  }
  /** The council of that child is over: nothing will ask it again. Between rounds it is not: the same thread answers the next one. */
  overFor(threadId: string): boolean {
    const councilId = this.#children.get(threadId);
    const council = councilId ? this.#load(councilId) : null;
    return !council || councilOver(council);
  }

  // -- records ------------------------------------------------------------------

  #where(where: string, ...args: string[]): Stored[] {
    return (this.#core.journal.db.query(`SELECT data FROM debates WHERE ${where} ORDER BY created_at DESC`).all(...args) as { data: string }[]).map(row => fromRow(row.data));
  }
  #load(id: string): Stored | null {
    const row = this.#core.journal.db.query('SELECT data FROM debates WHERE id = ?').get(id) as { data: string } | null;
    return row ? fromRow(row.data) : null;
  }
  #require(id: unknown): Stored {
    if (typeof id !== 'string' || !id) throw invalidParams('councilId: expected a council id', { field: 'councilId' });
    const council = this.#load(id);
    if (!council) throw notFound(`council ${id} not found`, { councilId: id });
    return council;
  }
  #save(council: Stored): Stored {
    const now = Date.now();
    const saved = { ...council, version: council.version + 1, updatedAt: now };
    this.#core.journal.db.query('UPDATE debates SET status = ?, version = ?, data = ?, updated_at = ? WHERE id = ?').run(saved.status, saved.version, JSON.stringify(saved), now, saved.id);
    if (saved.status !== 'running' && !saved.delivered) this.#undelivered.add(saved.parentThreadId);
    this.#changed(saved);
    return saved;
  }
  /** Reloads, applies `change` and saves unless it returns false. */
  #mutate(id: string, change: (council: Stored) => false | void): Stored | null {
    const council = this.#load(id);
    if (!council || change(council) === false) return council;
    return this.#save(council);
  }
  #changed(council: Council): void {
    this.#core.bus.emit('council.changed', { councilId: council.id, threadId: council.parentThreadId, salonThreadId: council.salonThreadId, version: council.version });
  }
  #public({ internal: _internal, ...council }: Stored): Council { return council; }
  #rows(id: string, where = '', ...args: (string | number)[]): PostRow[] {
    return this.#core.journal.db.query(`SELECT * FROM debate_posts WHERE debate_id = ? ${where} ORDER BY seq`).all(id, ...args) as PostRow[];
  }
  #posts(id: string, where = '', ...args: (string | number)[]): CouncilPost[] {
    return this.#rows(id, where, ...args).map(row => ({ id: row.id, councilId: row.debate_id, seq: row.seq, round: row.round, author: row.author, text: row.text, to: row.to_id, inReplyTo: row.in_reply_to, createdAt: row.created_at }));
  }
  /** Writes a post and bumps the council so every viewer reloads it. */
  #post(id: string, post: Omit<CouncilPost, 'id' | 'councilId' | 'seq' | 'createdAt'> & { id?: string; turnId?: string | null }): CouncilPost {
    const now = Date.now();
    const postId = post.id ?? newId('dpo_');
    const seq = this.#core.journal.db.transaction(() => {
      const next = ((this.#core.journal.db.query('SELECT MAX(seq) AS seq FROM debate_posts WHERE debate_id = ?').get(id) as { seq: number | null }).seq ?? 0) + 1;
      this.#core.journal.db.query('INSERT INTO debate_posts (debate_id, seq, id, round, author, text, to_id, in_reply_to, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, next, postId, post.round, post.author, post.text, post.to, post.inReplyTo, post.turnId ?? null, now);
      return next;
    })();
    this.#mutate(id, () => undefined);
    return { id: postId, councilId: id, seq, round: post.round, author: post.author, text: post.text, to: post.to, inReplyTo: post.inReplyTo, createdAt: now };
  }
  #system(id: string, round: number, line: string): void {
    this.#post(id, { round, author: COUNCIL_SYSTEM, text: line, to: null, inReplyTo: null });
  }
  /** An agent acts only on a council its own thread started. */
  #own(council: Stored, threadId: unknown, principal: Principal): void {
    if (principal === 'agent' && council.parentThreadId !== threadId) throw refused('a council answers only the thread that started it', { councilId: council.id });
  }

  // -- RPC ----------------------------------------------------------------------

  list(params: RpcParams<'council.list'> = {}): { councils: Council[] } {
    this.gate();
    const rows = params.threadId === undefined ? this.#where('1 = 1') : this.#where('parent_thread_id = ?', text(params.threadId, 'threadId', 128));
    return { councils: rows.slice(0, LIST_LIMIT).map(council => this.#public(council)) };
  }

  get(params: RpcParams<'council.get'>): { council: Council; posts: CouncilPost[] } {
    this.gate();
    const council = this.#require(params?.councilId);
    return { council: this.#public(council), posts: this.#posts(council.id) };
  }

  table(params: RpcParams<'council.table'>, principal: Principal): { table: string; council: Council } {
    this.gate();
    const council = this.#require(params?.councilId);
    this.#own(council, params.threadId, principal);
    if (council.legacy) throw refused('a debate from before the council has no scores, so no table', { councilId: council.id });
    return { table: councilTable(council), council: this.#public(council) };
  }

  /**
   * What refuses a council before any list is read, and the council a retry of
   * this `requestId` already started (`known`). The RPC asks before it reads the
   * members' lists; `start` asks again, as that wait can change the answer.
   */
  admit(params: RpcParams<'council.start'>) {
    this.gate();
    const parent = this.#core.threads.require(text(params?.threadId, 'threadId', 128));
    if (parent.parentThreadId || this.#core.delegation.remote.parentOf(parent.id)) throw refused('a subagent cannot start a council; ask its parent', { threadId: parent.id });
    if (parent.teamId || parent.councilId) throw refused('a team chat or a council salon cannot start a council', { threadId: parent.id });
    if (parent.archived) throw refused('the thread is archived', { threadId: parent.id });
    const request = text(params.request, 'request', COUNCIL_LIMITS.requestChars);
    const named = params.models !== undefined && params.models !== null;
    if (named && !Array.isArray(params.models)) throw invalidParams('models: expected a list of provider/model routes', { field: 'models' });
    const models = named ? params.models!.map((model, index) => text(model, `models[${index}]`, 256)) : [...COUNCIL_DEFAULT_MODELS];
    if (models.length < COUNCIL_LIMITS.membersMin || models.length > COUNCIL_LIMITS.membersMax) throw invalidParams(`models: expected ${COUNCIL_LIMITS.membersMin} to ${COUNCIL_LIMITS.membersMax} members, got ${models.length}`, { field: 'models', expected: `${COUNCIL_LIMITS.membersMin}-${COUNCIL_LIMITS.membersMax}` });
    const timeoutMinutes = whole(params.timeoutMinutes, 'timeoutMinutes', 1, COUNCIL_LIMITS.timeoutMinutesMax, COUNCIL_LIMITS.timeoutMinutesDefault);
    const effort = params.effort === undefined || params.effort === null ? COUNCIL_DEFAULT_EFFORT : text(params.effort, 'effort', 32);
    const requestId = params.requestId === undefined ? null : text(params.requestId, 'requestId', 100);
    const fingerprint = hash([request, models, effort, timeoutMinutes]);
    const asked = { parent, request, named, models, timeoutMinutes, effort, requestId, fingerprint };
    if (requestId !== null) {
      const row = this.#core.journal.db.query('SELECT id, fingerprint FROM debates WHERE parent_thread_id = ? AND request_id = ?').get(parent.id, requestId) as { id: string; fingerprint: string } | null;
      if (row) {
        if (row.fingerprint !== fingerprint) throw refused('requestId already used for a different council', { field: 'requestId', expected: 'a fresh id' });
        return { ...asked, known: this.#public(this.#load(row.id)!) };
      }
    }
    const config = this.#core.delegation.config(parent.id);
    if (config.enabled && config.paused) throw refused('this conversation\'s subagents are paused; resume them before a council', { threadId: parent.id });
    return { ...asked, known: null };
  }

  /**
   * Checks everything, creates the salon and every member's thread in one go,
   * then asks round 1. Routes were read by the RPC (`prepareRoutes`) before this
   * runs. A route that cannot run refuses the whole council: a member is never replaced.
   */
  /** `unread`: the routes whose lists or effort scales `prepareMembers` could not read. */
  start(params: RpcParams<'council.start'>, unread: ReadonlySet<string> = new Set()): Council {
    const { parent, request, named, models, timeoutMinutes, effort, requestId, fingerprint, known } = this.admit(params);
    if (known) return known;
    const warnings: string[] = [];
    const route = (model: string, index: number): ChildRoute => {
      const what = named ? `models[${index}]` : `default member ${model}`;
      const unavailable = (why: string, details: Record<string, string>) => invalidParams(`${what}: ${why}. A council member is never replaced${named ? '' : '; name others with --models'}.`, { field: 'models', ...details });
      // A route with a slash is that very provider/model: `antigravity/x` is not `codex/antigravity/x`, which a gateway may list, and `twin/alpha` is not `twin/alpha-next`.
      const head = providersNamed(this.#core, model)?.[0];
      const prefix = model.includes('/') ? head ?? model.slice(0, model.indexOf('/')) : null;
      const notRead = unread.has(model) ? `${prefix ?? model}: models not read yet` : null;
      let resolved: ChildRoute;
      try {
        const listed = catalog(this.#core, parent, true);
        if (head !== undefined && !listed.choices.some(choice => choice.providerId === head)) throw new Error(`${head}: ${listed.unavailable.find(entry => entry.providerId === head)?.reason ?? 'not installed'}`);
        resolved = this.#core.delegation.resolve(parent.id, { profileId: null, model });
      } catch (error) {
        throw unavailable(notRead ?? messageOf(error), { model });
      }
      if (prefix !== null && `${resolved.providerId}/${resolved.model}`.toLowerCase() !== model.toLowerCase()) throw unavailable(notRead ?? `${prefix} does not offer it; the nearest is ${resolved.providerId}/${resolved.model}`, { model });
      const provider = this.#core.providers.require(resolved.providerId);
      // One level across models that name theirs differently: the strongest not above the one asked, and any other than that is said.
      const levels = modelsFor(provider, resolved.accountId).find(entry => entry.id === resolved.model)?.effort?.levels ?? [];
      const level = levels.some(entry => entry.id === effort) ? effort : councilNearestEffort(levels.map(entry => entry.id), effort);
      if (level !== null) resolved = { ...resolved, effort: level };
      if (levels.length === 0 && unread.has(model)) warnings.push(`${resolved.name}: its effort levels were not read yet, so it runs at ${resolved.effort ?? 'its default'}.`);
      else if (level !== effort && (levels.length > 0 || params.effort !== undefined && params.effort !== null)) warnings.push(`${resolved.name} has no ${effort} effort, so it runs at ${resolved.effort ?? 'its default'}.`);
      try {
        assertDriverRunnable(provider.protocol, this.#core.providers.summary(provider.id), this.#core.accounts.require(resolved.accountId), () => this.#core.providers.launcherScriptOnly(provider.id));
      } catch (error) {
        throw unavailable(notRead ?? messageOf(error), { model });
      }
      const owner = this.#core.workforce.resident.ownerOf(parent.id);
      const permissionMode = readOnlyOf(this.#core, resolved.providerId) === 'native' ? 'plan' as const : 'default' as const;
      if (owner && !this.#core.workforce.resident.allowed(owner, { ...resolved, permissionMode }, true)) throw refused(`${what}: account/model access was withdrawn from this bot`, { field: 'models' });
      return resolved;
    };
    const routes = models.map(route);
    const names = councilNames(routes.map(r => r.name));
    const handles = councilHandles(names);
    const now = Date.now();
    const id = newId('cnl_');
    const members: CouncilMember[] = routes.map((r, index) => {
      const readOnly = readOnlyOf(this.#core, r.providerId);
      const name = names[index]!;
      const warning = readOnlyWarning(name, r.providerId, readOnly);
      if (warning !== null) warnings.push(warning);
      return { id: `p${index + 1}`, name, handle: handles[index]!, providerId: r.providerId, model: r.model ?? '', effort: r.effort ?? null, threadId: null, readOnly, absent: [], pending: false, scores: [] };
    });
    const short = request.replace(/\s+/g, ' ');
    const salon: ThreadSummary = {
      id: newId('thr_'), projectId: null, councilId: id, title: `Council · ${short.slice(0, 100)}`, titleSource: 'user',
      providerId: parent.providerId, accountId: parent.accountId, model: parent.model, effort: parent.effort, speed: null, cwd: parent.cwd, branch: null, permissionMode: 'plan',
      status: 'idle', unread: false, archived: false, pinned: false, sessionId: null, sessionGeneration: 0, selectionVersion: 0, load: null, context: null, createdAt: now, updatedAt: now,
    };
    const council: Stored = {
      id, request, parentThreadId: parent.id, salonThreadId: salon.id, round: 0, roundsDone: 0, status: 'running', members, timeoutMinutes, note: null, delivered: false, roundDeadline: null, warnings,
      createdAt: now, updatedAt: now, finishedAt: null, version: 1, internal: { turns: {}, roundStartedAt: 0, again: {} },
    };
    this.#core.journal.append({ type: 'thread.created', threadId: salon.id, version: 1, payload: salon }, db => {
      this.#core.journal.putThread(salon);
      db.query('INSERT INTO debates (id, parent_thread_id, salon_thread_id, request_id, fingerprint, status, version, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
        .run(id, parent.id, salon.id, requestId, fingerprint, 'running', JSON.stringify(council), now, now);
    });
    this.#core.bus.emit('thread.created', withLoad(this.#core, salon));
    // Every member exists before the first round, so a failure leaves no half-made council running.
    try {
      for (const [index, member] of members.entries()) {
        const r = routes[index]!;
        const permissionMode = readOnlyOf(this.#core, r.providerId) === 'native' ? 'plan' as const : 'default' as const;
        const threadId = this.#core.delegation.createChild(parent, r, `Council · ${member.name} · ${short.slice(0, 60)}`.slice(0, 120), childId => {
          this.#core.journal.db.query("INSERT INTO debate_children (thread_id, debate_id, role) VALUES (?, ?, 'participant')").run(childId, id);
        }, undefined, false, { contextMode: null, permissionMode });
        this.#children.set(threadId, id);
        member.threadId = threadId;
      }
      this.#save(council);
    } catch (error) {
      // The members made so far are recorded, so the end puts them away; the caller reads the error itself.
      try { this.#save(council); } catch { /* the row stays as it was inserted */ }
      this.#end(id, 'failed', `The members could not be created: ${messageOf(error)}`, false, false);
      throw error;
    }
    this.#card(parent, id, request);
    this.#core.logs.info(`Council ${id} started by ${parent.id} with ${members.map(m => `${m.providerId}/${m.model}`).join(', ')}`, {
      source: 'council', event: 'council.started', threadId: parent.id, data: { councilId: id, members: members.length, warnings: warnings.length },
    });
    this.#beginRound(id, 1);
    return this.#public(this.#load(id)!);
  }

  /**
   * A fresh round after the parent's fixes: the same members in the same threads.
   * The parent must hold the last round's answers first, or it could not have
   * acted on them. `requestId` makes a retry start no second round.
   */
  again(params: RpcParams<'council.again'>, principal: Principal): Council {
    this.gate();
    const council = this.#require(params?.councilId);
    this.#own(council, params.threadId, principal);
    const changes = text(params.changes, 'changes', COUNCIL_LIMITS.requestChars);
    const requestId = params.requestId === undefined ? null : text(params.requestId, 'requestId', 100);
    const fingerprint = hash(changes);
    if (requestId !== null && council.internal.again[requestId] !== undefined) {
      if (council.internal.again[requestId] !== fingerprint) throw refused('requestId already used for a different round', { field: 'requestId', expected: 'a fresh id' });
      return this.#public(council);
    }
    if (councilOver(council)) throw refused(`council ${council.id} is over (${council.status}); start a new one with boite delegate council`, { councilId: council.id, status: council.status });
    if (council.status === 'running') throw refused(`round ${council.round} of council ${council.id} is still running; its answers come back as a message`, { councilId: council.id, status: council.status });
    if (!council.delivered) throw refused(`the answers of round ${council.round} have not reached the thread yet: end your turn to receive them, then ask again`, { councilId: council.id, status: council.status });
    const parent = this.#core.threads.require(council.parentThreadId);
    if (parent.archived) throw refused('the thread that started it is archived', { threadId: parent.id });
    const config = this.#core.delegation.config(parent.id);
    if (config.enabled && config.paused) throw refused('this conversation\'s subagents are paused; resume them before a new round', { threadId: parent.id });
    const round = council.round + 1;
    this.#mutate(council.id, current => {
      current.status = 'running';
      if (requestId !== null) current.internal.again[requestId] = fingerprint;
    });
    this.#post(council.id, { round, author: COUNCIL_AUTHOR, text: changes, to: null, inReplyTo: null });
    this.#core.logs.info(`Council ${council.id} round ${round}`, { source: 'council', event: 'council.again', threadId: parent.id, data: { councilId: council.id, round } });
    this.#beginRound(council.id, round);
    return this.#public(this.#load(council.id)!);
  }

  /** The owner writes in the salon. Without `@`, every member reads it next round; with one, only that member. */
  post(params: RpcParams<'council.post'>): CouncilPost {
    this.gate();
    const council = this.#require(params?.councilId);
    const body = text(params.text, 'text', COUNCIL_LIMITS.postChars);
    // One trimmed id for the lookup, the other councils' check and the insert, so a retry finds what it stored.
    const postId = params.id === undefined ? undefined : text(params.id, 'id', 100);
    if (postId !== undefined) {
      const known = this.#posts(council.id, 'AND id = ?', postId)[0];
      if (known) return known;
      if (this.#core.journal.db.query('SELECT 1 FROM debate_posts WHERE id = ?').get(postId)) throw refused('id: already used in another council', { field: 'id' });
    }
    if (councilOver(council)) throw refused('the council is over', { councilId: council.id, status: council.status });
    const to = councilMention(body, council.members);
    return this.#post(council.id, { ...(postId === undefined ? {} : { id: postId }), round: council.round + 1, author: COUNCIL_OWNER, text: body, to, inReplyTo: null });
  }

  /** Closes the round now: whoever has not answered is absent from it, with no score. */
  closeRound(params: RpcParams<'council.closeRound'>): Council {
    this.gate();
    const council = this.#require(params?.councilId);
    if (council.status !== 'running') throw refused('no round is under way', { councilId: council.id, status: council.status });
    this.#closeRound(council.id);
    return this.#public(this.#load(council.id)!);
  }

  /**
   * Ends the council. During a round its turns stop and nothing goes back to the
   * parent; between rounds a round's answers not yet delivered still go, since
   * that round closed and was paid for.
   */
  stop(params: RpcParams<'council.stop'>, principal: Principal): Council {
    this.gate();
    const council = this.#require(params?.councilId);
    this.#own(council, params.threadId, principal);
    if (councilOver(council)) return this.#public(council);
    if (council.status === 'waiting') this.#end(council.id, 'done', null, false, !council.delivered);
    else this.#end(council.id, 'stopped', principal === 'agent' ? 'Stopped by the agent that started it.' : 'Stopped by the user.', true, false);
    return this.#public(this.#load(council.id)!);
  }

  /** Stop on the thread, or its archive, stops the rounds under way; nothing goes back to it. A council between rounds runs nothing and waits. Returns how many. */
  stopParent(threadId: string, why: string): number {
    let stopped = 0;
    for (const council of this.#where("parent_thread_id = ? AND status IN ('running', 'summarizing')", threadId)) { this.#end(council.id, 'stopped', why, true, false); stopped++; }
    return stopped;
  }

  // -- rounds -------------------------------------------------------------------

  #beginRound(id: string, round: number): void {
    const now = Date.now();
    const council = this.#mutate(id, current => {
      if (current.status !== 'running') return false;
      current.round = round;
      current.delivered = false;
      current.roundDeadline = now + current.timeoutMinutes * this.minuteMs;
      current.internal.roundStartedAt = now;
      for (const member of current.members) {
        member.pending = member.threadId !== null;
        current.internal.turns[member.id] = member.pending ? STARTING : null;
      }
    });
    if (!council || council.status !== 'running' || council.round !== round) return;
    this.#arm(council);
    for (const member of council.members) if (member.threadId) this.#ask(id, member.id, round);
    this.#settleSoon(id);
  }

  /** One member's turn for the round, built from what the council holds now: never another member's answer. */
  #ask(id: string, memberId: string, round: number): void {
    const council = this.#load(id);
    const member = council?.members.find(m => m.id === memberId);
    if (!council || !member?.threadId || council.status !== 'running' || council.round !== round || !member.pending) return;
    const posts = this.#posts(id, 'AND round = ?', round);
    const changes = posts.findLast(post => post.author === COUNCIL_AUTHOR)?.text ?? null;
    const owner = posts.filter(post => post.author === COUNCIL_OWNER && (post.to === null || post.to === memberId)).map(post => post.text);
    // Its last turn is still stopping (a closed round, a deadline): it is asked once that ends (`#wake`).
    if (this.#core.threads.isBusy(member.threadId)) {
      this.#waiting.add(member.threadId);
      this.#mutate(id, current => { current.internal.turns[memberId] = STARTING; });
      return;
    }
    this.#waiting.delete(member.threadId);
    this.#mutate(id, current => { current.internal.turns[memberId] = STARTING; });
    try {
      const turn = this.#core.threads.startTurn(member.threadId, { prompt: roundPrompt(council, round, changes, owner), display: `Council round ${round}` }, { kind: 'delegation' });
      this.#mutate(id, current => {
        const now = current.members.find(m => m.id === memberId);
        if (current.round !== round || !now?.pending || current.internal.turns[memberId] !== STARTING) return false;
        current.internal.turns[memberId] = turn.id;
      });
    } catch (error) {
      this.#absent(id, memberId, round, `could not start: ${messageOf(error)}`);
    }
  }

  /** A member whose question waited for its stopping turn is asked once that thread is free. */
  #wake(threadId: string): void {
    if (!this.#waiting.has(threadId) || this.#core.threads.isBusy(threadId)) return;
    this.#waiting.delete(threadId);
    const councilId = this.#children.get(threadId);
    const council = councilId ? this.#load(councilId) : null;
    const member = council?.members.find(m => m.threadId === threadId);
    if (!council || !member?.pending || council.status !== 'running' || council.internal.turns[member.id] !== STARTING) return;
    this.#ask(council.id, member.id, council.round);
  }

  #absent(id: string, memberId: string, round: number, why: string): void {
    let name = '';
    const council = this.#mutate(id, current => {
      const member = current.members.find(m => m.id === memberId);
      if (current.round !== round || !member?.pending) return false;
      member.pending = false;
      if (!member.absent.includes(round)) member.absent.push(round);
      member.scores[round - 1] = null;
      current.internal.turns[memberId] = null;
      name = member.name;
    });
    if (!name || !council) return;
    this.#system(id, round, `${name} did not answer round ${round}: ${why}.`);
    this.#settleSoon(id);
  }

  /** Every member still asked stops: what it wrote so far, on its own background work, is its answer, or it is absent from the round. */
  #absentPending(id: string, why: string): void {
    const council = this.#load(id);
    if (!council || council.status !== 'running') return;
    for (const member of council.members.filter(m => m.pending)) {
      const said = member.threadId ? this.#said(council, member.threadId) : null;
      if (said?.text) this.#record(council, member, said);
      else this.#absent(id, member.id, council.round, why);
      if (member.threadId) this.#stopChild(member.threadId);
    }
  }

  #arm(council: Council): void {
    this.#disarm(council.id);
    if (council.roundDeadline === null || this.#gone) return;
    const timer = setTimeout(() => {
      this.#timers.delete(council.id);
      try { this.#deadline(council.id); } catch (error) { this.#core.log('warn', `council ${council.id} deadline: ${messageOf(error)}`); }
    }, Math.max(0, council.roundDeadline - Date.now()));
    timer.unref?.();
    this.#timers.set(council.id, timer);
  }
  #disarm(id: string): void {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
  }

  #deadline(id: string): void {
    if (this.#gone) return;
    const council = this.#load(id);
    if (!council || council.status !== 'running') return;
    this.#absentPending(id, `no answer within ${minutes(council.timeoutMinutes)}`);
    this.#closeRound(id);
  }

  /** Looks again once the current call is over: a turn may end inside the start that asked it. */
  #settleSoon(id: string): void {
    setTimeout(() => {
      if (this.#gone) return;
      try { this.#closeRound(id, true); } catch (error) { this.#core.log('warn', `council ${id}: ${messageOf(error)}`); }
    }, 0).unref?.();
  }

  /**
   * Ends the round once nobody is pending (or now, for a close or a deadline).
   * The council then waits for the parent, even if nobody answered: the table
   * says `no score` and the parent decides whether a new round is worth it.
   */
  #closeRound(id: string, onlyWhenAnswered = false): void {
    const council = this.#load(id);
    if (!council || council.status !== 'running' || council.round === 0) return;
    if (council.members.some(m => m.pending)) {
      if (onlyWhenAnswered) return;
      this.#absentPending(id, 'closed early');
    }
    this.#disarm(id);
    const closed = this.#mutate(id, current => {
      if (current.status !== 'running') return false;
      current.status = 'waiting';
      current.roundsDone = current.round;
      current.roundDeadline = null;
      current.delivered = false;
      current.internal.turns = {};
    });
    if (!closed || closed.status !== 'waiting') return;
    this.#core.logs.info(`Council ${id} closed round ${closed.round}`, { source: 'council', event: 'council.round-closed', threadId: closed.parentThreadId, data: { councilId: id, round: closed.round } });
    this.#deliverSoon(id);
  }

  #turnFinished(turn: Turn): void {
    const councilId = this.#children.get(turn.threadId);
    if (!councilId) {
      // The parent finished a turn of its own: answers held for it may go now.
      if (this.#undelivered.has(turn.threadId)) setTimeout(() => { if (!this.#gone) this.#deliverAll(turn.threadId); }, 0).unref?.();
      return;
    }
    const end = childEnd(this.#core, turn);
    if (end.kind === 'maintenance') return;
    if (this.#waiting.has(turn.threadId)) setTimeout(() => { if (!this.#gone) this.#wake(turn.threadId); }, 0).unref?.();
    const council = this.#load(councilId);
    if (!council) return;
    // A restart handoff stopped it on purpose, or left it open for this core's recovery to close: the member is asked again (`resumeAfterRestart`).
    if (turn.queuedAt < this.#startedAt || (turn.status === 'stopped' && this.#core.threads.handoff.active)) return;
    const member = council.members.find(m => m.threadId === turn.threadId);
    const asked = member ? council.internal.turns[member.id] : null;
    if (!member?.pending || council.status !== 'running' || (asked !== turn.id && !(asked === STARTING && turn.queuedAt >= council.internal.roundStartedAt))) return;
    const said = this.#said(council, turn.threadId);
    // It ended to wait on its own background work: unless a score closes what it wrote, the turn that work wakes answers, and the round's time still runs.
    if (end.kind === 'checkpoint' && !hasScoreLine(said.text)) { this.#mutate(council.id, current => { current.internal.turns[member.id] = STARTING; }); return; }
    if (!said.text) return this.#absent(council.id, member.id, council.round, turn.status === 'done' ? 'its answer was empty' : turn.status === 'stopped' ? 'its turn was stopped' : `its turn failed${turn.error ? ` (${turn.error.slice(0, 200)})` : ''}`);
    this.#record(council, member, said);
    // It has answered, and nobody reads what that work would wake.
    if (end.kind === 'checkpoint') setTimeout(() => { if (!this.#gone) this.#stopChild(turn.threadId); }, 0).unref?.();
  }

  #record(council: Stored, member: CouncilMember, said: { text: string; turnId: string | null }): void {
    const round = council.round;
    const replied = this.#posts(council.id, 'AND round = ? AND author = ? AND to_id = ?', round, COUNCIL_OWNER, member.id).at(-1)?.id ?? null;
    this.#core.journal.db.transaction(() => {
      this.#post(council.id, { round, author: member.id, text: clip(said.text, COUNCIL_LIMITS.answerChars), to: null, inReplyTo: replied, turnId: said.turnId });
      this.#mutate(council.id, current => {
        const now = current.members.find(m => m.id === member.id)!;
        now.pending = false;
        now.scores[round - 1] = scoreOf(said.text);
        current.internal.turns[member.id] = null;
      });
    })();
    this.#settleSoon(council.id);
  }

  /** All a member wrote over the round: a turn ended on its background work, then the one that work woke. */
  #said(council: Stored, threadId: string): { text: string; turnId: string | null } {
    const turns = this.#core.journal.listTurns(threadId).filter(turn => turn.status === 'done' && turn.queuedAt >= council.internal.roundStartedAt && childEnd(this.#core, turn).kind !== 'maintenance');
    return { text: turns.map(turn => this.#answer(turn)).filter(Boolean).join('\n\n'), turnId: turns.at(-1)?.id ?? null };
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
   * The council is over. `stopTurns` stops what still runs; the members are put
   * away; `deliver` hands what the parent has not read, or why there is nothing,
   * to it. A stop during a round delivers nothing.
   */
  #end(id: string, status: Exclude<CouncilStatus, 'running' | 'waiting'>, note: string | null, stopTurns: boolean, deliver = true): void {
    this.#disarm(id);
    const before = this.#load(id);
    if (!before || councilOver(before)) return;
    const council = this.#mutate(id, current => {
      current.status = status;
      if (note) current.note = note;
      current.roundDeadline = null;
      current.finishedAt = Date.now();
      for (const member of current.members) member.pending = false;
      current.internal.turns = {};
      if (!deliver) current.delivered = true;
    });
    if (!council) return;
    if (note) this.#system(id, council.round, note);
    const children = (this.#core.journal.db.query('SELECT thread_id FROM debate_children WHERE debate_id = ?').all(id) as { thread_id: string }[]).map(row => row.thread_id);
    if (stopTurns) for (const threadId of children) this.#stopChild(threadId);
    for (const threadId of children) {
      try { this.#core.delegation.retirements.check(threadId); } catch (error) { this.#core.log('warn', `council ${id}: retiring ${threadId}: ${messageOf(error)}`); }
    }
    this.#core.logs.info(`Council ${id} ${status}${note ? `: ${note}` : ''}`, { source: 'council', event: `council.${status}`, threadId: council.parentThreadId, data: { councilId: id, rounds: council.roundsDone } });
    if (deliver) this.#deliverSoon(id);
  }

  #stopChild(threadId: string): void {
    const thread = this.#core.journal.getThread(threadId);
    // At rest on its own background work is at work too: Stop ends that work.
    if (!thread || (!threadActive(thread.status) && (this.#core.threads.agentState.background.get(threadId)?.length ?? 0) === 0)) return;
    try { this.#core.threads.stopTurn(threadId); } catch (error) { this.#core.log('warn', `council member ${threadId} not stopped: ${messageOf(error)}`); }
  }

  #deliverSoon(id: string): void {
    if (!this.#gone) setTimeout(() => { if (!this.#gone) this.#deliver(id); }, 0).unref?.();
  }
  #deliverAll(parentId: string): void {
    for (const council of this.#where(`parent_thread_id = ? AND ${UNDELIVERED}`, parentId)) this.#deliver(council.id);
  }

  /** What the parent reads: the round's answers and the table, or why there is none. */
  #message(council: Stored): { prompt: string; display: string } {
    const topic = council.request.replace(/\s+/g, ' ').slice(0, 120);
    if (council.legacy) {
      const summary = this.#posts(council.id, 'AND author = ?', COUNCIL_LEGACY_SUMMARY).at(-1)?.text;
      return { prompt: `${endedMessage(council)}${summary ? `\n\n${clip(summary, 4000)}` : ''}`, display: `Debate ended: ${topic}` };
    }
    // A council that stopped or failed had no round left to report; one closed between rounds still has its last.
    if ((council.status !== 'waiting' && council.status !== 'done') || council.roundsDone === 0) return { prompt: endedMessage(council), display: `Council ended: ${topic}` };
    const round = council.roundsDone;
    const posts = this.#rows(council.id, 'AND round = ?', round);
    const answers = council.members.map(member => {
      const post = posts.find(row => row.author === member.id);
      return { member, text: post?.text ?? null, turnId: post?.turn_id ?? null };
    });
    const notes = posts.filter(row => row.author === COUNCIL_SYSTEM).map(row => row.text);
    return { prompt: roundMessage(council, answers, notes), display: `Council round ${round}: ${topic}` };
  }

  /** The round's answers, or why there are none, as one turn of the parent once it is idle; its next finished turn retries. */
  #deliver(id: string): void {
    if (this.#gone) return;
    const council = this.#load(id);
    if (!council || council.delivered || council.status === 'running') return;
    const parent = this.#core.journal.getThread(council.parentThreadId);
    const delivered = () => {
      this.#mutate(id, current => { if (current.delivered) return false; current.delivered = true; });
      if (!this.#where(`parent_thread_id = ? AND ${UNDELIVERED}`, council.parentThreadId).length) this.#undelivered.delete(council.parentThreadId);
    };
    if (!parent || parent.archived) return delivered();
    if (threadActive(parent.status)) { this.#core.threads.cacheKeepalive.yieldTo(parent.id); return; }
    try {
      this.#core.threads.startTurn(parent.id, this.#message(council), { kind: 'delegation' });
      delivered();
    } catch (error) {
      if (isAgentHeld(error)) this.#core.agentRuntime.whenAdmitted(parent.id, `council:${id}`, () => this.#deliver(id));
      this.#core.log('warn', `council ${id} answers not delivered: ${messageOf(error)}`);
    }
  }

  /** The card in the conversation that started the council, on the turn that runs the command. */
  #card(parent: ThreadSummary, councilId: string, topic: string): void {
    const turn = this.#core.journal.runningTurn(parent.id);
    if (turn === null) return;
    const message: Message = { id: newId('msg_'), threadId: parent.id, turnId: turn.id, role: 'assistant', parts: [{ type: 'council', councilId, topic: topic.slice(0, 300) }], state: 'complete', createdAt: Date.now() };
    this.#core.journal.append({ type: 'message.started', threadId: parent.id, version: 1, payload: message }, () => this.#core.journal.putMessage(message));
    this.#core.bus.emit('message.started', message);
    this.#core.bus.emit('message.completed', { threadId: parent.id, messageId: message.id, state: 'complete' });
  }

  /** The parent is gone for good: so are the council's rows and its salon. */
  #forget(id: string): void {
    const council = this.#load(id);
    this.#disarm(id);
    this.#core.journal.db.transaction(() => {
      for (const table of ['debate_posts', 'debate_children']) this.#core.journal.db.query(`DELETE FROM ${table} WHERE debate_id = ?`).run(id);
      this.#core.journal.db.query('DELETE FROM debates WHERE id = ?').run(id);
    })();
    for (const [threadId, councilId] of this.#children) if (councilId === id) this.#children.delete(threadId);
    if (council && this.#core.journal.getThread(council.salonThreadId)) {
      this.#core.journal.deleteThreads([council.salonThreadId]);
      this.#core.bus.emit('thread.removed', { threadId: council.salonThreadId, undoable: false });
    }
  }

  // -- lifecycle ----------------------------------------------------------------

  /**
   * After a restart handoff: rounds get their deadline back and a member the
   * handoff cut is asked again. Answers held for a parent go once it is idle. A
   * debate still running from before the council stops, and says so.
   */
  resumeAfterRestart(): void {
    if (this.#gone) return;
    for (const parentId of [...this.#undelivered]) this.#deliverAll(parentId);
    for (const council of this.#where("status IN ('running', 'summarizing')")) {
      if (council.legacy) {
        this.#end(council.id, 'stopped', 'Debates were replaced by the council at this update, so this one stopped. boite delegate council starts a review.', true);
        continue;
      }
      this.#arm(council);
      for (const member of council.members.filter(m => m.pending && m.threadId)) {
        const thread = this.#core.journal.getThread(member.threadId!);
        if (thread && !threadActive(thread.status)) this.#ask(council.id, member.id, council.round);
      }
      this.#settleSoon(council.id);
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
