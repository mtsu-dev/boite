import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BackgroundTask } from '@boite/contracts';
import type { SessionContext } from '../types.ts';
import { backgroundKind } from './mapping.ts';

type Finisher = NonNullable<SessionContext['backgroundFinished']>;

/**
 * What a Claude CLI runs in the background. `background_tasks_changed` is the
 * whole set, each time; `task_started` names the tool call behind a task.
 * Ambient tasks (watchers the CLI runs for itself) are not work anyone waits
 * on. A task's end is told to the context attached when it started.
 */
export class SessionTasks {
  /** As the CLI's last `background_tasks_changed` said. */
  #list: BackgroundTask[] = [];
  readonly #finishers = new Map<string, Finisher[]>();
  /** `task_started` by task id: the tool call that launched it and when. */
  readonly #launched = new Map<string, { toolId: string | null; startedAt: number }>();

  /** The CLI runs something in the background. */
  get running(): boolean {
    return this.#list.length > 0;
  }

  /** A system frame, with the context attached now: the new set when the CLI sent one, else null. */
  noted(message: Extract<SDKMessage, { type: 'system' }>, ctx: SessionContext): BackgroundTask[] | null {
    if (message.subtype === 'task_notification') {
      const owners = this.#finishers.get(message.task_id);
      const finish = owners?.shift();
      const state = message.status === 'completed' ? 'completed' : message.status === 'failed' ? 'error' : 'cancelled';
      finish?.(message.task_id, state);
      if (!owners?.length) this.#finishers.delete(message.task_id);
      return null;
    }
    if (message.subtype === 'task_started') {
      if (ctx.backgroundFinished) {
        const owners = this.#finishers.get(message.task_id) ?? [];
        if (owners.at(-1) !== ctx.backgroundFinished) owners.push(ctx.backgroundFinished);
        this.#finishers.set(message.task_id, owners);
      }
      this.#launched.set(message.task_id, { toolId: message.tool_use_id ?? null, startedAt: Date.now() });
      return null;
    }
    if (message.subtype !== 'background_tasks_changed') return null;
    const next = message.tasks.filter(task => task.ambient !== true).map((task): BackgroundTask => {
      if (!this.#finishers.has(task.task_id) && ctx.backgroundFinished) this.#finishers.set(task.task_id, [ctx.backgroundFinished]);
      const known = this.#launched.get(task.task_id) ?? this.#list.find(entry => entry.id === task.task_id);
      return {
        id: task.task_id,
        kind: backgroundKind(task.task_type),
        description: task.description,
        toolId: known?.toolId ?? null,
        startedAt: known?.startedAt ?? Date.now(),
      };
    });
    this.#list = next;
    for (const id of [...this.#launched.keys()]) if (!next.some(task => task.id === id)) this.#launched.delete(id);
    return next;
  }

  /** The CLI is gone and tracks nothing any more. True when it still listed tasks. */
  clear(): boolean {
    this.#finishers.clear();
    const had = this.#list.length > 0;
    this.#list = [];
    return had;
  }
}
