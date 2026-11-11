/*
 * A thread shell the keeper starts and holds, in the core's process registry
 * as any terminal: traced, killed with its thread, its exit recorded. Only the
 * PTY is the keeper's.
 */

import { resolve } from 'node:path';
import type { ThreadId } from '@boite/contracts';
import type { ProcRegistry } from '../procs.ts';
import { hangUpShell } from '../terminal-hangup.ts';
import type { SpawnedKeptTerminal, TerminalSpawnOptions } from '../process-spawn-types.ts';
import type { KeeperClient, KeptTerminal } from './client.ts';
import type { KeptTag } from './protocol.ts';

/** `procs.spawnTerminal`, through the keeper: the output reaches `onData` of the returned `kept`. */
export async function spawnKeptTerminal(
  procs: ProcRegistry, keeper: KeeperClient, threadId: ThreadId, cmd: string, args: string[],
  opts: Omit<TerminalSpawnOptions, 'onData'> & { tag: KeptTag },
): Promise<SpawnedKeptTerminal> {
  const cwd = resolve(opts.cwd);
  procs.admitCwd(cwd);
  procs.protection.assertTerminal(threadId);
  const kept = await keeper.spawnTerminal(opts.tag, cmd, args, { cwd, env: opts.env, cols: opts.cols, rows: opts.rows });
  try {
    return adoptKeptTerminal(procs, threadId, kept, cmd, args);
  } catch (error) {
    // The core began to stop while the keeper started it.
    kept.release();
    throw error;
  }
}

/** A shell the keeper started, for this core or an earlier one, in the registry. */
export function adoptKeptTerminal(procs: ProcRegistry, threadId: ThreadId, kept: KeptTerminal, cmd: string, args: string[]): SpawnedKeptTerminal {
  const { record, exited } = procs.adopt(threadId, kept.pid, cmd, args, {
    running: () => kept.running,
    // As for a terminal of the core.
    kill: () => { hangUpShell(procs.platform, threadId, kept.pid, (signal) => kept.signal(signal), kept.exited); return undefined; },
    exited: kept.exited,
  });
  return { record, kept, exited };
}
