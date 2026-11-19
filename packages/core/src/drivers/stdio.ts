import type { CoreLogContext } from '@boite/contracts';
import type { SpawnedChild } from '../procs.ts';
import { withLogDiagnostic } from '../log-errors.ts';
import { LineSplitter, STDOUT_LINE_MAX } from './lines.ts';
import { EXIT_GRACE_MS } from './exit.ts';

export interface StdioRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onAccepted?(): void;
  writeKind?: 'steer' | 'stop';
}

type WriteKind = StdioRequestOptions['writeKind'];
interface Outbound<Id> { id?: Id; line: string; kind: WriteKind }

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}

/** Framing and request lifetime only: the adapter owns its protocol envelopes. */
export class StdioTransport<Id extends string | number> {
  private readonly pending = new Map<Id, Pending>();
  #closed = false;
  #drainingStdout = false;
  #drainTimer: ReturnType<typeof setTimeout> | undefined;
  #writeBlocked = false;
  readonly #outbox: Outbound<Id>[] = [];

  private readonly child: SpawnedChild;
  readonly #label: string;
  readonly #handlers: {
      message(message: Record<string, unknown>): void;
      log(level: 'info' | 'warn' | 'error', message: string, context?: CoreLogContext): void;
      fault?(reason: string): void;
    };

  constructor(
    child: SpawnedChild,
    label: string,
    handlers: {
      message(message: Record<string, unknown>): void;
      log(level: 'info' | 'warn' | 'error', message: string, context?: CoreLogContext): void;
      fault?(reason: string): void;
    },
  ) {
    this.child = child;
    this.#label = label;
    this.#handlers = handlers;
    const lines = new LineSplitter(line => this.#onLine(line), {
      maxLine: STDOUT_LINE_MAX,
      onOverflow: () => this.#break(`stdout line exceeded ${STDOUT_LINE_MAX} code units`),
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (!this.#closed) lines.feed(chunk); });
    child.stdout.on('end', () => { lines.end(); this.#break('stdout ended'); });
    child.stdout.on('error', () => this.#break('stdout read failed'));
    child.stdout.on('close', () => this.#break('stdout closed'));
    child.stdin.on('error', () => this.#break('stdin write failed'));
    child.stdin.on('drain', () => this.#flushWrites());
    // Input can close before the accepted turn's last stdout records drain.
    child.stdin.on('close', () => this.#drain());
  }

  request<T>(id: Id, method: string, payload: unknown, options: StdioRequestOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.#closed || this.#drainingStdout || options.signal?.aborted) {
        reject(new Error(`${this.#label}: ${this.#closed || this.#drainingStdout ? 'transport closed' : 'request cancelled'}`));
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => this.take(id)?.reject(new Error(`${this.#label}: request cancelled`));
      this.pending.set(id, {
        method, reject,
        resolve: value => {
          // One read can carry both the acknowledgement and ensuing output.
          try { options.onAccepted?.(); resolve(value as T); }
          catch (error) { reject(error); }
        },
        cleanup: () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); },
      });
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => this.take(id)?.reject(new Error(`${this.#label}: request timed out`)), options.timeoutMs);
        timer.unref?.();
      }
      this.write(payload, options.writeKind, id);
    });
  }

  take(id: Id): Pending | undefined {
    const entry = this.pending.get(id);
    if (entry !== undefined) {
      this.pending.delete(id);
      entry.cleanup();
      const queued = this.#outbox.findIndex(write => write.id === id);
      if (queued >= 0) this.#outbox.splice(queued, 1);
    }
    return entry;
  }

  write(payload: unknown, kind?: WriteKind, id?: Id): void {
    if (this.#closed || this.#drainingStdout) return;
    try {
      const line = `${JSON.stringify(payload)}\n`;
      if (!this.#writeBlocked) {
        this.#writeLine(line);
        return;
      }
      // Stop can pass unsent steering. An initial prompt, a reply or another
      // control still keeps its place, and a line in the pipe always finishes.
      let at = this.#outbox.length;
      if (kind === 'stop') while (this.#outbox[at - 1]?.kind === 'steer') at -= 1;
      this.#outbox.splice(at, 0, { line, kind, id });
    } catch {
      this.#break('stdin write failed');
    }
  }

  #writeLine(line: string): void {
    this.#writeBlocked = !this.child.stdin.write(line, error => {
      if (error) this.#break('stdin write failed');
    });
  }

  #flushWrites(): void {
    if (this.#closed || this.#drainingStdout) return;
    this.#writeBlocked = false;
    try {
      while (!this.#writeBlocked && this.#outbox.length > 0) this.#writeLine(this.#outbox.shift()!.line);
    } catch {
      this.#break('stdin write failed');
    }
  }

  fail(reason: string, diagnostic?: string): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#drainTimer);
    this.#drainTimer = undefined;
    this.#drainingStdout = false;
    this.#outbox.length = 0;
    for (const id of this.pending.keys()) {
      const error = new Error(reason);
      this.take(id)?.reject(diagnostic === undefined ? error : withLogDiagnostic(error, diagnostic));
    }
  }

  invalid(reason = 'invalid message envelope'): void {
    this.#handlers.log('warn', `${this.#label}: ${reason}`, { event: 'provider.protocolError' });
  }

  #drain(): void {
    if (this.#closed || this.#drainingStdout) return;
    this.#drainingStdout = true;
    this.#outbox.length = 0;
    // Prompt requests have no default deadline. A live child that keeps stdout
    // open must still reach the session's fault/exit handling within a bound.
    this.#drainTimer = setTimeout(() => this.#break('stdout drain timed out after stdin closed'), EXIT_GRACE_MS);
    this.#drainTimer.unref?.();
  }

  #break(reason: string): void {
    if (this.#closed) return;
    this.invalid(reason);
    this.fail(`${this.#label}: ${reason}`);
    try { this.#handlers.fault?.(`${this.#label}: ${reason}`); }
    catch { this.invalid('transport fault handler failed'); }
  }

  #onLine(line: string): void {
    if (this.#closed) return;
    let message: unknown;
    try { message = JSON.parse(line); }
    catch { this.invalid('stdout record is not JSON'); return; }
    if (!isRecord(message)) { this.invalid(); return; }
    try { this.#handlers.message(message); }
    catch { this.#break('message handler failed'); }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isRpcEnvelope(message: Record<string, unknown>): boolean {
  const method = message['method'], id = message['id'];
  return (method === undefined || typeof method === 'string') &&
    (id === undefined || id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)));
}
