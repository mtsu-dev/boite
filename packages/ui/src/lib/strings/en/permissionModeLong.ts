export const strings = {

  permissionModeLong: {
    /** One line under each name in the mode menu: what the mode lets through. */
    default: 'Reads freely, asks before each edit or command',
    acceptEdits: 'Edits without asking, asks before each command',
    bypassPermissions: 'Runs anything on this computer; hooks still check',
    yolo: 'Approves every request; Claude and Codex hooks off',
    plan: 'Plans only, changes nothing',
    dontAsk: 'Denies anything that would need asking'
  }
} as const;
