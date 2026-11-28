import { ATTACHMENTS_PER_TURN, ATTACHMENTS_TOTAL_MAX_BYTES, decodedBytes, type Attachment, type RpcEventName, type RpcEvents, type ThreadId, type ThreadSummary, type Turn, type TurnId, type Usage } from '@boite/contracts';
import { admittedComposerTurn } from '../composer-storage.ts';
import { messageExcerpt } from '../continuation.ts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { waitForVersion } from '../providers/versions.ts';
import type { ThreadStore } from '../threads.ts';
import { RESUME_TEXT } from './resume-text.ts';
import { composerOwnsFollowUp } from './stopped-input.ts';
import type { TurnInput } from './turn-origin.ts';
import { STOP_DEADLINE } from './turn-runner.ts';
import { reportSettlementError, userStopKey, userStopResultKey } from './turn-settlement.ts';

/**
 * `graceMs`: how long a running tool call may take to finish before its turn is
 * stopped anyway. `longToolMs`: a tool call already running this long when the
 * restart starts is not waited for: one that outlasted the grace once rarely
 * ends within it, and two updates of 2026-10-22 each waited the whole 30
 * seconds on such a call (a nine minute script, a polling loop) before cutting
 * it, from `core.handoff.started` to `core.shutdown.started` in the core's log. `maxAgeMs`: past it the next core resumes nothing, so a machine left off
 * for a day does not start paid work by itself. Mutable so a test can shorten them.
 */
export const HANDOFF = { graceMs: 30_000, longToolMs: 30_000, maxAgeMs: 3_600_000 };

/** The journal setting the stopping core leaves for the next one. */
const KEY = 'restart-handoff';
const REQUEST_START = '\n\nThe request that turn was answering, as conversation history:\n\n<interrupted-user-messages>\n';
const REQUEST_END = '\n</interrupted-user-messages>';

export interface HandoffResult {
  usage: Usage | null;
  sessionId?: string;
  cwd?: string;
}

export type QueuedInputOutcome = HandoffResult & (
  | { queuedInputSession: string; queuedInputCompleted?: never }
  // Older cores understand the interruption flag and can still open the handoff.
  | { queuedInputInterrupted: true; queuedInputCompleted?: true }
);

interface Entry {
  turnId: TurnId;
  threadId: ThreadId;
  was: 'running' | 'queued';
  admittedTurnId?: TurnId;
  queuedInput?: QueuedInputOutcome;
}
interface LiveEntry extends Entry { composerOnly?: true }
interface HandoffRecord { at: number; turns: Entry[] }

function readUsage(value: unknown): Usage | null {
  if (typeof value !== 'object' || value === null) return null;
  const usage = value as Partial<Usage>;
  const tokens = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
  if (!tokens.every(Number.isFinite) || (usage.cacheWriteHourTokens !== undefined && !Number.isFinite(usage.cacheWriteHourTokens))
    || (usage.costUsdEquivalent !== null && !Number.isFinite(usage.costUsdEquivalent))
    || (usage.buckets !== undefined && usage.buckets !== 1)) return null;
  return usage as Usage;
}

function readHandoffResult(value: unknown): HandoffResult | undefined {
  if (typeof value !== 'object' || value === null) return;
  return {
    usage: readUsage('usage' in value ? value.usage : null),
    sessionId: 'sessionId' in value && typeof value.sessionId === 'string' ? value.sessionId
      : 'queuedInputSession' in value && typeof value.queuedInputSession === 'string' ? value.queuedInputSession : undefined,
    cwd: 'cwd' in value && typeof value.cwd === 'string' ? value.cwd : undefined,
  };
}

function readQueuedInputOutcome(value: unknown): QueuedInputOutcome | undefined {
  if (typeof value !== 'object' || value === null) return;
  const metadata = readHandoffResult(value)!;
  if ('queuedInputSession' in value && typeof value.queuedInputSession === 'string') return { ...metadata, queuedInputSession: value.queuedInputSession };
  if ('queuedInputInterrupted' in value && value.queuedInputInterrupted === true) {
    return {
      ...metadata,
      queuedInputInterrupted: true,
      queuedInputCompleted: 'queuedInputCompleted' in value && value.queuedInputCompleted === true ? true : undefined,
    };
  }
}

function isRecord(value: unknown): value is HandoffRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<HandoffRecord>;
  return typeof record.at === 'number' && Array.isArray(record.turns) && record.turns.every(entry =>
    typeof entry?.turnId === 'string' && typeof entry.threadId === 'string' && (entry.was === 'running' || entry.was === 'queued')
    && (entry.admittedTurnId === undefined || typeof entry.admittedTurnId === 'string')
    && (entry.queuedInput === undefined || (entry.was === 'running' && readQueuedInputOutcome(entry.queuedInput) !== undefined)));
}

/**
 * A restart that hands its turns to the next core instead of waiting for every
 * thread to finish. The stopping core lets each running turn end the tool call
 * it is in, `HANDOFF.graceMs` at most, stops it, and records which turns it cut.
 * The next core opens a `resume` turn on each of those threads and puts the
 * queued ones back in line.
 *
 * The record is written before anything is stopped, so a core killed during
 * the wait still hands its turns over.
 */
export class RestartHandoff {
  /** Tool calls in flight per thread, as `messageId:partIndex`, with when each started. */
  readonly #tools = new Map<ThreadId, Map<string, number>>();
  /** What this core hands over, once `begin` ran. */
  #entries: Map<TurnId, LiveEntry> | null = null;
  /** The composer owns the follow-up while the runner still owns the terminal write. */
  readonly #queuedInputOutcomes = new Map<TurnId, QueuedInputOutcome>();
  /** Running turns still to end before this core may exit. */
  readonly #pending = new Map<TurnId, ThreadId>();
  readonly #asked = new Set<TurnId>();
  #finished: Promise<void> | null = null;
  #settle: (() => void) | null = null;
  /** Each inherited entry stays durable until its continuation starts or is explicitly excluded. */
  #inherited: HandoffRecord | null = null;
  readonly #versionReads = new Set<Promise<void>>();
  /**
   * The previous core stopped through a handoff this core carries on, rather
   * than dying: what delegation and workflows cut then resumes too.
   */
  readonly handedOver: boolean;

  readonly #core: Core;
  readonly #threads: ThreadStore;

  constructor(core: Core, threads: ThreadStore) {
    this.#core = core; this.#threads = threads;
    const stored = core.journal.getSetting(KEY);
    if (stored !== undefined && stored !== null) {
      if (isRecord(stored) && Date.now() - stored.at <= HANDOFF.maxAgeMs) this.#inherited = stored;
      else {
        core.journal.deleteSetting(KEY);
        core.log('warn', 'the restart handoff left by the previous core is older than an hour or unreadable: nothing resumes');
      }
    }
    this.handedOver = this.#inherited !== null;
    core.bus.onAny((name, payload) => this.#observe(name, payload));
    if (this.handedOver) core.bus.onCommitted((name, payload) => {
      if (name === 'turn.started') this.#turnStarted(payload as RpcEvents['turn.started']);
    });
  }

  get active(): boolean { return this.#entries !== null; }

  /** The tool calls of this thread's turn still running. An agent update pauses a turn at zero too. */
  toolsRunning(threadId: ThreadId): number {
    return this.#tools.get(threadId)?.size ?? 0;
  }

  /** A turn paused in place starts its next attempt with no tool call open, whatever the stopped one left. */
  forgetTools(threadId: ThreadId): void {
    this.#tools.delete(threadId);
  }

  /** Whether the handoff record carries this turn to the next core. */
  carries(turnId: TurnId): boolean {
    const entry = this.#entries?.get(turnId);
    return entry !== undefined && (!entry.composerOnly || entry.queuedInput !== undefined);
  }

  /** A queued turn this handoff carries to the next core stays queued through shutdown. */
  keepsQueued(turnId: TurnId): boolean {
    return this.#entries?.get(turnId)?.was === 'queued' || this.inheritedTurns().get(turnId) === 'queued';
  }

  /** Keep the composer in charge of the follow-up if settlement cannot commit in time. */
  recordQueuedInputOutcome(turnId: TurnId, outcome: QueuedInputOutcome): void {
    this.#queuedInputOutcomes.set(turnId, outcome);
    this.#saveQueuedInputOutcome(turnId, outcome);
  }

  releaseQueuedInputOutcome(turnId: TurnId): void {
    const outcome = this.#queuedInputOutcomes.get(turnId);
    // Retry a failed handoff write before dropping the outcome from memory.
    if (outcome !== undefined) this.#saveQueuedInputOutcome(turnId, outcome);
    this.#queuedInputOutcomes.delete(turnId);
  }

  /** Cancel the continuation while preserving a known result's session and accounting. */
  recordUserStop(turnId: TurnId): void {
    const { journal } = this.#core;
    const outcome = this.#queuedInputOutcomes.get(turnId) ?? this.#entries?.get(turnId)?.queuedInput;
    journal.db.transaction(() => {
      journal.setSetting(userStopKey(turnId), true);
      if (outcome) journal.setSetting(userStopResultKey(turnId), outcome);
    })();
  }

  /** A provider may send its session and usage after the user already stopped the turn. */
  recordStoppedResult(turn: Turn, result: HandoffResult): void {
    const { journal } = this.#core;
    if (journal.isClosed() || (result.sessionId === undefined && result.usage === null)) return;
    try {
      if (journal.getSetting(userStopKey(turn.id)) === true) journal.setSetting(userStopResultKey(turn.id), result);
    } catch (error) {
      reportSettlementError(this.#core, turn.threadId, turn.id, 'user stop result', error);
    }
  }

  stoppedResult(turnId: TurnId): HandoffResult | undefined {
    return readHandoffResult(this.#core.journal.getSetting(userStopResultKey(turnId)))
      ?? this.inheritedQueuedInputOutcome(turnId);
  }

  #saveQueuedInputOutcome(turnId: TurnId, outcome: QueuedInputOutcome): void {
    const entry = this.#entries?.get(turnId);
    if (entry?.was !== 'running' || entry.queuedInput === outcome || this.#core.journal.isClosed()) return;
    entry.queuedInput = outcome;
    try { this.#save(); }
    catch (error) {
      delete entry.queuedInput;
      reportSettlementError(this.#core, entry.threadId, turnId, 'restart handoff queued input', error);
    }
  }

  /** The user stopped the thread himself: that turn is his to send again. */
  forget(threadId: ThreadId): boolean {
    let changed = false;
    for (const entry of this.#entries?.values() ?? []) {
      if (entry.threadId !== threadId) continue;
      changed = this.carries(entry.turnId) || changed;
      this.#entries!.delete(entry.turnId);
    }
    if (this.#inherited !== null) {
      const remaining = this.#inherited.turns.filter(entry => entry.threadId !== threadId);
      changed = remaining.length !== this.#inherited.turns.length || changed;
      this.#inherited.turns = remaining;
    }
    if (changed) {
      if (this.#entries !== null) this.#save();
      else this.#saveInherited();
    }
    return changed;
  }

  /**
   * Records what runs and what waits, then stops each running turn as soon as
   * it is between two tool calls, or at the deadline. Resolves once every one
   * of them ended.
   */
  begin(graceMs: number = HANDOFF.graceMs): Promise<void> {
    if (this.#finished !== null) return this.#finished;
    const state = this.#core.scheduler.state();
    this.#entries = new Map();
    for (const run of state.running) {
      // Post-turn work can hold the scheduler slot after the turn has settled.
      if (this.#core.journal.getTurn(run.turnId)?.status !== 'running') continue;
      this.#pending.set(run.turnId, run.threadId);
      const mode = this.#handoffMode(run.turnId, run.threadId, 'running');
      if (mode !== null) {
        const queuedInput = this.#queuedInputOutcomes.get(run.turnId);
        this.#entries.set(run.turnId, { turnId: run.turnId, threadId: run.threadId, was: 'running', queuedInput, composerOnly: mode === 'composer' ? true : undefined });
      }
    }
    for (const waiting of state.queued) {
      if (waiting.queueHold) continue;
      if (this.#handoffMode(waiting.turnId, waiting.threadId, 'queued') === 'resume') this.#entries.set(waiting.turnId, { turnId: waiting.turnId, threadId: waiting.threadId, was: 'queued' });
    }
    this.#save();
    const carried = [...this.#entries.keys()].filter(turnId => this.carries(turnId)).length;
    this.#core.log('info', `restart handoff: ${this.#pending.size} running and ${state.queued.length} queued turns, ${carried} carried to the next start`);

    const { promise, resolve } = Promise.withResolvers<void>();
    this.#finished = promise;
    if (this.#pending.size === 0) {
      resolve();
      return promise;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    this.#settle = () => {
      for (const timer of timers) clearTimeout(timer);
      this.#settle = null;
      resolve();
    };
    // Past the grace every turn is stopped where it stands.
    timers.push(setTimeout(() => {
      for (const [turnId, threadId] of this.#pending) this.#stop(turnId, threadId);
    }, graceMs));
    // A stop the runner could not settle either must not hold the restart.
    timers.push(setTimeout(() => this.#settle?.(), graceMs + STOP_DEADLINE.ms + STOP_DEADLINE.forceMs + 1_000));
    for (const timer of timers) timer.unref?.();
    const now = Date.now();
    for (const [turnId, threadId] of this.#pending) {
      const running = [...this.#tools.get(threadId)?.values() ?? []];
      if (running.length > 0 && running.every(startedAt => now - startedAt >= HANDOFF.longToolMs)) this.#stop(turnId, threadId);
      else this.#stopWhenBetweenTools(turnId, threadId);
    }
    return promise;
  }

  /** The turns of the previous core that the recovery leaves alone or closes without an error. */
  inheritedTurns(): Map<TurnId, Entry['was']> {
    return new Map((this.#inherited?.turns ?? []).map(entry => {
      const admitted = this.#admitted(entry);
      return [admitted ?? entry.turnId, admitted === null ? entry.was : 'queued'];
    }));
  }

  inheritedQueuedInputOutcome(turnId: TurnId): QueuedInputOutcome | undefined {
    return readQueuedInputOutcome(this.#inherited?.turns.find(entry => entry.turnId === turnId)?.queuedInput);
  }

  /** Whether a queued turn of the previous core can go back in line as it is. */
  requeues(turn: Turn): boolean {
    return turn.status === 'queued' && !turn.queueHold && this.inheritedTurns().get(turn.id) === 'queued'
      && this.#handoffMode(turn.id, turn.threadId, 'queued') === 'resume';
  }

  /**
   * Once the server listens: the queued turns go back in line and each thread
   * whose turn was cut gets a `resume` turn. Returns how many started.
   */
  resume(): number {
    const record = this.#inherited;
    if (record === null || this.#core.stopping || this.#core.journal.isClosed()) return 0;
    if (record.turns.length === 0) { this.#saveInherited(); return 0; }
    let resumed = 0;
    for (const entry of [...record.turns]) {
      // Admission events can synchronously stop another inherited thread.
      if (!this.#inherited?.turns.includes(entry) || this.#core.stopping) continue;
      const admitted = this.#admitted(entry);
      const turn = this.#core.journal.getTurn(admitted ?? entry.turnId);
      const thread = this.#core.journal.getThread(entry.threadId);
      if (turn === null || thread === null || this.#handoffMode(turn.id, thread.id, admitted === null ? entry.was : 'queued') !== 'resume') {
        this.#consume(entry);
        continue;
      }
      try {
        if (turn.status === 'queued') {
          const state = this.#core.scheduler.state();
          if ([...state.queued, ...state.running].some(item => item.turnId === turn.id)) continue;
          this.#core.scheduler.enqueue(turn, turn.execution?.accountId ?? thread.accountId, { recovering: true });
          resumed += 1;
        } else if (admitted === null && entry.was === 'running' && turn.status === 'stopped') {
          // The planned turn may have handed over to the composer, or a newer turn may already be committed.
          if (composerOwnsFollowUp(turn)
            || this.#core.journal.lastTurn(thread.id, true)?.id !== turn.id) {
            this.#consume(entry);
            continue;
          }
          const read = this.#core.providers.pendingVersion(thread.providerId);
          if (waitForVersion(read, this.#versionReads, () => this.resume())) continue;
          const continuation = this.#threads.startTurn(thread.id, this.continuation(turn), {
            kind: 'resume', reason: 'handoff', requestId: this.#requestId(entry),
          });
          this.#remember(entry, continuation.id);
          resumed += 1;
        } else this.#consume(entry);
      } catch (error) {
        // Admission commits before scheduler dispatch. A crash or exception in
        // that dispatch still has one durable request-to-turn identity.
        const accepted = this.#admitted(entry);
        if (accepted !== null) this.#remember(entry, accepted);
        else if (entry.was === 'running') this.#threads.resumes.offer(turn, { kind: 'interrupted', detail: messageOf(error) });
        this.#core.log('warn', `thread ${thread.id} was not resumed after the restart: ${messageOf(error)}`);
      }
    }
    if (resumed > 0) this.#core.log('info', `restart handoff: resumed ${resumed} threads`);
    return resumed;
  }

  #requestId(entry: Entry): string { return `restart_${entry.turnId}`; }

  #admitted(entry: Entry): TurnId | null {
    return entry.admittedTurnId ?? (entry.was === 'running' ? this.#core.journal.turnRequest(entry.threadId, this.#requestId(entry))?.turn_id : undefined) ?? null;
  }

  #remember(entry: Entry, turnId: TurnId): void {
    if (!this.#inherited?.turns.includes(entry)) return;
    entry.admittedTurnId = turnId;
    this.#saveInherited();
  }

  #consume(entry: Entry): void {
    if (!this.#inherited?.turns.includes(entry)) return;
    this.#inherited.turns = this.#inherited.turns.filter(item => item !== entry);
    this.#saveInherited();
  }

  #saveInherited(): void {
    if (this.#core.journal.isClosed()) return;
    if (this.#entries !== null) { this.#save(); return; }
    if (this.#inherited?.turns.length) this.#core.journal.setSetting(KEY, this.#inherited);
    else {
      this.#inherited = null;
      this.#core.journal.deleteSetting(KEY);
    }
  }

  /**
   * The cut turn's own request goes along: a turn stopped in its first second
   * may never have reached the agent's session. Delegation and workflows
   * continue the children a handoff cut with it too, and a crash resume
   * (`threads/auto-continue.ts`) leads with its own reason.
   */
  continuation(turn: Turn, lead: string = RESUME_TEXT.handoff.prompt): TurnInput {
    const journal = this.#core.journal;
    const messages = [...journal.walkTurnMessages(turn.threadId, turn.id, { blobs: false })];
    const opening = turn.execution?.operation === 'resume' ? messages.find(message => message.role === 'system') : undefined;
    const requests = messages.filter(message => message.role === 'user');
    const previous = opening?.parts.find(part => part.type === 'text')?.text;
    const kept = previous?.includes(REQUEST_START) && previous.endsWith(REQUEST_END)
      ? previous.slice(previous.indexOf(REQUEST_START) + REQUEST_START.length, -REQUEST_END.length)
      : previous;
    // Unlike old history, the active request must keep every requirement and
    // in-turn correction. The source is already stored without attachment blobs.
    const text = [kept, ...requests.map(message => message.parts.map(part =>
      part.type === 'text' ? part.text : messageExcerpt({ ...message, parts: [part] }),
    ).filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
    const activity = this.#core.activity.get(turn.threadId);
    const tasks = activity.tasksDismissed ? [] : activity.tasks;
    const checklist = tasks.length
      ? `\n\nThe thread's task list at resume:\n${tasks.map(task => `- [${task.status}] ${task.text}`).join('\n')}`
      : '';
    const prompt = `${lead}${checklist}${text ? `${REQUEST_START}${text}${REQUEST_END}` : ''}`;
    const resumeSourceTurnId = turn.status === 'done' ? undefined
      : turn.execution?.resumeSourceTurnId ?? (turn.execution?.operation === undefined ? turn.id : undefined);
    const input: TurnInput = { prompt, ...(resumeSourceTurnId === undefined ? {} : { resumeSourceTurnId }) };
    const thread = journal.getThread(turn.threadId);
    const attachments: Attachment[] = [];
    // A fresh session reads these messages through conversation history.
    if (!thread?.sessionId) return input;
    const attachmentMessages = opening ? [opening, ...requests] : requests;
    // The previous resume may have loaded its attachments from history when it opened a fresh session.
    if (resumeSourceTurnId !== undefined && opening && !opening.parts.some(part => part.type === 'file' || part.type === 'image')) {
      const original = [...journal.walkTurnMessages(turn.threadId, resumeSourceTurnId, { blobs: false })];
      attachmentMessages.unshift(...original.filter(message => message.role === 'user'));
    }
    const images = this.#core.providers.require(thread.providerId).capabilities.images;
    let room = ATTACHMENTS_TOTAL_MAX_BYTES;
    for (const message of attachmentMessages.toReversed()) {
      for (let index = message.parts.length - 1; index >= 0 && attachments.length < ATTACHMENTS_PER_TURN; index--) {
        const stored = message.parts[index]!;
        if (stored.type !== 'file' && !(stored.type === 'image' && images)) continue;
        const part = journal.messagePart(message.id, index)?.part;
        if (part?.type !== 'file' && part?.type !== 'image') continue;
        const bytes = decodedBytes(part.data);
        if (bytes > room) continue;
        room -= bytes;
        attachments.unshift(part.type === 'image'
          ? { kind: 'image', mimeType: part.mimeType, data: part.data, name: part.alt }
          : { kind: 'file', mimeType: part.mimeType, data: part.data, name: part.name });
      }
    }
    return { ...input, attachments };
  }

  /**
   * Sub-threads belong to delegation and workflows, which carry their own
   * work across a handoff (`Delegation.resumeAfterRestart`,
   * `Workflows.resumeAfterRestart`) and
   * pause after a crash. Carry a child's queued-input outcome only so the
   * composer can recover it. A compaction or coordination wake stays behind.
   */
  #handoffMode(turnId: TurnId, threadId: ThreadId, was: Entry['was']): 'resume' | 'composer' | null {
    const turn = this.#core.journal.getTurn(turnId);
    const thread: ThreadSummary | null = this.#core.journal.getThread(threadId);
    if (turn === null || thread === null || thread.archived) return null;
    if (was === 'running' && this.#core.journal.getSetting(userStopKey(turnId)) === true) return null;
    const operation = turn.execution?.operation;
    if (thread.parentThreadId) {
      if (operation !== undefined) return null;
      if (was === 'running') return 'composer';
      return admittedComposerTurn(this.#core, threadId, turnId) ? 'resume' : null;
    }
    return operation === undefined || operation === 'resume' || (was === 'running' && operation === 'background') ? 'resume' : null;
  }

  #stopWhenBetweenTools(turnId: TurnId, threadId: ThreadId): void {
    if (!this.#pending.has(turnId) || (this.#tools.get(threadId)?.size ?? 0) > 0) return;
    this.#stop(turnId, threadId);
  }

  #stop(turnId: TurnId, threadId: ThreadId): void {
    if (this.#asked.has(turnId)) return;
    this.#asked.add(turnId);
    // False when the turn ended in the same tick: its `turn.finished` clears it.
    this.#threads.stopRunning(threadId, 'restart');
  }

  #turnStarted(turn: Turn): void {
    if (this.#inherited === null || this.#entries !== null || turn.execution?.operation === 'keepalive') return;
    for (const entry of this.#inherited.turns) {
      if (entry.threadId !== turn.threadId) continue;
      const admitted = this.#admitted(entry);
      if ((admitted ?? entry.turnId) === turn.id || (admitted === null && entry.was === 'running')) this.#consume(entry);
    }
  }

  #observe(name: RpcEventName, payload: unknown): void {
    if (name === 'message.part') {
      const { threadId, messageId, partIndex, part } = payload as RpcEvents['message.part'];
      if (part.type !== 'tool') return;
      const key = `${messageId}:${partIndex}`;
      const running = this.#tools.get(threadId) ?? new Map<string, number>();
      if (part.status !== 'running') running.delete(key);
      else if (!running.has(key)) running.set(key, typeof part.startedAt === 'number' ? part.startedAt : Date.now());
      if (running.size > 0) this.#tools.set(threadId, running);
      else this.#tools.delete(threadId);
      if (this.#entries === null || running.size > 0) return;
      for (const [turnId, pendingThread] of this.#pending) if (pendingThread === threadId) this.#stopWhenBetweenTools(turnId, threadId);
      return;
    }
    if (name !== 'turn.finished') return;
    const turn = payload as RpcEvents['turn.finished'];
    this.#tools.delete(turn.threadId);
    if (this.#entries === null) return;
    // Done or failed during the grace: nothing is left to resume.
    if (turn.status !== 'stopped' && this.#entries.delete(turn.id)) this.#save();
    if (this.#pending.delete(turn.id) && this.#pending.size === 0) this.#settle?.();
  }

  #save(): void {
    if (this.#entries === null || this.#core.journal.isClosed()) return;
    const turns = [...this.#entries.values()].filter(entry => this.carries(entry.turnId)).map(({ composerOnly, ...entry }) => entry);
    const held = (this.#inherited?.turns ?? []).filter(entry => !this.carries(this.#admitted(entry) ?? entry.turnId));
    this.#core.journal.setSetting(KEY, { at: Date.now(), turns: [...turns, ...held] } satisfies HandoffRecord);
  }
}
