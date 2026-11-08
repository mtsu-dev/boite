/*
 * How a thread's shell is stopped, the same for one the core runs and one the
 * keeper holds (`keeper/kept-terminal.ts`).
 */

import type { ThreadId } from '@boite/contracts';
import { currentOs } from './paths.ts';
import type { ProcessPlatform } from './platform/types.ts';

/** How long a shell that got a hang-up has before SIGKILL. */
const HANGUP_GRACE_MS = 2_000;

/**
 * Off Windows. Interactive jobs have groups of their own: on Linux the backend
 * stops the shell's descendants first, before the shell exits and reparents
 * jobs that ignore its hang-up. Otherwise the hang-up a closed terminal sends,
 * which an interactive shell exits on and passes to its jobs where SIGTERM is
 * ignored, then SIGKILL after `HANGUP_GRACE_MS`.
 */
export function hangUpShell(
  platform: ProcessPlatform, threadId: ThreadId, pid: number,
  signal: (name: 'SIGHUP' | 'SIGKILL') => void, exited: Promise<unknown>,
): void {
  if (currentOs() === 'linux' && platform.terminateProcess(threadId, pid)) return;
  signal('SIGHUP');
  const hard = setTimeout(() => {
    try { signal('SIGKILL'); } catch { /* already exited */ }
  }, HANGUP_GRACE_MS);
  hard.unref();
  void exited.finally(() => clearTimeout(hard));
}
