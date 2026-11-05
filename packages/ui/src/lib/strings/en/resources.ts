export const strings = {
  resources: {
    memory: 'Memory',
    resolved: (mb: number) => `${Math.round(mb)} MB`,
    auto: (mb: number) => `Auto: ${Math.round(mb)} MB`,
    agents: 'Agents / budget',
    available: 'Available / reserve',
    unknown: 'Not available',
    state: 'Protection status',
    states: { ok: 'Enough memory', critical: 'Memory limit crossed' },
    killTitle: 'Memory limit reached',
    /** The notice's one line read whole: what happened and the limit, its reason behind the disclosure. */
    killLimit: (limit: string) => `Stopped at the memory limit: ${limit}`,
    killCount: (count: number, limit: string) => `${count} stopped at the memory limit: ${limit}`,
    /** The notice's line: what happened, not only the limit, which stands whole beside it: `Stopped at the memory limit · 9.5 GB`. */
    killLine: (count: number) => count > 1 ? `${count} stopped at the memory limit` : 'Stopped at the memory limit',
    /** The same on a phone-narrow line, short enough to read whole at 360 px: `Stopped at limit · 9.5 GB`. */
    killLineShort: (count: number) => count > 1 ? `${count} stopped at limit` : 'Stopped at limit',
    stoppedProcesses: (count: number) => `Show ${count} stopped processes`,
    memorySettings: 'Memory settings',
    protectionOff: 'Memory protection is off',
    killReason: {
      'thread-quota': (limit: string) => `This conversation exceeded its ${limit} memory limit.`,
      budget: (limit: string) => `The agents exceeded their ${limit} shared memory budget.`,
      machine: (limit: string) => `Available memory fell below the ${limit} reserve.`,
    },
    threadCap: 'This conversation reached its memory limit. Boite refused more memory.',
    budget: 'The agents reached their shared memory budget. Boite refused more memory.',
    throttled: (limit: string) => `This conversation's processes are slowed by their ${limit} memory limit. They stall instead of failing.`,
    empty: 'Nothing is running right now.',
    processes: 'processes',
    killTree: 'Kill tree',
    killConfirm: 'Kill every process of this thread?',
    killConfirmYes: 'Kill',
  }
} as const;
