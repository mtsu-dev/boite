export const strings = {

  /** The rich presence a chat app shows of this desktop app (`lib/presence/`), and its settings under the experiment's switch. */
  presence: {
    idle: 'Idle',
    workingOn: 'Working on {project}',
    workingOnMore: 'Working on {project} +{more}',
    oneAgent: 'Coding with an agent',
    agents: 'Directing {count} agents',
    agent: '1 agent',
    agentCount: '{count} agents',
    waiting: '{count} waiting',
    button: 'Get Boite',
    showProjects: 'Show project names',
    showProjectsHint: 'Your friends see which project the agents work on. Off: only how many agents work, on which models',
    preview: 'What your friends see',
    playing: 'Playing',
    elapsed: '{time} elapsed',
    none: 'No chat app is listening on this computer. Open Discord, Vesktop or another client with rich presence: it shows up within 15 seconds',
    shownIn: 'Shown in {apps}',
    unnamed: 'a client without an account name',
    elsewhere: 'Shows only from the desktop app, connected to the Boite on this computer'
  }
} as const;
