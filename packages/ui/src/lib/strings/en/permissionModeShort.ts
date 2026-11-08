export const strings = {

  /** The permission chip's one word per mode; the menu row says the rest on its second line. */
  permissionModeShort: {
    default: 'Ask',
    acceptEdits: 'Edit freely',
    bypassPermissions: 'Auto',
    yolo: 'No limits',
    plan: 'Plan',
    dontAsk: 'Auto-deny',
    /** Codex writes inside the folder on its default mode: the chip says so instead of "Ask". */
    codexDefault: 'This folder'
  }
} as const;
