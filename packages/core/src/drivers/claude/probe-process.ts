import type { Query, SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { SpawnedChild } from '../../procs.ts';
import type { ProbeContext } from '../types.ts';
import type { PromptQueue } from './query.ts';

/** How long a CLI started for one read may take to exit once its input ended. */
export const PROBE_EXIT_GRACE_MS = 30_000;

/**
 * The CLI one read (models, quota) starts, from its spawn to its end.
 *
 * An expired login is refreshed at startup, and the read can be answered
 * before that refresh ends. The server spends the old refresh token as it
 * answers, so a CLI stopped before it wrote the new one leaves the account a
 * dead token and a refresh lock: the next CLI waits on the lock, takes it over
 * and signs the account out (`invalid_grant`). On Windows a stop ends the
 * process at once, so the first read after the token expired could do it.
 * `end` closes the CLI's stdin instead; it exits once the refresh is written,
 * and the caller stops it only past the grace.
 */
export class ProbeProcess {
  #exited: Promise<void> | null = null;

  constructor(private readonly ctx: ProbeContext) {}

  /** The SDK's `spawnClaudeCodeProcess`: the child runs under the probe's owner. */
  readonly spawn = (options: SdkSpawnOptions): SpawnedChild => {
    const child = this.ctx.spawnChild(options.command, options.args, { cwd: options.cwd, env: options.env });
    child.stderr.resume();
    this.#exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });
    return child;
  };

  /** Called on every path. The query closes once its CLI exited, at once when it started none. */
  end(prompts: PromptQueue, query: Query | undefined, abortController: AbortController): void {
    // An ended prompt stream makes the SDK close the CLI's stdin. `query.close()` would also arm the
    // SDK's own kill, two seconds later off Windows and seven on it, so it waits for the exit.
    prompts.end();
    if (query === undefined || this.ctx.letExit === undefined) {
      query?.close();
      abortController.abort();
      this.ctx.killTree();
      return;
    }
    this.ctx.letExit(PROBE_EXIT_GRACE_MS);
    void (this.#exited ?? Promise.resolve()).then(() => {
      query.close();
      abortController.abort();
    });
  }
}
