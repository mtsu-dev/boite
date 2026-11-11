export const strings = {

  /** The menu row's one line under the mode's word: what the agent then does, as a consequence. */
  permissionModeLine: {
    default: 'Asks before it edits a file or runs a command',
    acceptEdits: 'Edits files on its own, asks before commands',
    bypassPermissions: 'Runs everything without asking',
    yolo: 'Approves every request, without exception',
    plan: 'Plans only, changes nothing',
    dontAsk: 'Refuses anything that needs asking'
  }
} as const;
