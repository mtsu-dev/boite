/*
 * Agent sessions on the keeper (`BOITE_KEEPER=1`). The process of a thread's
 * agent session runs in the keeper, on pipes, and its driver reads it through
 * a `KeptChild` as it would read its own child. Probes, titles and shared
 * executions stay on this core's pipes: only a launch with `keep` comes here.
 *
 * Each such process has a `kept_processes` row. Its `offset` is how much of
 * its stdout the driver has read, written in the transaction that commits the
 * parts the driver streamed from it (`StreamBuffer`'s commit hook): the parts
 * and the offset land together. Only once that transaction is committed is
 * the keeper told it may let go of those bytes. Stdout that brought no text
 * arms a commit too, and one runs at once past `FORCE_COMMIT_BYTES`, well
 * inside the keeper's window.
 *
 * Nothing is attached again across a restart yet: a core that stops still
 * ends its turns. The next core ends what an earlier one left in the keeper
 * (`terminals.ts` releases every process that is not a shell) and clears its
 * rows. A keeper this core cannot reach leaves the launch on its own pipes,
 * with a warning, while it connects again.
 */

import type { ThreadId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { clearKeptProcesses, deleteKeptProcess, insertKeptProcess, setKeptOffset } from '../journal/kept-processes.ts';
import type { CommitHook } from '../journal/stream-buffer.ts';
import { stopGroup } from '../platform/posix-kill.ts';
import type { SpawnedChild, SpawnOptions } from '../process-spawn-types.ts';
import type { KeeperClient } from './client.ts';
import type { KeptChild } from './kept-child.ts';

/** Past this much stdout read and not yet committed, the commit runs at once rather than at the stream's pace. */
export const FORCE_COMMIT_BYTES = 4 * 1024 * 1024;

interface Ledger {
  child: KeptChild;
  procId: string;
  /** The offset its row holds and the keeper was told of. */
  committed: number;
}

export class KeptAgents implements CommitHook {
  readonly #core: Core;
  readonly #client: KeeperClient;
  readonly #ledgers = new Map<KeptChild, Ledger>();
  /** Set once the keeper was found unreachable, until it is reached again: one warning per outage. */
  #warned = false;
  #forcing = false;
  #closed = false;

  constructor(core: Core, client: KeeperClient) {
    this.#core = core;
    this.#client = client;
    clearKeptProcesses(core.journal.db);
    client.stayAttached();
    core.procs.keptSpawn = (threadId, cmd, executable, args, opts) => this.#spawn(threadId, cmd, executable, args, opts);
    core.journal.stream.setCommitHook(this);
    // After the shells' restore, which ends what an earlier core left and starts no keeper.
    void core.terminals.ready.then(() => this.#connect());
  }

  /** The agent processes it holds a row for. */
  get size(): number { return this.#ledgers.size; }

  pending(): boolean {
    for (const ledger of this.#ledgers.values()) if (ledger.child.closed || ledger.child.consumed > ledger.committed) return true;
    return false;
  }

  write(): () => void {
    const db = this.#core.journal.db;
    const now = Date.now();
    const acks: [Ledger, number][] = [];
    const done: Ledger[] = [];
    for (const ledger of this.#ledgers.values()) {
      const offset = ledger.child.consumed;
      if (ledger.child.closed) { deleteKeptProcess(db, ledger.procId); done.push(ledger); } else if (offset > ledger.committed) setKeptOffset(db, ledger.procId, offset, now);
      if (offset > ledger.committed) acks.push([ledger, offset]);
    }
    return () => {
      for (const [ledger, offset] of acks) { ledger.committed = offset; ledger.child.ack(offset); }
      // Its row is gone with its last offset: the keeper forgets it.
      for (const ledger of done) { this.#ledgers.delete(ledger.child); ledger.child.release(); }
    };
  }

  /** Core shutdown: no launch comes here any more. The keeper's client closes with the shells'. */
  close(): void {
    this.#closed = true;
    if (this.#core.procs.keptSpawn !== null) this.#core.procs.keptSpawn = null;
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.#client.connect({ launch: true });
      if (this.#client.connected) this.#warned = false;
    } catch (error) {
      this.#core.log('warn', `the keeper did not start: agent sessions run on this core's pipes (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  #spawn(threadId: ThreadId, cmd: string, executable: string, args: string[], opts: SpawnOptions): SpawnedChild | null {
    const keep = opts.keep;
    if (keep === undefined || this.#closed) return null;
    if (!this.#client.reachable) {
      if (!this.#warned) {
        this.#warned = true;
        this.#core.logs.warn(`The keeper is not reachable: ${cmd} runs on this core's own pipes, and a restart ends it`, { source: 'keeper', event: 'keeper.agent-direct', threadId });
      }
      void this.#connect();
      return null;
    }
    const child = this.#client.spawnPipe({ kind: 'agent', threadId, turnId: keep.turnId, driver: keep.driver }, executable, args, { cwd: opts.cwd ?? process.cwd(), env: opts.env ?? process.env });
    const asked = Date.now();
    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code: number | null) => resolve(code));
      child.once('error', () => resolve(null));
    });
    child.once('spawn', () => this.#started(threadId, cmd, args, opts, keep, child, exited, asked));
    child.onProgress = () => this.#progress(child);
    // The shape of node's child the drivers and the SDK read; `KeptChild` is not one by type.
    return child as unknown as SpawnedChild;
  }

  #started(threadId: ThreadId, cmd: string, args: string[], opts: SpawnOptions, keep: NonNullable<SpawnOptions['keep']>, child: KeptChild, exited: Promise<number | null>, asked: number): void {
    const pid = child.pid!;
    const running = (): boolean => child.running;
    // Its own group: the keeper starts it detached, as this core starts an agent.
    const kill = (): Promise<void> => stopGroup(pid, running);
    const { record } = this.#core.procs.adopt(threadId, pid, cmd, args, {
      root: opts.agentRoot !== false, startup: opts.startup === true, child: child as unknown as SpawnedChild, running, kill, exited,
    });
    const ledger: Ledger = { child, procId: child.id!, committed: 0 };
    try {
      insertKeptProcess(this.#core.journal.db, { procId: ledger.procId, keeperPid: child.keeperPid ?? 0, pid, threadId, turnId: keep.turnId, kind: 'agent', driver: keep.driver, startedAt: record.startedAt });
      this.#ledgers.set(child, ledger);
    } catch (error) {
      // Unrecorded, it still runs and streams; the keeper lets go of its output only at release.
      this.#core.log('warn', `the kept agent ${ledger.procId} has no row: ${error instanceof Error ? error.message : String(error)}`);
      child.once('close', () => child.release());
    }
    // A stop asked while the keeper started it found nothing registered: it reaches it now.
    if (this.#core.procs.stopAskedSince(threadId, asked)) void kill();
  }

  #progress(child: KeptChild): void {
    if (this.#core.journal.isClosed()) return;
    this.#core.journal.stream.schedulePersist();
    const ledger = this.#ledgers.get(child);
    if (ledger === undefined || this.#forcing || child.received - ledger.committed < FORCE_COMMIT_BYTES) return;
    this.#forcing = true;
    // After the driver read what just came: the commit covers its events.
    setImmediate(() => {
      this.#forcing = false;
      this.#core.journal.persistMessages();
    });
  }
}
