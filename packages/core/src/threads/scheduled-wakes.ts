import type { MessagePart, RpcEvents, ThreadId, ThreadSummary, ThreadWake, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { isAgentHeld } from '../agents/runtime.ts';
import type { ThreadStore } from '../threads.ts';
import { withLoad } from './records.ts';

/**
 * Mutable so a test can shorten them. `graceMs`: how long past its time, with
 * the thread free, a wake waits for a CLI still alive to fire it by itself.
 * `startDelayMs`: the least a wake waits after a core start.
 */
export const WAKE_TIMING = { graceMs: 30_000, startDelayMs: 3_000 };

/** The tool an agent schedules its own next turn with (Claude Code's dynamic `/loop`). */
export const WAKE_TOOL = 'ScheduleWakeup';
/** The conversation's label for the turn a wake opens. */
export const WAKE_LABEL = 'Scheduled wake';
/** A CLI's own fire and the core's record are the same wake within this much (the CLI rounds up to the minute). */
const SAME_WAKE_MS = 90_000;
/** The journal setting holding every thread's wake. */
const KEY = 'scheduled-wakes';
/** The runtime clamps `delaySeconds` to this range (CLI 2.1.318). */
const DELAY_SECONDS = { min: 60, max: 3_600 };
/** Sentinels the CLI resolves into its loop instructions at fire time; a turn the core opens says it in words. */
const SENTINEL_TEXT: Record<string, string> = {
  '<<autonomous-loop-dynamic>>': 'Your scheduled wake is due: continue the task you were pacing yourself on, and call ScheduleWakeup again if more is left.',
  '<<autonomous-loop>>': 'Your scheduled wake is due: continue the task you were pacing yourself on.',
};

interface Entry {
  /** The last ScheduleWakeup call seen, so a part published again plans nothing twice. */
  toolId: string;
  wake?: ThreadWake;
}

type Record_ = Record<ThreadId, Entry>;

/**
 * The wakes agents schedule for themselves. A ScheduleWakeup call that
 * finished well gives its thread one pending wake, journalled so it survives
 * a restart and an update handoff; a newer call replaces it, `stop: true`,
 * Stop, a pause or an archive cancels it. A Claude CLI still alive fires its
 * own timer, which consumes the wake (`cliFired`); otherwise, once the time
 * passed and the thread was free for `graceMs`, the core opens the turn.
 */
export class ScheduledWakes {
  readonly #timers = new Map<ThreadId, ReturnType<typeof setTimeout>>();
  #closed = false;
  #started = false;
  #cached: Record_ | null = null;

  readonly #core: Core;

  constructor(core: Core, private readonly threads: ThreadStore) {
    this.#core = core;
    core.bus.onCommitted((name, payload) => {
      if (this.#closed) return;
      if (name === 'message.part') this.#part(payload as RpcEvents['message.part']);
      else if (name === 'turn.finished') this.#turnFinished(payload as Turn);
      else if (name === 'thread.updated' && (payload as ThreadSummary).archived) this.cancel((payload as ThreadSummary).id, 'the thread was archived');
    });
  }

  /** Once recovery ran: the wakes a previous core kept are armed again, those of threads that are gone dropped. */
  start(): void {
    this.#started = true;
    const record = this.#load();
    let changed = false;
    for (const [threadId, entry] of Object.entries(record)) {
      const thread = this.#core.journal.getThread(threadId);
      if (thread === null || thread.archived) {
        delete record[threadId];
        changed = true;
        continue;
      }
      // The CLI that armed its own timer died with the previous core: the wake is this core's to fire.
      if (entry.wake) this.#arm(threadId, Math.max(WAKE_TIMING.startDelayMs, entry.wake.at - Date.now()));
    }
    if (changed) this.#save(record);
  }

  close(): void {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  /** The thread's pending wake, a copy; null when none. */
  of(threadId: ThreadId): ThreadWake | null {
    const wake = this.#load()[threadId]?.wake;
    return wake ? { ...wake } : null;
  }

  /** Drops the thread's pending wake. False when it had none. */
  cancel(threadId: ThreadId, reason: string): boolean {
    const record = this.#load();
    const entry = record[threadId];
    if (!entry?.wake) return false;
    this.#disarm(threadId);
    record[threadId] = { toolId: entry.toolId };
    this.#save(record);
    this.#log('info', threadId, `The scheduled wake of turn ${entry.wake.turnId} is cancelled: ${reason}`, 'cancelled', entry.wake);
    this.#announce(threadId);
    return true;
  }

  /**
   * The agent's CLI fired a wake by itself (Claude's `loop_wakeup`). True when
   * it is the pending one, which it consumes; false when that wake was
   * cancelled or replaced since, so the driver drops the CLI's run.
   */
  cliFired(threadId: ThreadId, scheduledFor: number | null): boolean {
    const record = this.#load();
    const entry = record[threadId];
    const wake = entry?.wake;
    if (!wake || (scheduledFor !== null && Math.abs(wake.at - scheduledFor) > SAME_WAKE_MS)) {
      this.#log('info', threadId, 'The agent fired a wake that was cancelled or replaced; its run is dropped', 'dropped', wake ?? null);
      return false;
    }
    this.#disarm(threadId);
    record[threadId] = { toolId: entry.toolId };
    this.#save(record);
    this.#log('info', threadId, `The agent fired the scheduled wake of turn ${wake.turnId} by itself`, 'fired-by-agent', wake);
    this.#announce(threadId);
    return true;
  }

  /** A tool card changed: a ScheduleWakeup that finished well plans, replaces or cancels the thread's wake. */
  #part({ threadId, messageId, part }: RpcEvents['message.part']): void {
    if (part.type !== 'tool' || part.name !== WAKE_TOOL || part.status !== 'done' || this.#core.journal.isClosed()) return;
    const record = this.#load();
    if (record[threadId]?.toolId === part.toolId) return;
    const turnId = this.#core.journal.getMessage(messageId)?.turnId;
    const input = (part.input ?? {}) as { delaySeconds?: unknown; prompt?: unknown; reason?: unknown; stop?: unknown };
    if (turnId === undefined) return;
    if (input.stop === true) {
      const had = record[threadId]?.wake !== undefined;
      if (had) this.cancel(threadId, 'the agent stopped its loop');
      const after = this.#load();
      after[threadId] = { toolId: part.toolId };
      this.#save(after);
      return;
    }
    if (typeof input.prompt !== 'string' || input.prompt.length === 0) return;
    const at = dueAt(part);
    if (at === null) return;
    const wake: ThreadWake = { at, prompt: input.prompt, reason: typeof input.reason === 'string' && input.reason.length > 0 ? input.reason : null, turnId };
    record[threadId] = { toolId: part.toolId, wake };
    this.#save(record);
    this.#arm(threadId, at + WAKE_TIMING.graceMs - Date.now());
    this.#log('info', threadId, `Turn ${turnId} scheduled a wake for ${new Date(at).toISOString()}`, 'planned', wake);
    this.#announce(threadId);
  }

  /** The thread is free again: a wake that came due meanwhile goes once the CLI had its moment. */
  #turnFinished(turn: Turn): void {
    const wake = this.#load()[turn.threadId]?.wake;
    if (wake && wake.at <= Date.now()) this.#arm(turn.threadId, WAKE_TIMING.graceMs);
  }

  #arm(threadId: ThreadId, delayMs: number): void {
    this.#disarm(threadId);
    if (this.#closed || !this.#started) return;
    // A timer longer than 2^31 - 1 ms fires at once: a far wake is checked again on the way.
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

  #fire(threadId: ThreadId): void {
    if (this.#closed || this.#core.stopping || this.#core.journal.isClosed()) return;
    const record = this.#load();
    const entry = record[threadId];
    const wake = entry?.wake;
    if (!entry || !wake) return;
    if (wake.at > Date.now() + 1_000) { this.#arm(threadId, wake.at - Date.now()); return; }
    const thread = this.#core.journal.getThread(threadId);
    if (thread === null || thread.archived) { this.cancel(threadId, 'the thread is gone'); return; }
    // `turn.finished` arms it again once the thread is free.
    if (this.threads.isBusy(threadId)) return;
    // Stop pauses the thread's coordination until the user writes; the owner's pause stays.
    if (this.#core.coordination.config(threadId).paused) { this.cancel(threadId, 'the thread is paused'); return; }
    // Taken off the record first: a core that dies under the start does not send it twice.
    record[threadId] = { toolId: entry.toolId };
    this.#save(record);
    try {
      const turn = this.threads.startTurn(threadId, { prompt: SENTINEL_TEXT[wake.prompt] ?? wake.prompt, display: WAKE_LABEL },
        { kind: 'resume', reason: 'wake', requestId: `wake_${entry.toolId}` });
      this.#log('info', threadId, `Turn ${turn.id} opens the wake turn ${wake.turnId} scheduled`, 'started', wake);
    } catch (error) {
      if (isAgentHeld(error)) {
        // Nothing was queued: the wake stays and goes once the agent is admitted again.
        const back = this.#load();
        if (back[threadId]?.toolId === entry.toolId && !back[threadId]?.wake) { back[threadId] = entry; this.#save(back); }
        this.#core.agentRuntime.whenAdmitted(threadId, 'scheduled-wake', () => this.#fire(threadId));
        this.#log('info', threadId, `The scheduled wake of turn ${wake.turnId} waits for its agent to be admitted`, 'held', wake);
      } else {
        this.#log('warn', threadId, `The scheduled wake of turn ${wake.turnId} could not start: ${messageOf(error)}`, 'failed', wake);
      }
    }
    this.#announce(threadId);
  }

  #log(level: 'info' | 'warn', threadId: ThreadId, message: string, event: string, wake: ThreadWake | null): void {
    try {
      this.#core.logs.record(level, message, {
        source: 'turns', event: `scheduled-wake.${event}`, threadId, ...(wake ? { turnId: wake.turnId } : {}),
        data: wake ? { at: wake.at } : {},
      });
    } catch { /* the wake stands without its record */ }
  }

  #load(): Record_ {
    if (this.#cached === null) {
      if (this.#core.journal.isClosed()) return {};
      const value = this.#core.journal.getSetting(KEY);
      this.#cached = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record_ : {};
    }
    return { ...this.#cached };
  }

  #save(record: Record_): void {
    if (this.#core.journal.isClosed()) return;
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

/**
 * When the wake is due: the CLI's own words ("Next wakeup scheduled for
 * 13:55:00 (in 65s)", CLI 2.1.318) counted from when the call finished, else
 * the requested delay clamped as the runtime clamps it. Null for a call with
 * neither.
 */
function dueAt(part: Extract<MessagePart, { type: 'tool' }>): number | null {
  const base = part.finishedAt ?? Date.now();
  const said = /\(in (\d+)s\)/.exec(part.output ?? '');
  if (said) return base + Number(said[1]) * 1000;
  const delay = (part.input as { delaySeconds?: unknown } | null)?.delaySeconds;
  if (typeof delay !== 'number' || !Number.isFinite(delay)) return null;
  return base + Math.min(DELAY_SECONDS.max, Math.max(DELAY_SECONDS.min, delay)) * 1000;
}
