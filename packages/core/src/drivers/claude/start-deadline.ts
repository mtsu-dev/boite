import type { SpawnedChild } from '../../procs.ts';

/**
 * How long a turn waits for the CLI's first `init` before the start counts as
 * failed. CLI 2.1.326 says init in 0.4 s here, and waits 30 s for a stdio MCP
 * server that never answers before it gives up on it and starts (probed on
 * 2026-11-17): three times that bound leaves room for a host short of CPU,
 * while a CLI that never starts no longer holds the thread for good.
 */
export const START_DEADLINE_MS = 90_000;

/** The timer of one session's start: armed while a turn waits for `init`, cleared by it. */
export class StartDeadline {
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** `missed` gets the reason once `ms` passed with no `clear`. Arming again keeps the first timer. */
  arm(ms: number, missed: (reason: string) => void): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      missed(`Claude Code did not start within ${ms / 1000} s`);
    }, ms);
    this.#timer.unref?.();
  }

  clear(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/**
 * Stops the CLI and what it started, through the registry when the core
 * offers it, and resolves once it exited.
 */
export async function stopCli(child: SpawnedChild | null, stopChild?: (child: SpawnedChild) => Promise<void>): Promise<void> {
  if (child === null) return;
  if (stopChild !== undefined) return stopChild(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  child.kill('SIGKILL');
  await exited;
}
