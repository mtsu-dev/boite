import type { ProcessEntry as Entry } from './process-spawn-types.ts';

/** Whether `proc` runs as its spawner sees it: until it reports the exit it holds the process's handle. */
export const running = (proc: { exitCode: number | null; signalCode: unknown }) => () => proc.exitCode === null && proc.signalCode === null;

/** An entry's own kill, and the group stop that may follow it. */
export function killEntry(entry: Entry): Promise<void> | undefined {
  try { return entry.kill() ?? undefined; } catch { return undefined; /* already exited */ }
}
