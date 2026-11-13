import type { AgentDone, Message, SchedulerState, ThreadId } from '@boite/contracts';
import { recordKey } from '../composer-storage.ts';
import type { Core } from '../core.ts';
import { messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import type { ThreadStore } from '../threads.ts';
import { assertIdleFamily } from './completion.ts';

/**
 * `agent.done`: the agent puts its own conversation in Done, usually after
 * Boite asked once its pull requests were merged or closed
 * (`merged-pr-ask.ts`). The agent asks from inside a turn, and Done never
 * lands over a turn at work, so the request waits for that turn's end
 * (`applyWaiting`), then goes through the user's Mark done. Memory only: a
 * restart before the turn ends drops it, and the thread stays open.
 */
export class AgentDoneRequests {
  readonly #waiting = new Set<ThreadId>();
  readonly #core: Core;

  constructor(core: Core, private readonly threads: ThreadStore) {
    this.#core = core;
  }

  request(threadId: ThreadId): AgentDone {
    const thread = this.threads.require(threadId);
    if (thread.parentThreadId) {
      throw refused('a sub-thread is put away with its parent once its work is delivered', { threadId, field: 'threadId', expected: 'a top-level thread' });
    }
    if (thread.agentSessionId) throw refused('a bot\'s thread stays open', { threadId, field: 'threadId', expected: 'a conversation thread' });
    if (thread.archived) throw refused('this thread is already archived', { threadId, field: 'threadId', expected: 'a thread that is not archived' });
    if (this.threads.isBusy(threadId)) {
      this.#waiting.add(threadId);
      return { threadId, when: 'turn-end' };
    }
    // Refused now if anything holds the thread; put away on the next tick, once
    // this answer has left: Done closes the agent's own connection.
    assertIdleFamily(this.#core, threadId, 'explicit');
    this.#assertNoInput(threadId);
    this.#waiting.add(threadId);
    setImmediate(() => this.#settle(threadId));
    return { threadId, when: 'done' };
  }

  /**
   * Called by the turn runner once a turn's end is written, before any wake
   * or held answer starts the next one. A user message queued meanwhile, or
   * background work the agent left running, keeps the thread open with a line
   * saying why.
   */
  applyWaiting(threadId: ThreadId): void {
    if (!this.#waiting.has(threadId)) return;
    // The runner calls this before the scheduler lets go of the turn that
    // ended, and until it has, the thread reads as still at work. Done follows
    // the scheduler's first update without that turn: whatever started next
    // (a held answer, a queued message) then keeps the thread open.
    const ended = this.#core.scheduler.state().running.find(entry => entry.threadId === threadId)?.turnId;
    if (ended === undefined) { this.#settle(threadId); return; }
    const unlisten = this.#core.bus.onCommitted((name, payload) => {
      if (name !== 'scheduler.updated' || (payload as SchedulerState).running.some(entry => entry.turnId === ended)) return;
      unlisten();
      this.#settle(threadId);
    });
  }

  #settle(threadId: ThreadId): void {
    if (!this.#waiting.delete(threadId) || this.#core.journal.isClosed()) return;
    const thread = this.#core.journal.getThread(threadId);
    if (!thread || thread.archived) return;
    try {
      this.#assertNoInput(threadId);
      // As the user's Mark done otherwise: an idle family only, and the thread lands in the Done list.
      this.threads.archive(threadId, true, true);
      this.#line(threadId, 'Put in Done by its agent.');
    } catch (error) {
      const reason = messageOf(error);
      this.#core.log('info', `thread ${threadId}: the agent asked for Done, the thread stays open: ${reason}`, { source: 'threads', threadId });
      this.#line(threadId, `The agent asked to put this thread in Done; it stays open: ${reason}`);
    }
  }

  /** A waiting request goes with an archived or removed thread. */
  forget(threadId: ThreadId): void {
    this.#waiting.delete(threadId);
  }

  pending(threadId: ThreadId): boolean {
    return this.#waiting.has(threadId);
  }

  #assertNoInput(threadId: ThreadId): void {
    // A message the user queued while the agent answered is theirs to see answered.
    if (this.#core.composer.storage.queued.has(recordKey('inputs', threadId))) throw refused('the user wrote a message that waits to be sent', { threadId, reason: 'queued-input' });
    // Nobody watches this one land: unsent input on a device keeps the thread
    // open, as for the automatic passes, since a client drops it with the thread.
    if (this.threads.focus.hasProtectedInput(threadId)) {
      throw refused('the user has unsent input open on a device', { threadId, field: 'threadId', expected: 'a thread without unsent input' });
    }
  }

  /** A line of the timeline from the core, on the thread's last turn. */
  #line(threadId: ThreadId, text: string): void {
    const turnId = this.#core.journal.lastTurn(threadId)?.id ?? newId('trn_');
    const message: Message = { id: newId('msg_'), threadId, turnId, role: 'system', parts: [{ type: 'text', text }], state: 'complete', createdAt: Date.now() };
    this.#core.journal.append({ type: 'thread.done.note', threadId, version: 1, payload: message }, () => this.#core.journal.putMessage(message));
    this.#core.bus.emit('message.started', message);
    this.#core.bus.emit('message.completed', { threadId, messageId: message.id, state: 'complete' });
  }
}
