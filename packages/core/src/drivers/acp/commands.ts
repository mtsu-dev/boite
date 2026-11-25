/**
 * Antigravity's shell commands that outlive their turn. The agent may answer a
 * prompt while a command it started still runs, and `session/cancel` stops a
 * prompt, not that command: the agent ends it only when its own process ends.
 * A command still running when its prompt ends becomes the thread's background
 * work, so Stop on the idle thread closes the process and the command with it,
 * and the session keeps its process for as long as one runs.
 */
import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import type { BackgroundTask } from '@boite/contracts';
import { antigravityCommandLine } from '../antigravity.ts';
import type { SessionContext } from '../types.ts';

type Update = SessionNotification['update'];
type Owner = Pick<SessionContext, 'background' | 'backgroundFinished'>;

interface Call {
  shell: boolean;
  description: string;
  /** Null until the agent reports that the command started. */
  startedAt: number | null;
  /** The turn that left it running, which hears how it ended; null while its turn runs. */
  owner: Owner | null;
}

export class OpenCommands {
  /** Status and kind can arrive in separate updates for the same tool call. */
  private readonly open = new Map<string, Call>();

  /** True while a command that outlived its turn still runs. */
  outlived(): boolean {
    for (const command of this.open.values()) if (command.owner !== null) return true;
    return false;
  }

  /**
   * One tool update, during a turn or between two. Returns true when it ended
   * the last command that outlived its turn.
   */
  note(update: Update): boolean {
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return false;
    const id = update.toolCallId;
    const command = this.open.get(id);
    if (update.status === 'completed' || update.status === 'failed') {
      this.open.delete(id);
      if (command === undefined || command.owner === null) return false;
      command.owner.backgroundFinished?.(id, update.status === 'completed' ? 'completed' : 'error');
      this.report(command.owner);
      return !this.outlived();
    }
    if (command !== undefined) {
      if (update.status === 'in_progress') command.startedAt ??= Date.now();
      if (!command.shell && update.kind === 'execute') {
        command.shell = true;
        command.description = antigravityCommandLine(update.rawInput) ?? command.description;
      }
      return false;
    }
    if (update.kind !== 'execute' && update.status !== 'in_progress') return false;
    this.open.set(id, {
      shell: update.kind === 'execute',
      description: antigravityCommandLine(update.rawInput) ?? update.title ?? id,
      startedAt: update.status === 'in_progress' ? Date.now() : null,
      owner: null,
    });
    return false;
  }

  /** The prompt ended: what it left running is the thread's background work. True when there is some. */
  promote(owner: Owner): boolean {
    let promoted = false;
    for (const [id, command] of this.open) {
      if (!command.shell || command.startedAt === null) {
        this.open.delete(id);
        continue;
      }
      if (command.owner !== null) continue;
      command.owner = owner;
      promoted = true;
    }
    if (promoted) this.report(owner);
    return this.outlived();
  }

  /** The process is gone, and every command with it. */
  clear(): void {
    const owners = new Set([...this.open.values()].map((command) => command.owner).filter((owner) => owner !== null));
    this.open.clear();
    for (const owner of owners) owner.background?.([]);
  }

  private report(owner: Owner): void {
    const tasks: BackgroundTask[] = [];
    for (const [id, { owner, description, startedAt }] of this.open) {
      if (owner !== null && startedAt !== null) tasks.push({ id, kind: 'shell', description, toolId: id, startedAt });
    }
    owner.background?.(tasks);
  }
}
