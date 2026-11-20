import { ATTACHMENTS_PER_TURN, ATTACHMENTS_TOTAL_MAX_BYTES, decodedBytes, type Attachment, type RpcEventName, type RpcEvents, type ThreadId, type ThreadSummary, type Turn, type TurnId } from '@boite/contracts';
import { messageExcerpt } from '../continuation.ts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { waitForVersion } from '../providers/versions.ts';
import type { ThreadStore } from '../threads.ts';
import { RESUME_TEXT } from './resume-text.ts';
import type { TurnInput } from './turn-origin.ts';
import { STOP_DEADLINE } from './turn-runner.ts';

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
/** The request of the interrupted turn is quoted up to this many characters. */
const QUOTE_LIMIT = 8_000;

interface Entry { turnId: TurnId; threadId: ThreadId; was: 'running' | 'queued'; admittedTurnId?: TurnId }
interface HandoffRecord { at: number; turns: Entry[] }

function isRecord(value: unknown): value is HandoffRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<HandoffRecord>;
  return typeof record.at === 'number' && Array.isArray(record.turns) && record.turns.every(entry =>
    typeof entry?.turnId === 'string' && typeof entry.threadId === 'string' && (entry.was === 'running' || entry.was === 'queued')
    && (entry.admittedTurnId === undefined || typeof entry.admittedTurnId === 'string'));
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
  #entries: Map<TurnId, Entry> | null = null;
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

  /** Whether this handoff resumes that turn on the next core itself. */
  carries(turnId: TurnId): boolean {
    return this.#entries?.has(turnId) ?? false;
  }

  /** A queued turn this handoff carries to the next core stays queued through shutdown. */
  keepsQueued(turnId: TurnId): boolean {
    return this.#entries?.get(turnId)?.was === 'queued' || this.inheritedTurns().get(turnId) === 'queued';
  }

  /** The user stopped the thread himself: that turn is his to send again. */
  forget(threadId: ThreadId): boolean {
    let changed = false;
    for (const entry of this.#entries?.values() ?? []) {
      if (entry.threadId === threadId) changed = this.#entries!.delete(entry.turnId) || changed;
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
      this.#pending.set(run.turnId, run.threadId);
      if (this.#resumable(run.turnId, run.threadId, 'running')) this.#entries.set(run.turnId, { turnId: run.turnId, threadId: run.threadId, was: 'running' });
    }
    for (const waiting of state.queued) {
      if (waiting.queueHold) continue;
      if (this.#resumable(waiting.turnId, waiting.threadId, 'queued')) this.#entries.set(waiting.turnId, { turnId: waiting.turnId, threadId: waiting.threadId, was: 'queued' });
    }
    this.#save();
    this.#core.log('info', `restart handoff: ${this.#pending.size} running and ${state.queued.length} queued turns, ${this.#entries.size} of them resume on the next start`);

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

  /** Whether a queued turn of the previous core can go back in line as it is. */
  requeues(turn: Turn): boolean {
    return turn.status === 'queued' && !turn.queueHold && this.inheritedTurns().get(turn.id) === 'queued' && this.#resumable(turn.id, turn.threadId, 'queued');
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
      if (turn === null || thread === null || !this.#resumable(turn.id, thread.id, admitted === null ? entry.was : 'queued')) {
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
          // The core may have stopped after committing a new turn, before observing its start.
          if (this.#core.journal.lastTurn(thread.id, true)?.id !== turn.id) {
            this.#consume(entry);
            continue;
          }
          const read = this.#core.providers.pendingVersion(thread.providerId);
          if (waitForVersion(read, this.#versionReads, () => this.resume())) continue;
          const continuation = this.#threads.startTurn(thread.id, this.continuation(turn), { kind: 'resume', reason: 'handoff', requestId: this.#requestId(entry) });
          this.#remember(entry, continuation.id);
          resumed += 1;
        } else this.#consume(entry);
      } catch (error) {
        // Admission commits before scheduler dispatch. A crash or exception in
        // that dispatch still has one durable request-to-turn identity.
        const accepted = this.#admitted(entry);
        if (accepted !== null) this.#remember(entry, accepted);
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
    const start = '<interrupted-user-messages>\n';
    const end = '\n</interrupted-user-messages>';
    const kept = previous?.includes(start) && previous.endsWith(end) ? previous.slice(previous.indexOf(start) + start.length, -end.length) : previous;
    const text = [kept, ...requests.map(message => messageExcerpt(message).trim())].filter(Boolean).join('\n\n');
    const half = QUOTE_LIMIT / 2;
    const quoted = text.length > QUOTE_LIMIT ? `${text.slice(0, half)}\n[cut by Boite at ${QUOTE_LIMIT} characters]\n${text.slice(-half)}` : text;
    const prompt = !quoted ? lead : `${lead}\n\nThe request that turn was answering, as conversation history:\n\n${start}${quoted}${end}`;
    const thread = journal.getThread(turn.threadId);
    const attachments: Attachment[] = [];
    // A fresh session reads these messages through conversation history.
    if (!thread?.sessionId) return { prompt };
    const images = this.#core.providers.require(thread.providerId).capabilities.images;
    let room = ATTACHMENTS_TOTAL_MAX_BYTES;
    for (const message of (opening ? [opening, ...requests] : requests).toReversed()) {
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
    return { prompt, attachments };
  }

  /**
   * Sub-threads belong to delegation and workflows, which carry their own
   * work across a handoff (`Delegation.resumeAfterRestart`,
   * `Workflows.resumeAfterRestart`) and
   * pause after a crash. A compaction or a coordination wake is not worth repeating.
   */
  #resumable(turnId: TurnId, threadId: ThreadId, was: Entry['was']): boolean {
    const turn = this.#core.journal.getTurn(turnId);
    const thread: ThreadSummary | null = this.#core.journal.getThread(threadId);
    if (turn === null || thread === null || thread.archived || thread.parentThreadId) return false;
    const operation = turn.execution?.operation;
    return operation === undefined || operation === 'resume' || (was === 'running' && operation === 'background');
  }

  #stopWhenBetweenTools(turnId: TurnId, threadId: ThreadId): void {
    if (!this.#pending.has(turnId) || (this.#tools.get(threadId)?.size ?? 0) > 0) return;
    this.#stop(turnId, threadId);
  }

  #stop(turnId: TurnId, threadId: ThreadId): void {
    if (this.#asked.has(turnId)) return;
    this.#asked.add(turnId);
    // False when the turn ended in the same tick: its `turn.finished` clears it.
    this.#threads.stopRunning(threadId);
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
    const held = (this.#inherited?.turns ?? []).filter(entry => !this.#entries!.has(this.#admitted(entry) ?? entry.turnId));
    this.#core.journal.setSetting(KEY, { at: Date.now(), turns: [...this.#entries.values(), ...held] } satisfies HandoffRecord);
  }
}
