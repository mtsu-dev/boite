import type { ProcessEntry as Entry } from './process-spawn-types.ts';
import type { ProcessPlatform } from './platform/types.ts';

/** Whether `proc` runs as its spawner sees it: until it reports the exit it holds the process's handle. */
export const running = (proc: { exitCode: number | null; signalCode: unknown }) => () => proc.exitCode === null && proc.signalCode === null;

/** Capture the tree before the root exits. taskkill still needs a live root while it runs. */
export function stopProcess(platform: ProcessPlatform, threadId: string, pid: number, assigned: boolean, live: boolean, kill: Entry['kill']): Promise<void> | undefined {
  let descendants: Promise<void> | undefined;
  let fallback: void | Promise<unknown> = undefined;
  if (live) {
    descendants = platform.stopDescendants?.(threadId, pid);
    if (assigned) platform.terminateSubtree?.(threadId, pid);
    else fallback = platform.terminateUnassigned(pid);
  }
  const own = () => { try { return kill() ?? undefined; } catch { return undefined; /* already exited */ } };
  const stop = fallback instanceof Promise ? fallback.then(own, own) : own();
  return descendants === undefined ? stop : Promise.all([descendants, stop]).then(() => undefined);
}
