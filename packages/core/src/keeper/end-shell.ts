/*
 * How the keeper ends a shell it holds, with what the shell started.
 *
 * A hang-up to the shell's group is not enough. An interactive shell gives
 * each background job a process group of its own, so `nohup cmd &` is in
 * neither the shell's group nor reached by its SIGHUP, and once the shell
 * exits that job is reparented: its parent no longer says where it came from.
 * So the shell's descendants and their groups are read while the shell still
 * holds them, before any signal, and whatever of them is left after the grace
 * gets SIGKILL, even when the shell itself obeyed the hang-up.
 *
 * A pid read at the start is only signalled again if the process table still
 * shows it in the group it was in, and a group only while it has members, so
 * a pid handed out again during the grace is left alone. What a descendant
 * started in a session of its own after the read is out of reach, as it is
 * for a terminal of the core on macOS.
 */

import { GROUP_POLL_MS, KILL_GRACE_MS } from '../platform/posix-kill.ts';

interface Row { pid: number; ppid: number; pgid: number }

/** `ps -axo pid=,ppid=,pgid=`, the same on Linux and macOS. Empty when it cannot run. */
async function processTable(): Promise<Row[]> {
  try {
    const child = Bun.spawn({ cmd: ['ps', '-axo', 'pid=,ppid=,pgid='], stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const [text] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    const rows: Row[] = [];
    for (const line of text.split('\n')) {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
      if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isInteger(pgid) && pid! > 0) rows.push({ pid: pid!, ppid: ppid!, pgid: pgid! });
    }
    return rows;
  } catch { return []; }
}

/** Every process under `root` by parent, and every member of their groups and of the root's. */
function familyOf(rows: Row[], root: number): { members: Row[]; groups: Set<number> } {
  const children = new Map<number, Row[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const under = new Set<number>();
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (under.has(child.pid) || child.pid === root) continue;
      under.add(child.pid);
      queue.push(child.pid);
    }
  }
  const groups = new Set<number>([root]);
  for (const row of rows) if (under.has(row.pid) && row.pgid > 1) groups.add(row.pgid);
  const members = rows.filter((row) => row.pid !== root && (under.has(row.pid) || groups.has(row.pgid)));
  return { members, groups };
}

function send(target: number, signal: NodeJS.Signals | 0): boolean {
  try { process.kill(target, signal); return true; } catch (error) { return (error as { code?: unknown }).code === 'EPERM'; }
}

/**
 * SIGHUP to the shell's group and to its descendants' groups, then SIGKILL
 * after `KILL_GRACE_MS` to whatever of them is still there. Resolves once
 * they are all gone, or right after the SIGKILL.
 */
export async function endShell(pid: number, exited: Promise<unknown>, graceMs: number = KILL_GRACE_MS): Promise<void> {
  let shellDone = false;
  void exited.then(() => { shellDone = true; }, () => { shellDone = true; });
  const { members, groups } = familyOf(await processTable(), pid);
  // The shell leads its own session and group; a shell that could not is signalled alone.
  if (!send(-pid, 'SIGHUP') && !shellDone) send(pid, 'SIGHUP');
  for (const group of groups) if (group !== pid) send(-group, 'SIGHUP');

  const left = (): boolean => !shellDone || members.some((row) => send(row.pid, 0));
  for (let waited = 0; waited < graceMs && left(); waited += GROUP_POLL_MS) await Bun.sleep(GROUP_POLL_MS);
  if (!left()) return;

  const now = await processTable();
  const still = new Set(now.map((row) => `${row.pid}:${row.pgid}`));
  const occupied = new Set(now.map((row) => row.pgid));
  for (const group of groups) if (occupied.has(group)) send(-group, 'SIGKILL');
  for (const row of members) if (still.has(`${row.pid}:${row.pgid}`)) send(row.pid, 'SIGKILL');
  if (!shellDone) send(pid, 'SIGKILL');
}
