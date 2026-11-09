export const strings = {

  thread: {
    recoveryTitle: 'Prompt saved before restart',
    recoveryBody: 'This prompt has not been sent to the agent. Resume it with its saved model and account, or remove it from the queue.',
    recoveryTarget: 'Saved selection: {model} · {account}',
    recoveryResume: 'Resume prompt',
    recoveryDiscard: 'Remove from queue',
    retryCapacityTitle: 'Model at capacity',
    retryCapacityBody: 'Trying again in {time}, try {attempt} of {attempts}.',
    retryCapacityCancel: 'Stop retrying',
    retryLimitTitle: 'Usage limit reached',
    retryLimitBody: 'Resumes at {time}, once the limit has reset, in {in}.',
    retryLimitCancel: 'Do not resume',
    retryContinueTitle: 'Stopped before its answer',
    retryContinueBody: 'Resumes by itself in {time}, resume {attempt} of {attempts}.',
    contextDetails: 'Context',
    /** The composer's context reading at rest, beside its ring. */
    contextLeft: (percent: string) => `${percent}% context left`,
    contextLeftNamed: (percent: string) => `Context: ${percent}% left`,
    contextInput: 'Input',
    contextCache: 'Cached input',
    contextOutput: 'Output',
    contextUsed: 'Used',
    contextTokens: 'tokens',
    contextRemaining: (tokens: string) => `${tokens} tokens available`,
    contextRemainingCompact: (tokens: string) => `${tokens} tokens before auto-compaction`,
    contextAutoCompact: 'Auto-compaction threshold.',
    contextAutoCompactWindow: (window: string) => `Auto-compaction threshold. The model supports ${window} tokens.`,
    contextNoBreakdown: 'This agent does not report a breakdown.',
    contextNoReading: 'No measurement received from this agent yet.',
    contextMeasured: 'Last measurement',
    contextCompactions: 'Compactions',
    contextPrompts: 'Messages sent',
    cacheTitle: 'Prompt cache',
    cacheChipWarm: (left: string) => `Prompt cache warm, about ${left} left`,
    cacheChipMaybe: (most: string) => `Prompt cache maybe still warm, ${most} at most`,
    cacheChipCold: 'Prompt cache cold',
    cacheCold: 'cold',
    cacheLeft: (left: string) => `${left} left`,
    cacheMaybe: (left: string) => `maybe · ${left}`,
    cacheSwitched: 'Model or account changed.',
    cacheLifetime: 'Lifetime',
    cacheSourceReported: 'API',
    cacheSourceDocumented: 'docs',
    cacheRange: (lifetime: string, most: string) => `${lifetime} to ${most}`,
    cacheReadLast: 'Read last turn',
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    none: 'No thread open',
    noneBody: 'Pick one on the left, or start a new one.',
    trace: 'Trace',
    /** The header's button: it shows or hides the panel, whatever surface is in it. */
    panel: 'Panel',
    /** The closed door's tooltip: what a panel is, before its key. */
    panelHint: "Panels: this thread's changes, files, browser and tools, beside the chat",
    panelMenu: 'Panels',
    /** The open door, which names the panel and switches it. */
    panelSwitch: '{name}: switch or close the panel',
    /** A thread menu's second level, named by what a user does there: the bot rows, then the folder (branch, move, path, pull request). The new title sits by Rename. */
    manage: 'Move to a project or a bot',
    /** The same with no bot row (bots off, none to give it to). */
    manageNoBot: 'Move to a project',
    /** The same with no move row (a phone that cannot move it, a thread that cannot move). */
    manageNoFolder: 'Give to a bot',
    /** The same with neither: the folder's branch, path and pull request. */
    manageTitle: 'Folder and branch',
    /** A desktop header's project crumb: back to the thread list, at this thread. */
    backToList: 'Back to the {project} threads',
    terminalHint: "Terminal in this thread's folder",
    cwd: 'Working directory',
    model: 'Model',
    defaultModel: 'Default model',
    renamePlaceholder: 'Thread title',
    /** The draft's own heading, the project's name in the dropdown after it. */
    start: 'Start a thread',
    inWorktree: 'in a worktree',
    inProject: 'in',
    /** Before the machine the draft's project is on, which ends the heading. */
    onMachine: 'on',
    /** Under a desktop draft's heading: what starting here does. The mode, model and effort are the chips' to say. */
    startHint: 'Describe a task below: the agent works in this folder.',
    /** The same with the folder's whole path, so where it runs reads in full; the heading already names the machine. */
    startWhere: 'Describe a task below: the agent works in {path}.',
    draftMode: {
      default: 'with approval requests',
      acceptEdits: 'with edits allowed',
      bypassPermissions: 'with all permissions',
      yolo: 'with tool approvals bypassed',
      plan: 'in plan mode',
      dontAsk: 'with automatic denial of approval requests'
    },
    changeProject: 'Change project',
    /** The project dropdown's search field and what it says when no project matches. */
    searchProjects: 'Search projects',
    noProjectMatch: 'No project matches "{query}"',
    /** The header badge of a thread working in its own worktree; the title says where. */
    branchHint: 'Working on this branch in its own folder',
  }
} as const;
