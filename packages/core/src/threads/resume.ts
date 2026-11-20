import type { PluginActor, RpcEvents, RpcParams, ThreadId, ThreadRecovery, ThreadRetry, ThreadSummary, Turn, TurnId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf, refused } from '../errors.ts';
import type { ThreadStore } from '../threads.ts';
import { withLoad } from './records.ts';
import { CARRY_ON, RESUME_TEXT, type PlannedReason } from './resume-text.ts';

/**
 * Mutable so a test can shorten them. `limit`: how long after a window's reset
 * the thread resumes, so the provider has rolled it over, and the least a
 * plan waits after a core start. `carryOn`: how long after a stop the first
 * and the second resume of a row go out, past the last one Boite gives up,
 * and the least a resume waits after a core start.
 */
export const RESUME_TIMING = {
  limit: { marginMs: 60_000, startDelayMs: 2_000 },
  carryOn: { delaysMs: [60_000, 300_000], startDelayMs: 3_000 },
};

/** The journal setting holding every planned resume and each thread's row of resumes. */
const KEY = 'resumes';
/** Where the two planners this one replaced kept theirs: read once, then removed. */
const LEGACY_LIMIT_KEY = 'limit-resumes';
const LEGACY_CARRY_ON_KEY = 'auto-continues';
/** How long a resume waits for a cache ping it stopped to end. */
const PING_YIELD_MS = 1_000;

/** The account, model and session a usage limit was hit on: a resume on another one would not be the same work. */
interface LimitSelection {
  providerId: string;
  accountId: string;
  model: string | null;
  sessionGeneration: number;
}

export interface Plan {
  reason: PlannedReason;
  /** The turn that stopped: the thread's last turn while the plan stands. */
  turnId: TurnId;
  at: number;
  prompt: string;
  /** A usage limit's: the reset of the spent window, and what it was spent on. */
  resetsAt?: number;
  selection?: LimitSelection;
  /** Written just before dispatch; the request receipt records its durable admission. */
  dispatching?: true;
}

export interface Entry {
  plan?: Plan;
  recovery?: ThreadRecovery;
  /** Carry-on resumes sent since the user last wrote or a turn of another kind finished well. */
  streak?: number;
  /** The last turn a plan was made for: a turn is resumed once. */
  handled?: TurnId;
  /** The last carry-on resume sent: its own good end does not reset the row, so background work dying each time cannot loop. */
  resumeTurnId?: TurnId;
  /** The reset of the window this thread last resumed after: one usage limit resume per window. */
  resumedWindow?: number;
}

type Record_ = Record<ThreadId, Entry>;

/**
 * Every resume the core plans for a thread by itself, whatever stopped it: a
 * usage limit (`threads/limit-resume.ts`) or a turn that stopped before its
 * answer (`threads/auto-continue.ts`). One journalled record survives a
 * restart. At startup the request receipt settles an admitted plan, and a
 * plan without a receipt is armed again. Everything is checked when it fires. A cache ping
 * neither cancels a plan nor holds it back: it gives way.
 */
export class ResumePlanner {
  readonly #timers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
  #closed = false;
  #cached: Record_ | null = null;

  readonly #core: Core;

  constructor(core: Core, private readonly threads: ThreadStore) {
    this.#core = core;
    // An archive that rolls back keeps the plan and its timer.
    core.bus.onCommitted((name, payload) => {
      if (this.#closed) return;
      if (name === 'turn.started') this.#turnStarted(payload as RpcEvents['turn.started']);
      else if (name === 'thread.updated' && (payload as ThreadSummary).archived) this.cancel((payload as ThreadSummary).id, 'the thread was archived');
    });
  }

  /** Once recovery ran: plans a previous core left are armed again, those of threads that are gone dropped. */
  start(): void {
    const record = this.#load();
    let changed = false;
    for (const [threadId, entry] of Object.entries(record)) {
      const thread = this.#core.journal.getThread(threadId);
      if (thread === null || (thread.archived && entry.resumedWindow === undefined)) {
        delete record[threadId];
        changed = true;
        continue;
      }
      // An archived thread can come back: the window it resumed after stays, as `forget` keeps it.
      if (thread.archived) {
        if (Object.keys(entry).length > 1) {
          record[threadId] = { resumedWindow: entry.resumedWindow };
          changed = true;
        }
        continue;
      }
      let plan = entry.plan;
      if (plan === undefined) continue;
      if (plan.dispatching) {
        const receipt = this.#core.journal.turnRequest(threadId, requestId(plan.turnId, plan.reason === 'limit'));
        changed = true;
        if (receipt !== null) {
          record[threadId] = settled(entry, plan, receipt.turn_id as TurnId);
          continue;
        }
        const { dispatching: _, ...unsent } = plan;
        plan = unsent;
        record[threadId] = { ...entry, plan };
      }
      // Plans from before recovery notices still carry the interrupted turn and quota reset.
      if (entry.recovery === undefined) {
        record[threadId] = { ...entry, plan, recovery: recoveryForPlan(plan) };
        changed = true;
      }
      const startDelay = plan.reason === 'limit' ? RESUME_TIMING.limit.startDelayMs : RESUME_TIMING.carryOn.startDelayMs;
      this.#arm(threadId, Math.max(startDelay, plan.at - Date.now()));
    }
    if (changed) this.#save(record);
  }

  /** A queued automatic resume already has its own journalled prompt and receipt. */
  admitted(turn: Turn): boolean {
    if (turn.execution?.operation !== 'resume') return false;
    const entry = this.#load()[turn.threadId];
    const source = entry?.plan?.turnId ?? entry?.handled ?? entry?.recovery?.turnId;
    return source !== undefined && [requestId(source, false), requestId(source, true)].some(id =>
      this.#core.journal.turnRequest(turn.threadId, id)?.turn_id === turn.id);
  }

  manuallyAdmitted(turn: Turn): boolean {
    if (turn.execution?.operation !== 'resume') return false;
    const source = this.#load()[turn.threadId]?.handled;
    return source !== undefined && this.#core.journal.turnRequest(turn.threadId, manualRequestId(source))?.turn_id === turn.id;
  }

  close(): void {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  /** The thread's row of resumes, a copy. */
  entry(threadId: ThreadId): Entry | undefined {
    const entry = this.#load()[threadId];
    return entry === undefined ? undefined : { ...entry };
  }

  /** Whether a resume is planned or going out. */
  planned(threadId: ThreadId): boolean {
    return this.#load()[threadId]?.plan !== undefined;
  }

  /** The resume planned for the thread, as its row shows it; null when none or while it goes out. */
  retryOf(threadId: ThreadId): ThreadRetry | null {
    const entry = this.#load()[threadId];
    const plan = entry?.plan;
    if (plan === undefined || plan.dispatching) return null;
    if (plan.reason === 'limit') return { kind: 'usage-limit', turnId: plan.turnId, at: plan.at, attempt: 1, attempts: 1, resetsAt: plan.resetsAt ?? null };
    return { kind: 'auto-continue', turnId: plan.turnId, at: plan.at, attempt: (entry!.streak ?? 0) + 1, attempts: RESUME_TIMING.carryOn.delaysMs.length, resetsAt: null };
  }

  recoveryOf(thread: ThreadSummary): ThreadRecovery | null {
    if (thread.archived || thread.parentThreadId || (thread.status !== 'error' && thread.status !== 'idle')) return null;
    const recovery = this.#load()[thread.id]?.recovery;
    return recovery && this.lastTurn(thread.id)?.id === recovery.turnId ? recovery : null;
  }

  offer(turn: Turn, recovery: Omit<ThreadRecovery, 'turnId'>): void {
    if (this.#closed || this.#core.journal.isClosed() || this.lastTurn(turn.threadId)?.id !== turn.id) return;
    const record = this.#load();
    record[turn.threadId] = { ...record[turn.threadId], recovery: { ...recovery, turnId: turn.id } };
    this.#save(record);
    this.#announce(turn.threadId);
  }

  resume({ threadId, turnId, model, expectedSelectionVersion }: RpcParams<'turns.resume'>, plugin?: PluginActor): Turn {
    const thread = this.threads.require(threadId);
    const id = manualRequestId(turnId);
    const receipt = this.#core.journal.turnRequest(threadId, id);
    const accepted = receipt && this.#core.journal.getTurn(receipt.turn_id);
    if (accepted) {
      if (model !== undefined && model !== accepted.execution?.model) throw refused('this turn already resumed on another model');
      return accepted;
    }
    const recovery = this.recoveryOf(thread);
    const source = this.lastTurn(threadId);
    if (recovery?.turnId !== turnId || source?.id !== turnId) throw refused('turnId must name the latest interrupted turn of this thread', { field: 'turnId', threadId, turnId });
    const changed = model !== undefined && model !== thread.model;
    if (changed && (recovery.kind !== 'usage-limit' || thread.agentSessionId)) throw refused('the model can only change when resuming an ordinary conversation after a usage limit');
    const lead = recovery.kind === 'usage-limit' ? `A usage limit interrupted the previous turn. ${CARRY_ON}` : CARRY_ON;
    const choice = changed ? { ...thread, model, effort: null, speed: null } : undefined;
    return this.threads.startTurn(threadId, { ...this.threads.handoff.continuation(source, lead), display: 'Resumed interrupted work' },
      { kind: 'resume', reason: 'manual', requestId: id, plugin }, {
        choice, expectedSelectionVersion,
        persistAdmission: () => {
          const record = this.#load();
          record[threadId] = { handled: turnId, resumedWindow: record[threadId]?.resumedWindow };
          this.#core.journal.setSetting(KEY, record);
          return () => {
            this.#cached = record;
            this.#disarm(threadId);
          };
        },
      });
  }

  /** Plans the resume of `turn`, the thread's last, at `plan.at`. The caller decided it is due. */
  schedule(threadId: ThreadId, turn: Turn, plan: Omit<Plan, 'turnId' | 'dispatching'>, message: string): void {
    if (this.#closed || this.#core.journal.isClosed()) return;
    const full: Plan = { ...plan, turnId: turn.id };
    const record = this.#load();
    const current = record[threadId];
    const recovery = current?.recovery?.turnId === turn.id ? current.recovery : recoveryForPlan(full);
    record[threadId] = { ...current, handled: turn.id, plan: full, recovery };
    this.#save(record);
    this.#arm(threadId, full.at - Date.now());
    this.log('info', threadId, message, 'planned', full);
    this.#announce(threadId);
  }

  /** Writes the thread's row with no plan: a turn resumes nothing more. */
  settle(threadId: ThreadId, entry: Omit<Entry, 'plan'>): void {
    if (this.#core.journal.isClosed()) return;
    const record = this.#load();
    record[threadId] = entry;
    this.#save(record);
  }

  /** Drops the plan of the thread, when `which` accepts it. False when it had none. */
  cancel(threadId: ThreadId, reason: string, which: (plan: Plan) => boolean = () => true): boolean {
    const record = this.#load();
    const entry = record[threadId];
    const plan = entry?.plan;
    if (entry === undefined || plan === undefined || plan.dispatching || !which(plan)) return false;
    this.#disarm(threadId);
    const { plan: _, ...rest } = entry;
    const recovery = rest.recovery?.turnId === plan.turnId ? { ...rest.recovery, detail: reason } : rest.recovery;
    record[threadId] = { ...rest, handled: plan.turnId, recovery };
    this.#save(record);
    this.log('info', threadId, `The ${what(plan)} of turn ${plan.turnId} is cancelled: ${reason}`, 'cancelled', plan);
    this.#announce(threadId);
    return true;
  }

  cancelAll(reason: string, which: (plan: Plan) => boolean): void {
    if (this.#core.journal.isClosed()) return;
    for (const threadId of Object.keys(this.#load())) this.cancel(threadId, reason, which);
  }

  /**
   * The row of carry-on resumes ends: the thread is back in the user's hands
   * or answered well. The usage window it resumed after stays, so a limit
   * never turns into a loop.
   */
  forget(threadId: ThreadId): void {
    const record = this.#load();
    const entry = record[threadId];
    if (entry === undefined || entry.plan?.dispatching) return;
    if (entry.plan !== undefined) this.#disarm(threadId);
    if (entry.resumedWindow === undefined) delete record[threadId];
    else record[threadId] = { resumedWindow: entry.resumedWindow };
    this.#save(record);
    if (entry.plan !== undefined) this.#announce(threadId);
  }

  /** The thread's latest turn that is not a cache ping. */
  lastTurn(threadId: ThreadId): Turn | null {
    return this.#core.journal.lastTurn(threadId, true);
  }

  log(level: 'info' | 'warn', threadId: ThreadId, message: string, event: string, plan: Plan | null = null, extra: Record<string, string> = {}, reason: PlannedReason | undefined = plan?.reason): void {
    try {
      this.#core.logs.record(level, message, {
        source: 'turns', event: `${reason === 'limit' ? 'limit-resume' : 'auto-continue'}.${event}`, threadId, ...(plan ? { turnId: plan.turnId } : {}),
        data: { ...extra, ...(plan ? { reason: plan.reason, at: plan.at, ...(plan.resetsAt !== undefined ? { resetsAt: plan.resetsAt } : {}), ...(plan.selection ? { providerId: plan.selection.providerId } : {}) } : {}) },
      });
    } catch { /* the plan stands without its record */ }
  }

  #arm(threadId: ThreadId, delayMs: number): void {
    this.#disarm(threadId);
    if (this.#closed) return;
    // A timer longer than 2^31 - 1 ms fires at once: a far plan is checked again on the way.
    const timer = setTimeout(() => {
      this.#timers.delete(threadId);
      this.#fire(threadId);
    }, Math.max(0, Math.min(delayMs, 2_000_000_000)));
    timer.unref?.();
    this.#timers.set(threadId, timer);
  }

  #disarm(threadId: ThreadId): void {
    const timer = this.#timers.get(threadId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#timers.delete(threadId);
  }

  #fire(threadId: ThreadId, expected?: Plan): void {
    if (this.#closed || this.#core.stopping || this.#core.journal.isClosed()) return;
    const record = this.#load();
    const entry = record[threadId];
    const plan = entry?.plan;
    if (entry === undefined || plan === undefined || plan.dispatching || (expected !== undefined && plan !== expected)) return;
    if (plan.at > Date.now() + 1_000) { this.#arm(threadId, plan.at - Date.now()); return; }
    // A cache ping holds the thread only to keep it warm: it gives way, and the resume goes once it stopped.
    if (this.threads.cacheKeepalive.yieldTo(threadId)) { this.#arm(threadId, PING_YIELD_MS); return; }
    const thread = this.#core.journal.getThread(threadId);
    if (thread === null) { this.cancel(threadId, 'the thread is gone'); return; }
    const refusal = this.#refusal(thread, plan);
    if (refusal !== null) { this.cancel(threadId, refusal); return; }
    const version = this.#core.providers.pendingVersion(thread.providerId);
    if (version !== undefined) {
      const retry = (): void => this.#fire(threadId, plan);
      void version.then(retry, retry);
      return;
    }
    record[threadId] = { ...entry, plan: { ...plan, dispatching: true } };
    this.#save(record);
    let sent: TurnId | null = null;
    let failure: string | undefined;
    try {
      // The request id makes the resume one turn whatever happens: a second call returns the first.
      const limit = plan.reason === 'limit';
      const source = this.#core.journal.getTurn(plan.turnId);
      const input = source ? this.threads.handoff.continuation(source, plan.prompt) : { prompt: plan.prompt };
      const turn = this.threads.startTurn(threadId, { ...input, display: RESUME_TEXT[plan.reason].label },
        { kind: 'resume', reason: limit ? 'limit' : 'carry-on', requestId: requestId(plan.turnId, limit) });
      sent = turn.id;
      this.log('info', threadId, `Turn ${turn.id} resumes the thread after turn ${plan.turnId} stopped (${plan.reason})`, 'started', plan);
    } catch (error) {
      failure = messageOf(error);
      this.log('warn', threadId, `The ${what(plan)} of turn ${plan.turnId} could not start: ${failure}`, 'failed', plan);
    } finally {
      const after = this.#load();
      const updated = settled(after[threadId] ?? entry, plan, sent);
      if (failure && updated.recovery?.turnId === plan.turnId) updated.recovery = { ...updated.recovery, detail: failure };
      after[threadId] = updated;
      this.#save(after);
      this.#announce(threadId);
    }
  }

  /** Why the plan must not go out now, or null. */
  #refusal(thread: ThreadSummary, plan: Plan): string | null {
    const threadId = thread.id;
    const limit = plan.reason === 'limit';
    if (limit && this.#core.settings.get().autoResumeLimitedThreads !== true) return 'automatic resume was turned off';
    if (thread.archived) return 'the thread was archived';
    if (this.threads.isBusy(threadId)) return 'the thread is busy';
    if (this.lastTurn(threadId)?.id !== plan.turnId) return 'the thread was answered since';
    if (limit && this.#core.journal.getTurn(plan.turnId)?.status !== 'error') return 'the turn is no longer the failed one';
    const selection = plan.selection;
    if (selection && (thread.providerId !== selection.providerId || thread.accountId !== selection.accountId || thread.model !== selection.model || (thread.sessionGeneration ?? 0) !== selection.sessionGeneration)) {
      return "the thread's provider, account or model changed";
    }
    if (this.threads.cards.listPermissions(threadId).length > 0 || this.threads.cards.listQuestions(threadId).some(question => !question.async)) return 'a card waits for the user';
    const team = this.#core.delegation.config(threadId);
    // A team the user paused or stopped is his to restart; one a crash held is the agent's to resume.
    if (team.paused && (team.pausedBy === undefined || team.pausedBy === 'owner' || team.pausedBy === 'stop')) return 'the user paused its subagent team';
    return null;
  }

  /** A turn of the user's, or any other, opened on the thread: the resume is no longer the next thing. */
  #turnStarted(turn: Turn): void {
    // A cache ping answers nothing (`cache-keepalive.ts`).
    if (turn.execution?.operation === 'keepalive') return;
    const entry = this.#load()[turn.threadId];
    if (entry === undefined) return;
    if (entry.plan !== undefined && !entry.plan.dispatching) this.cancel(turn.threadId, 'the thread was answered since');
    // The user's own words end the row: whatever stops next is a new problem.
    if (turn.execution?.operation === undefined) this.forget(turn.threadId);
    else if (entry.recovery && !entry.plan?.dispatching) {
      const current = this.#load();
      current[turn.threadId] = { ...current[turn.threadId], recovery: undefined };
      this.#save(current);
    }
  }

  /** A copy of the record: read from the journal once, then kept, since every thread row asks for it. */
  #load(): Record_ {
    if (this.#cached === null) {
      if (this.#core.journal.isClosed()) return {};
      this.#cached = this.#read();
    }
    return { ...this.#cached };
  }

  /** The record, with the two legacy records merged into it once and removed. */
  #read(): Record_ {
    const journal = this.#core.journal;
    const own = asRecord(journal.getSetting(KEY));
    const limits = asRecord(journal.getSetting(LEGACY_LIMIT_KEY));
    const carryOns = asRecord(journal.getSetting(LEGACY_CARRY_ON_KEY));
    if (Object.keys(limits).length === 0 && Object.keys(carryOns).length === 0) return own;
    const merged: Record_ = { ...own };
    for (const [threadId, legacy] of Object.entries(carryOns) as [ThreadId, Entry & { plan?: Plan & { reason: PlannedReason } }][]) {
      merged[threadId] = { ...legacy, ...merged[threadId] };
    }
    for (const [threadId, legacy] of Object.entries(limits) as [ThreadId, LegacyLimitEntry][]) {
      const entry: Entry = { ...merged[threadId], ...(legacy.resumedWindow !== undefined ? { resumedWindow: legacy.resumedWindow } : {}) };
      const old = legacy.plan;
      if (old !== undefined && entry.plan === undefined) {
        entry.plan = {
          reason: 'limit', turnId: old.turnId, at: old.at, prompt: RESUME_TEXT.limit.prompt, resetsAt: old.resetsAt,
          selection: { providerId: old.providerId, accountId: old.accountId, model: old.model, sessionGeneration: old.sessionGeneration },
          ...(old.dispatching ? { dispatching: true as const } : {}),
        };
      }
      merged[threadId] = entry;
    }
    journal.db.transaction(() => {
      if (Object.keys(merged).length === 0) journal.deleteSetting(KEY);
      else journal.setSetting(KEY, merged);
      journal.deleteSetting(LEGACY_LIMIT_KEY);
      journal.deleteSetting(LEGACY_CARRY_ON_KEY);
    })();
    return merged;
  }

  #save(record: Record_): void {
    if (this.#core.journal.isClosed()) return;
    for (const [threadId, entry] of Object.entries(record)) if (Object.values(entry).every(value => value === undefined)) delete record[threadId];
    if (Object.keys(record).length === 0) this.#core.journal.deleteSetting(KEY);
    else this.#core.journal.setSetting(KEY, record);
    this.#cached = record;
  }

  #announce(threadId: ThreadId): void {
    if (this.#core.journal.isClosed()) return;
    const thread = this.#core.journal.getThread(threadId);
    if (thread !== null) this.#core.bus.emit('thread.updated', withLoad(this.#core, thread));
  }
}

interface LegacyLimitEntry {
  plan?: { turnId: TurnId; resetsAt: number; at: number; providerId: string; accountId: string; model: string | null; sessionGeneration: number; dispatching?: true };
  resumedWindow?: number;
}

function asRecord(value: unknown): Record_ {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record_ : {};
}

function what(plan: Plan): string {
  return plan.reason === 'limit' ? 'usage limit resume' : 'automatic resume';
}

function recoveryForPlan(plan: Plan): ThreadRecovery {
  return plan.reason === 'limit'
    ? { kind: 'usage-limit', turnId: plan.turnId, resetsAt: plan.resetsAt ?? null }
    : { kind: 'interrupted', turnId: plan.turnId };
}

function requestId(turnId: TurnId, limit: boolean): string {
  return `${limit ? 'limit-resume' : 'auto-continue'}_${turnId}`;
}

function manualRequestId(turnId: TurnId): string { return `manual-resume_${turnId}`; }

/**
 * The row once `plan` went out, failed to or may have: the turn is handled, a
 * usage limit's window is spent, and a carry-on resume `sent` counts in the
 * row of resumes.
 */
function settled(entry: Entry, plan: Plan, sent: TurnId | null | false): Entry {
  const { plan: _, ...rest } = entry;
  if (sent && rest.recovery?.turnId === plan.turnId) delete rest.recovery;
  if (plan.reason === 'limit') return { ...rest, handled: plan.turnId, ...(plan.resetsAt !== undefined ? { resumedWindow: plan.resetsAt } : {}) };
  return { ...rest, handled: plan.turnId, streak: (rest.streak ?? 0) + (sent ? 1 : 0), ...(sent ? { resumeTurnId: sent } : {}) };
}
