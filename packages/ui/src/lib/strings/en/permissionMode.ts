export const strings = {

  permissionMode: {
    default: 'Ask each time',
    acceptEdits: 'Auto-approve edits',
    bypassPermissions: 'Smart auto',
    yolo: 'Full access',
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
