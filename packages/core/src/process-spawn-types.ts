import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { ProcessRecord, ThreadId } from '@boite/contracts';
import type { ProcessIdentity } from './process-identity.ts';
import type { KeptTerminal } from './keeper/client.ts';

/** A traced process and the captured controls its registry keeps until exit. */
export interface ProcessEntry {
  record: ProcessRecord;
  identity: ProcessIdentity;
  root: boolean;
  startup?: boolean;
  /** Off Windows, the group stop that follows: resolved once the group is gone or SIGKILLed. */
  kill(): void | Promise<void>;
  /** Not yet seen exiting by its spawner, which holds its handle until then; false for one the core did not spawn. */
  running(): boolean;
  usage(): { cpuMs: number; peakMemoryBytes: number } | null;
  /** The parent running when this process started, held after it exits: the sweep reads lineage through it. */
  parent?: ProcessEntry | null;
}

export interface SpawnOptions {
  /** Bounded normal-priority initialization, ended explicitly when the agent is ready. */
  startup?: boolean;
  /** Direct spawns are agent roots unless the caller identifies a tool process. */
  agentRoot?: boolean;
  cwd?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  /**
   * `spawn` only: this many more pipes, the child's descriptors 3, 4 and on,
   * whose ends this process holds in `fds`. The agent browser speaks the
   * DevTools protocol over two of them instead of a port anyone could reach.
   */
  extraPipes?: number;
  /**
   * `spawn` only: let the child show its windows; Windows applies `windowsHide`
   * to a GUI program's first window too. The focus and audio guards then leave
   * the thread's processes, its job's included, alone: they are the user's app.
   */
  showWindow?: boolean;
}

export type ChildProcess = Bun.Subprocess<'ignore', 'pipe', 'pipe'>;

/** A child whose stdin stays open: the account login writes a pasted code into it. */
export type PipedChildProcess = Bun.Subprocess<'pipe', 'pipe', 'pipe'>;

/** What `spawnChild` returns: node's own child, which satisfies the SDK's `SpawnedProcess`. */
export type SpawnedChild = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * Stops one spawned process and what it started, and only that: the other
 * processes of its thread or scope keep running. Bound to the process caught
 * at spawn, its group off Windows, so it still reaches a helper left holding
 * the pipes after the process itself exited and the registry let go of it.
 * Resolves once the stop has ended (the group gone or sent SIGKILL) and the
 * process has exited. `proc.kill()` reaches the process alone.
 */
export type ManagedStop = () => Promise<void>;

export interface SpawnedProcess {
  record: ProcessRecord;
  proc: ChildProcess;
  exited: Promise<number>;
  stop: ManagedStop;
  /** This side of each `extraPipes` pipe, in order: the child's descriptor 3 first. */
  fds?: number[];
}

export interface SpawnedPipedProcess {
  record: ProcessRecord;
  proc: PipedChildProcess;
  exited: Promise<number>;
  stop: ManagedStop;
}

export interface TerminalSpawnOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  onData(bytes: Uint8Array): void;
}

export interface SpawnedTerminal {
  record: ProcessRecord;
  terminal: Bun.Terminal;
  exited: Promise<number>;
}

/** A terminal the keeper holds (`keeper/client.ts`): its PTY is the keeper's, the record this core's. */
export interface SpawnedKeptTerminal {
  record: ProcessRecord;
  kept: KeptTerminal;
  /** Null when the keeper went away with it. */
  exited: Promise<number | null>;
}

export interface ProcRegistryOptions {
  orphanGraceMs?: number;
  /** How long an idle thread, or an exited pid of a busy one, is kept before it is forgotten. Tests shorten it. */
  forgetDelayMs?: number;
  /** The load tick while something works, and while everything is idle. Tests shorten them. */
  loadIntervalMs?: number;
  idleLoadIntervalMs?: number;
  /** Persists what the platform and the guards say, which the live log only names. */
  diagnostic?: (message: string, context: { event: string; threadId?: ThreadId; data?: Record<string, string | number | null> }) => void;
}
