/*
 * The echo driver's `[process]` and `[flood:N]`: the turn's text goes through
 * a child, `echo-agent.ts`, started with the session's own `spawnChild`, the
 * way a real agent's output comes from its process. It is how an echo turn
 * runs on the keeper (`keeper/kept-agents.ts`), in tests and in the bench.
 * Without either directive the echo driver starts no process.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { SpawnedChild } from '../process-spawn-types.ts';
import type { TurnContext } from './types.ts';

/** How long a child whose stdin ended has to exit before it is killed. */
const EXIT_GRACE_MS = 5_000;

/** `echo-agent.ts` from the sources, or the bundle or binary this module is in with `--echo-agent`. */
export function echoAgentCommand(): { cmd: string; args: string[] } {
  const near = (path: string): string | null => {
    const file = fileURLToPath(new URL(path, import.meta.url));
    return existsSync(file) ? file : null;
  };
  const sources = near('./echo-agent.ts');
  if (sources !== null) return { cmd: process.execPath, args: [sources] };
  // In the bundle this module is `dist/main.js` itself.
  const bundle = near('./main.js');
  return { cmd: process.execPath, args: [...(bundle === null ? [] : [bundle]), '--echo-agent'] };
}

export type EchoRequest = { text: string } | { flood: number };

export class EchoProcess {
  readonly #child: SpawnedChild;
  #waiting: { onDelta: (text: string) => void; resolve: () => void } | null = null;
  #gone = false;
  readonly exited: Promise<void>;

  constructor(ctx: Pick<TurnContext, 'spawnChild'>, cwd: string) {
    const { cmd, args } = echoAgentCommand();
    const child = ctx.spawnChild(cmd, args, { cwd, env: process.env });
    this.#child = child;
    const gone = (): void => {
      this.#gone = true;
      const waiting = this.#waiting;
      this.#waiting = null;
      waiting?.resolve();
    };
    this.exited = new Promise<void>((resolve) => {
      child.once('close', () => { gone(); resolve(); });
      child.once('error', () => { gone(); resolve(); });
    });
    child.stdin.on('error', () => { /* it exited: `close` follows */ });
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      let frame: { d?: unknown; done?: unknown };
      try { frame = JSON.parse(line) as typeof frame; } catch { return; }
      if (typeof frame.d === 'string') this.#waiting?.onDelta(frame.d);
      else if (frame.done === true) {
        const waiting = this.#waiting;
        this.#waiting = null;
        waiting?.resolve();
      }
    });
  }

  /** Sends `request` and hands each piece of text to `onDelta`. Resolves at its end, or once the child is gone. */
  stream(request: EchoRequest, onDelta: (text: string) => void): Promise<void> {
    if (this.#gone) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#waiting = { onDelta, resolve };
      this.#child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  /** The turn was stopped: the request in flight resolves now and what the child still writes goes nowhere. */
  cancel(): void {
    const waiting = this.#waiting;
    this.#waiting = null;
    waiting?.resolve();
  }

  /** The turn is over: the child's stdin ends and it exits; a stopped turn kills it. */
  end(kill: boolean): Promise<void> {
    if (this.#gone) return this.exited;
    if (kill) this.#child.kill();
    else {
      this.#child.stdin.end();
      const hard = setTimeout(() => this.#child.kill(), EXIT_GRACE_MS);
      hard.unref();
      void this.exited.finally(() => clearTimeout(hard));
    }
    return this.exited;
  }
}
