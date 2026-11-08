export const strings = {
  firstRun: {
    welcome: 'Boite runs your AI agents on your own machines.',
    heading: 'Open a project',
    deviceBody: 'Projects are opened from the app the core runs in. The ones it holds show up here.',
    pathPlaceholder: 'Absolute path of the folder',
    /** The agents a first run offers, as one choice. */
    agents: 'Agents',
    /** An agent whose program is already on this machine. */
    installed: 'Installed',
    go: 'Continue with {provider}',
    /** The quiet way out for a machine that will not run its own agents. */
    otherMachine: 'Use an AI on another machine',
  }
} as const;
