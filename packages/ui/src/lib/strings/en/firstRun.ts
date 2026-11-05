export const strings = {
  firstRun: {
    heading: 'Open a project',
    deviceBody: 'Projects are opened from the app the core runs in. The ones it holds show up here.',
    pathPlaceholder: 'Absolute path of the folder',
    /** The empty app's two steps, in the home card and the phone's list. Plain words: no "provider", "worktree" or "draft". */
    welcome: 'Welcome to Boite',
    welcomeBody: 'Two steps and an AI can start working for you.',
    steps: 'Getting started',
    connect: 'Connect an AI',
    connectHint: 'Sign in with Claude, ChatGPT or another assistant you already pay for.',
    connected: 'AI connected',
    folder: 'Pick a folder',
    folderHint: 'The AI works on the files inside it. Only that folder.',
    folderReady: 'Folder ready',
    skipFolder: 'Start without a folder',
    doneStep: 'Done',
    stepNumber: 'Step {index}',
    /** A paired phone or browser cannot connect an AI itself: the computer it reaches does. */
    elsewhere: 'Connect an AI and pick a folder in Boite on your computer first.',
  },
  /** The home's list of what waits on the user and what works, under the composer, and the phone's Inbox tab. */
  inbox: {
    label: 'Inbox',
    needsYou: 'Needs you',
    /** The heading's numbers: the threads, as the sidebar's Needs you counts them, and the bots apart. */
    threadsCount: '{count} threads',
    botsCount: '{count} from bots',
    bot: 'Bot',
    workingNow: 'Working now',
    nothing: 'Nothing needs you',
    more: '{count} more',
    fewer: 'Show less',
    /** Threads waiting on a machine that is not connected: listed apart, muted, never counted. */
    offline: 'Offline',
    offlineHint: 'Waiting on a machine that is not connected. Not counted until it is back.',
    reasons: {
      question: 'Asks you',
      permission: 'Wants your permission',
      secret: 'Needs a key',
      'sign-in': 'Needs you to sign in',
      failed: 'Turn failed',
      interrupted: 'Stopped before the end'
    },
    /** The same reasons in one word, for a phone row that also holds the place and the wait. */
    reasonTags: {
      question: 'Question',
      permission: 'Permission',
      secret: 'Key',
      'sign-in': 'Sign-in',
      failed: 'Failed',
      interrupted: 'Stopped'
    },
    /** How long a card has waited and a row has worked, beside it and in full in its label. */
    waited: 'Waiting for {time}',
    working: 'Working for {time}',
    open: 'Open {title}',
    minutes: '{count}m',
    hours: '{count}h {minutes}m',
    days: '{count}d',
  }
} as const;
