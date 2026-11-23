/**
 * The timers that join a stream before it goes out: the bus's 16 ms delta
 * window (`bus.ts`), a remote socket's 80 ms and 250 ms holds
 * (`server/connection.ts`) and the 1 s beat of a running Codex command's
 * output (`drivers/codex/turn.ts`). Everything runs them on the real clock.
 * The transfer bench (`bench/transfer/measure.ts`) swaps in one whose timers
 * fire only when it says, so what a socket sends depends on the order of the
 * agent's output alone and never on how fast a machine reads it.
 */
export interface PacingClock {
  /** `unref`: the timer does not keep the process alive. */
  set(fire: () => void, ms: number, options?: { unref?: boolean }): unknown;
  clear(handle: unknown): void;
  /** Milliseconds on the clock the timers run on, to compare deadlines. */
  now(): number;
}

const REAL: PacingClock = {
  set: (fire, ms, options) => {
    const timer = setTimeout(fire, ms);
    if (options?.unref) timer.unref?.();
    return timer;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

let current = REAL;

export const pacing: PacingClock = {
  set: (fire, ms, options) => current.set(fire, ms, options),
  clear: (handle) => current.clear(handle),
  now: () => current.now(),
};

/** Runs pacing on `clock` until called again with null. */
export function setPacingClock(clock: PacingClock | null): void {
  current = clock ?? REAL;
}
