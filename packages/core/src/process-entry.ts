import type { ProcessEntry as Entry } from './process-spawn-types.ts';
import type { ProcessPlatform, SubtreeLineage } from './platform/types.ts';

/** Whether `proc` runs as its spawner sees it: until it reports the exit it holds the process's handle. */
export const running = (proc: { exitCode: number | null; signalCode: unknown }) => () => proc.exitCode === null && proc.signalCode === null;

/** A thread stop continues even when a registered process exits during its own kill. */
export function killEntry(entry: Entry): Promise<void> | undefined {
  try { return entry.kill() ?? undefined; } catch { return undefined; }
}

/** Capture the tree before the root exits. taskkill still needs a live root while it runs. */
export function stopProcess(platform: ProcessPlatform, threadId: string, pid: number, assigned: boolean, live: boolean, kill: Entry['kill'], lineage?: () => SubtreeLineage): Promise<void> | undefined {
  let descendants: Promise<void> | undefined;
  let fallback: void | Promise<unknown> = undefined;
  if (live) {
    descendants = platform.stopDescendants?.(threadId, pid);
    if (assigned) platform.terminateSubtree?.(threadId, pid, lineage?.());
    else fallback = platform.terminateUnassigned(pid);
  }
  const stop = fallback instanceof Promise ? fallback.then(kill, kill) : kill() ?? undefined;
  return descendants === undefined ? stop : Promise.all([descendants, stop]).then(() => undefined);
}

/**
 * The captured parent links under the live `root`: each traced process,
 * running or exited, whose chain of recorded parents reaches that root's entry.
 * Exited intermediates stay linked through `parent`; a pid alone links nothing.
 */
export function lineageOf(root: Entry | undefined, known: Iterable<{ entry: Entry }>): SubtreeLineage {
  const descendants = new Set<string>();
  if (root === undefined) return { root: null, descendants };
  for (const { entry } of known) {
    if (entry === root || entry.identity.incarnation === null) continue;
    const passed = new Set<Entry>();
    for (let above: Entry | null = entry.parent ?? null; above !== null && !passed.has(above); above = above.parent ?? null) {
      if (above === root) { descendants.add(`${entry.record.pid}:${entry.identity.incarnation}`); break; }
      passed.add(above);
    }
  }
  return { root: root.identity.incarnation, descendants };
}
