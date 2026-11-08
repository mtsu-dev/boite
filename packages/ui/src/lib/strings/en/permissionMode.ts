export const strings = {

  /** Each mode named by what the agent does, so the picker's Permission row reads as a sentence. */
  permissionMode: {
    default: 'Ask before edits and commands',
    acceptEdits: 'Ask before running commands',
    bypassPermissions: 'Run without asking',
    yolo: 'No limits',
    plan: 'Plan only',
    dontAsk: 'Deny what needs asking'
  }
} as const;
