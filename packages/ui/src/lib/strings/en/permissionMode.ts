export const strings = {

  permissionMode: {
    default: 'Ask each time',
    acceptEdits: 'Auto-approve edits',
    /** The two run-everything modes differ in one thing, said in the name: whether the hooks and guards still check each call. */
    bypassPermissions: 'Run everything, guards on',
    yolo: 'Full access, no guards',
    plan: 'Plan',
    dontAsk: 'Auto-deny'
  },
  /** The names the modes had before, kept in their tooltips so a habit still finds them. */
  permissionModeWas: {
    default: 'Ask',
    acceptEdits: 'Edit freely',
    bypassPermissions: 'Auto',
    yolo: 'YOLO',
    plan: 'Plan',
    dontAsk: 'Auto-deny',
    line: 'Formerly {name}'
  }
} as const;
