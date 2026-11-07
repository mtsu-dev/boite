/*
 * A thread shell the keeper starts and holds, in the core's process registry
 * as any terminal: traced, killed with its thread, its exit recorded. Only the
 * PTY is the keeper's.
 */

import { resolve } from 'node:path';
import type { ThreadId } from '@boite/contracts';
import { currentOs } from '../paths.ts';
import type { ProcRegistry } from '../procs.ts';
import type { SpawnedKeptTerminal, TerminalSpawnOptions } from '../process-spawn-types.ts';
import type { KeeperClient, KeptTerminal } from './client.ts';
import type { KeptTag } from './protocol.ts';

/** How long a shell that got a hang-up has before SIGKILL, as for a terminal of the core. */
const KILL_GRACE_MS = 2_000;

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
    kill: () => {
      // As for a terminal of the core: the descendants first, while the shell still holds them.
      if (currentOs() === 'linux' && procs.platform.terminateProcess(threadId, kept.pid)) return;
      kept.signal('SIGHUP');
      const hard = setTimeout(() => kept.signal('SIGKILL'), KILL_GRACE_MS);
      hard.unref();
      void kept.exited.finally(() => clearTimeout(hard));
    },
    exited: kept.exited,
  });
  return { record, kept, exited };
}
