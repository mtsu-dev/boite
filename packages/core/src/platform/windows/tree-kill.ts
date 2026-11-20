import { dlopen, FFIType } from 'bun:ffi';
import { KILL_EXIT_CODE } from '@boite/contracts';
import { listJobPids } from './jobs-packets.ts';
import { creationIdentityOf, parentPidOf, type ProcessReads } from './process-reads.ts';
import type { SubtreeLineage } from '../types.ts';

type JobProcesses = ProcessReads & Parameters<typeof listJobPids>[0] & {
  openProcess(access: number, pid: number): number;
  inJob(job: number, proc: number): boolean;
  close(handle: number): void;
  terminateProcess(proc: number, code: number): boolean;
};

/**
 * Take a fresh job membership snapshot, even if its start notifications have not arrived.
 * A live parent edge links a member to its parent; a member whose parent left the
 * job is linked only when `lineage` recorded that exact process under the root.
 */
export function killJobSubtree(api: JobProcesses, job: number, rootPid: number, lineage?: SubtreeLineage): void {
  const access = 0x0401; // PROCESS_QUERY_INFORMATION | PROCESS_TERMINATE
  const root = api.openProcess(access, rootPid);
  if (!root) return;
  const handles = [root];
  const roots = new Map<number, { handle: number; birth: bigint; parent: number | null }>();
  try {
    const members = listJobPids(api, job);
    if (!members?.has(rootPid) || !api.inJob(job, root)) return;
    for (const pid of members) {
      const handle = pid === rootPid ? root : api.openProcess(access, pid);
      if (!handle) continue;
      if (pid !== rootPid) handles.push(handle);
      if (!api.inJob(job, handle)) continue;
      const identity = creationIdentityOf(api, handle);
      if (identity) roots.set(pid, { handle, birth: BigInt(identity.incarnation), parent: parentPidOf(api, handle) });
    }
    const rootIdentity = roots.get(rootPid);
    if (!rootIdentity) return;
    if (lineage?.root != null && rootIdentity.birth.toString() !== lineage.root) return;
    const children = new Map<number, number[]>();
    for (const [pid, child] of roots) {
      if (child.parent === null) continue;
      const parent = roots.get(child.parent);
      if (parent && parent.birth <= child.birth) {
        const siblings = children.get(child.parent) ?? [];
        siblings.push(pid);
        children.set(child.parent, siblings);
      }
    }
    const subtree = new Set([rootPid]);
    for (const pid of subtree) for (const child of children.get(pid) ?? []) subtree.add(child);
    // Members recorded under the root whose own parent is no longer in the job,
    // with their live descendants: deepest last, so stopped first.
    for (const [pid, member] of roots) {
      if (subtree.has(pid) || !lineage?.descendants.has(`${pid}:${member.birth}`) || member.birth < rootIdentity.birth) continue;
      subtree.add(pid);
    }
    for (const pid of subtree) for (const child of children.get(pid) ?? []) subtree.add(child);
    for (const pid of [...subtree].reverse()) api.terminateProcess(roots.get(pid)!.handle, KILL_EXIT_CODE);
  } finally {
    for (const handle of handles) api.close(handle);
  }
}

/** Enough to keep the process object, and so its pid, alive: Windows grants it on nearly any process. */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function loadKernel32() {
  return dlopen('kernel32.dll', {
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
  });
}
let kernel32: ReturnType<typeof loadKernel32>['symbols'] | undefined;

/** A handle of our own on `pid`, released by the returned function, or null when it will not open. */
function holdPid(pid: number): (() => void) | null {
  kernel32 ??= loadKernel32().symbols;
  const handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (handle === 0n) return null;
  return () => { kernel32!.CloseHandle(handle); };
}

function runTaskkill(pid: number): Promise<unknown> {
  // Not through procs.spawn: taskkill must not join the thread it stops.
  const taskkill = Bun.spawn({
    cmd: ['taskkill', '/T', '/F', '/PID', String(pid)],
    timeout: 5_000,
    stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', windowsHide: true,
  });
  return taskkill.exited;
}

/**
 * Windows' fallback tree kill of a root the caller saw running in this tick.
 * The root is held by a handle of our own from this call until taskkill
 * ended: the spawner closes its handle when the root exits, and without ours
 * Windows could give the pid to another process before taskkill opens it.
 * No taskkill when the hold fails: the pid is then no longer surely the root's.
 */
export function treeKill(
  pid: number,
  hold: (pid: number) => (() => void) | null = holdPid,
  run: (pid: number) => Promise<unknown> = runTaskkill,
): Promise<unknown> | undefined {
  const release = hold(pid);
  if (release === null) return undefined;
  try {
    return run(pid).catch(() => undefined).finally(release);
  } catch {
    release();
    return undefined;
  }
}
