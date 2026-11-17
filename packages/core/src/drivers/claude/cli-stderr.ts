import type { SpawnedChild } from '../../procs.ts';
import { EXIT_GRACE_MS } from '../exit.ts';
import { STDERR_MAX } from './query.ts';

/**
 * Drains a spawned CLI's stderr (the SDK reads it only for a process it spawns
 * itself) and keeps its last line. The SDK rejects a dead CLI with its exit
 * code alone; that line usually names the cause, such as a full disk under the
 * sandbox's reserve or a broken install.
 */
export class CliStderr {
  #last = '';
  #exited = false;
  readonly #closed: Promise<void>;

  constructor(child: SpawnedChild, log: (text: string) => void) {
    this.#closed = new Promise<void>(resolve => {
      child.once('close', () => { this.#exited = true; resolve(); });
      child.once('error', () => resolve());
    });
    child.once('exit', () => { this.#exited = true; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text.length === 0) return;
      log(text.slice(0, STDERR_MAX));
      const last = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0).at(-1);
      if (last !== undefined) this.#last = last.slice(0, STDERR_MAX);
    });
  }

  /** `reason` ending on the last stderr line once the pipe drained, when the CLI has exited. */
  async explain(reason: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.#closed, new Promise<void>(resolve => { timer = setTimeout(resolve, EXIT_GRACE_MS); })]);
    clearTimeout(timer);
    if (!this.#exited || this.#last.length === 0 || reason.includes(this.#last)) return reason;
    return `${reason}: ${this.#last}`;
  }
}
