export interface AgentTask {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type AgentTaskChange =
  | { action: 'add'; text: string }
  | { action: 'start' | 'done' | 'remove'; id: string }
  | { action: 'clear' };

export function applyAgentTaskChange(tasks: AgentTask[], change: AgentTaskChange): AgentTask[] {
  switch (change.action) {
    case 'add': {
      if (typeof change.text !== 'string' || !change.text.trim()) throw new Error('task add needs text');
      let max = 0;
      const ids = new Set(tasks.map(task => task.id));
      for (const id of ids) {
        const number = Number(/^t(\d+)$/.exec(id)?.[1]);
        if (Number.isSafeInteger(number) && number < Number.MAX_SAFE_INTEGER) max = Math.max(max, number);
      }
      let number = max + 1;
      if (ids.has(`t${number}`)) {
        number = 1;
        while (ids.has(`t${number}`)) number += 1;
      }
      return [...tasks, { id: `t${number}`, text: change.text, status: 'pending' }];
    }
    case 'clear': return [];
    case 'start':
    case 'done':
    case 'remove': {
      if (typeof change.id !== 'string' || !change.id) throw new Error('task change needs a task id');
      const id = tasks.some(task => task.id === change.id) || !/^\d+$/.test(change.id) ? change.id : `t${change.id}`;
      if (!tasks.some(task => task.id === id)) throw new Error(`no task ${id}`);
      if (change.action === 'remove') return tasks.filter(task => task.id !== id);
      const status = change.action === 'start' ? 'in_progress' : 'completed';
      return tasks.map(task => task.id === id ? { ...task, status } : task);
    }
    default: throw new Error('task change needs add, start, done, remove or clear');
  }
}
