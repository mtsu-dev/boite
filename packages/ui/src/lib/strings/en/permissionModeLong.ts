export const strings = {

  permissionModeLong: {
    default: 'Reads freely, asks before editing a file or running a command',
    acceptEdits: 'Edits files without asking, asks before running a command',
    bypassPermissions: 'Runs everything without asking, anywhere on this computer',
    yolo: 'Approves every tool request and skips Claude and Codex hooks (YOLO)',
    plan: 'Plan only, no changes',
    dontAsk: 'Deny anything that would need asking'
  }
} as const;
