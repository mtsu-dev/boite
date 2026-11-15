import type { AgentSchedule, RpcParams } from '@boite/contracts';
import { spentAgentRoutine } from '@boite/contracts';
import type { CoreClient } from '../client.ts';
import { targetOf } from '../control-cli.ts';

export const BOT_ACTIONS = 'memory, remember, routines, schedule, unschedule, watch or unwatch';


/** `boite mochi ...` (`boite agent` before) from a bot's own thread. Authentication stays in the existing boite CLI. */
export async function botCommand(client: CoreClient, threadId: string, args: string[]): Promise<unknown> {
  const [action, ...rest] = args;
  const snapshot = await client.call('agents.snapshot', { threadId });
  const agent = snapshot.profiles[0];
  if (!agent) throw new Error('this thread is not a mochi\'s');
  const need = (index: number, name: string): string => {
    const value = rest[index];
    if (!value) throw new Error(`mochi ${action} needs ${name}`);
    return value;
  };
  const json = <T>(): T => {
    try { return JSON.parse(rest.join(' ')) as T; }
    catch { throw new Error(`mochi ${action} needs a JSON object`); }
  };
  switch (action) {
    case 'memory': {
      const brain = await client.call('agents.brain.get', { threadId, agentId: agent.id });
      return { memory: `${brain.path}/MEMORY.md`, text: brain.memory };
    }
    case 'remember': {
      const text = rest.join(' ').trim();
      if (!text) throw new Error('mochi remember needs the fact to note');
      const brain = await client.call('agents.memory.note', { threadId, text });
      return { noted: text, memory: `${brain.path}/MEMORY.md`, characters: brain.memory.length };
    }
    case 'routines': return snapshot.routines;
    case 'schedule': {
      const value = json<{ name?: string; prompt?: string; schedule?: AgentSchedule; id?: string; expectedRevision?: number; enabled?: boolean; check?: string | null }>();
      const previous = value.id ? snapshot.routines.find(r => r.id === value.id) : undefined;
      if (value.id && !previous) throw new Error(`mochi schedule: no routine ${value.id}; boite mochi routines lists yours`);
      // A spent once routine was disabled by the scheduler; giving it a new schedule re-arms it.
      const rearm = previous && spentAgentRoutine(previous) && value.schedule !== undefined;
      const params: RpcParams<'agents.routine.save'> = {
        threadId,
        ...(previous ? { id: previous.id, expectedRevision: value.expectedRevision ?? previous.revision } : {}),
        // An edit keeps the name, prompt and schedule it leaves out, so {"id":…,"check":…} only adds a check.
        value: { agentId: agent.id, name: value.name ?? previous?.name as string, prompt: value.prompt ?? previous?.prompt as string, schedule: value.schedule ?? previous?.schedule as AgentSchedule,
          enabled: value.enabled ?? (rearm ? true : previous?.enabled ?? true), nextAt: null, lastTurnId: null, lastScheduledAt: null,
          // Left out, an edit keeps the check it had; null or "" removes it.
          check: value.check === undefined ? previous?.check ?? null : value.check },
      };
      return client.call('agents.routine.save', params);
    }
    case 'unschedule': return client.call('agents.routine.remove', { threadId, routineId: need(0, 'a routine id (boite mochi routines lists them)') });
    case 'watch':
    case 'unwatch': {
      // `<machine>/<thread-id>`: a thread of a project another machine of the group entrusted to the bot.
      const { target, machine } = targetOf(need(0, 'a thread id'));
      const watched = await client.call('agents.watch', { threadId, watchThreadId: target, watched: action === 'watch', ...(machine === undefined ? {} : { machine }) });
      return watched ?? { unwatched: rest[0] };
    }
    default: throw new Error(`mochi expects ${BOT_ACTIONS}; boite mochi help lists them`);
  }
}
