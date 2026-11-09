export const strings = {
  firstRun: {
    welcome: 'Boite runs your AI agents on your own machines.',
    heading: 'Open a project',
    deviceBody: 'Projects are opened from the app the core runs in. The ones it holds show up here.',
    pathPlaceholder: 'Absolute path of the folder',
    /** The agents a first run offers, as one choice. */
    agents: 'Agents',
    /** The three steps a first run shows, the first one to take now. */
    steps: 'Getting started',
    stepConnect: 'Connect an AI you already use',
    stepProject: 'Open a project folder',
    stepTask: 'Describe a task, the agent does it',
    /** An agent whose program is already on this machine. */
    installed: 'Installed',
    /** The last row of the first run's agents: the connect dialog's whole list. */
    others: 'Other agents',
    otherMachine: 'Connect another computer or a phone',
    /** Over the marks the lists use, each shown beside its word. */
    marks: 'In your lists, each thread wears its state',
    /** What each mark of the legend asks of you, beside its word. */
    marksWaiting: 'An answer or a permission waits for you',
    marksWorking: 'The agent is on it',
    marksFailed: 'It stopped: open it to see why',
  }
} as const;
