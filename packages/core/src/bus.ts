import { eventThreadId, type ComposerRevision, type RpcEventName, type RpcEvents } from '@boite/contracts';
import { pacing } from './pacing.ts';

export type EventPayload = RpcEvents[RpcEventName];
export interface BroadcastOptions { excludeConnection?: string; composerRevision?: ComposerRevision }
export type BusListener = (name: RpcEventName, payload: EventPayload, options?: BroadcastOptions) => void;
interface Notification { name: RpcEventName; payload: EventPayload; options?: BroadcastOptions }
/** A staged event, or an effect `whenCommitted` holds until the outermost commit. */
type Staged = Notification | { effect: () => void };

const DELTA_WINDOW_MS = 16;

interface PendingDelta {
  threadId: string;
  messageId: string;
  partIndex: number;
  text: string;
}

/**
 * Text deltas for the same message and part are concatenated for one window
 * before they reach a socket. Events in a conversation flush its own text
 * first, so a client sees text before a later card in the same conversation.
 * Global events and transaction boundaries flush every conversation.
 */
export class Bus {
  private readonly listeners = new Set<BusListener>();
  readonly #committedListeners = new Set<BusListener>();
  #staged: Staged[] | null = null;
  readonly #pending = new Map<string, Map<string, PendingDelta>>();
  #timer: unknown = null;
  #reporting = false;
  /**
   * Where a throwing listener is reported. One listener's error must neither
   * skip the listeners after it nor escape the delta timer, which would end the
   * process.
   */
  onError: (message: string) => void = (message) => console.error(message);
  /** Core diagnostics are normalized before either internal or committed observers see them. */
  normalizeLog?: (payload: RpcEvents['core.log']) => RpcEvents['core.log'];

  /**
   * Every event as it is emitted, possibly inside a transaction that can still
   * roll back. Only state that rolls back with it belongs here: an effect on a
   * process, the network or memory subscribes with `onCommitted`.
   */
  onAny(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Observers with effects see a write only after its synchronous transaction commits. */
  onCommitted(listener: BusListener): () => void {
    this.#committedListeners.add(listener);
    return () => { this.#committedListeners.delete(listener); };
  }

  /** Buffer external notifications around a synchronous storage commit; discard on rollback. */
  afterCommit<T>(write: () => T): T {
    this.flush();
    const parent = this.#staged;
    const notifications: Staged[] = [];
    this.#staged = notifications;
    let result: T;
    try {
      result = write();
      this.flush();
    } catch (error) {
      this.#pending.clear();
      if (this.#timer !== null) pacing.clear(this.#timer);
      this.#timer = null;
      throw error;
    } finally {
      this.#staged = parent;
    }
    if (parent !== null) parent.push(...notifications);
    else for (const staged of notifications) this.#release(staged);
    return result;
  }

  /**
   * Runs `effect` once the write around it commits, in order with the events
   * it emitted, or now outside any `afterCommit`. A rollback drops it: what
   * the write would have stopped, closed or forgotten keeps running.
   */
  whenCommitted(effect: () => void): void {
    this.flush();
    if (this.#staged !== null) this.#staged.push({ effect });
    else this.#release({ effect });
  }

  #release(staged: Staged): void {
    if (!('effect' in staged)) { this.#notify(this.#committedListeners, staged.name, staged.payload, staged.options); return; }
    try { staged.effect(); }
    catch (error) { this.onError(`committed effect failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  emit<E extends RpcEventName>(name: E, payload: RpcEvents[E], options?: BroadcastOptions & { firstText?: true }): void {
    if (name === 'core.log' && this.normalizeLog) payload = this.normalizeLog(payload as RpcEvents['core.log']) as RpcEvents[E];
    if (name === 'message.delta') {
      const delta = payload as RpcEvents['message.delta'];
      if (options?.firstText) {
        this.#flushThread(delta.threadId);
        this.#dispatch(name, delta);
      } else this.#queue(delta);
      return;
    }
    if (this.#pending.size > 0) {
      const threadId = localThread(name, payload);
      if (threadId === null) this.flush();
      else this.#flushThread(threadId);
    }
    this.#dispatch(name, payload, options);
  }

  flush(): void {
    this.#cancelTimer();
    if (this.#pending.size === 0) return;
    const items = [...this.#pending.values()];
    this.#pending.clear();
    for (const thread of items) for (const delta of thread.values()) this.#dispatch('message.delta', delta);
  }

  #flushThread(threadId: string): void {
    const thread = this.#pending.get(threadId);
    if (thread === undefined) return;
    this.#pending.delete(threadId);
    if (this.#pending.size === 0) this.#cancelTimer();
    for (const delta of thread.values()) this.#dispatch('message.delta', delta);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;
    pacing.clear(this.#timer);
    this.#timer = null;
  }

  dispose(): void {
    this.flush();
    this.listeners.clear();
    this.#committedListeners.clear();
  }

  #queue(delta: RpcEvents['message.delta']): void {
    let thread = this.#pending.get(delta.threadId);
    if (thread === undefined) this.#pending.set(delta.threadId, thread = new Map());
    const key = `${delta.messageId}|${delta.partIndex}`;
    const current = thread.get(key);
    if (current) current.text += delta.text;
    else thread.set(key, { ...delta });
    if (this.#timer === null) {
      this.#timer = pacing.set(() => {
        this.#timer = null;
        this.flush();
      }, DELTA_WINDOW_MS);
    }
  }

  #dispatch(name: RpcEventName, payload: EventPayload, options?: BroadcastOptions): void {
    this.#notify(this.listeners, name, payload, options);
    if (this.#staged !== null) this.#staged.push({ name, payload, options });
    else this.#notify(this.#committedListeners, name, payload, options);
  }

  #notify(listeners: Set<BusListener>, name: RpcEventName, payload: EventPayload, options?: BroadcastOptions): void {
    for (const listener of listeners) {
      try {
        listener(name, payload, options);
      } catch (error) {
        // A report is itself an event: a listener that throws on it too must not loop.
        if (this.#reporting) continue;
        this.#reporting = true;
        try {
          this.onError(`event listener failed on ${name}: ${error instanceof Error ? error.message : String(error)}`);
        } catch {
          // Nothing left to report to.
        } finally {
          this.#reporting = false;
        }
      }
    }
  }
}

/** These events frame a single conversation. Coordination and other cross-thread events keep the global barrier. */
function localThread(name: RpcEventName, payload: EventPayload): string | null {
  if (name === 'thread.updated' || name === 'thread.created') return (payload as RpcEvents['thread.updated']).id;
  return name.startsWith('message.') || name.startsWith('thread.') || name.startsWith('turn.')
    || name.startsWith('process.') || name === 'core.log' ? eventThreadId(payload) : null;
}

export { eventThreadId } from '@boite/contracts';
