export const strings = {

  /** The panel on the right of the chat: its tab strip, its launcher, its surfaces. */
  rightPanel: {
    chat: 'Chat',
    backToChat: 'Back to chat',
    resize: 'Resize the panel, double-click to reset',
    maximize: 'Maximize the panel',
    restore: 'Restore the panel',
    newSurface: 'Open a surface',
    scrollLeft: 'Scroll the tabs left',
    scrollRight: 'Scroll the tabs right',
    closeTab: 'Close {title}',
    closeOthers: 'Close others',
    closeToRight: 'Close to the right',
    closeAll: 'Close all',
    trace: 'Trace',
    browser: 'Browser',
    changes: 'Changes',
    files: 'Files',
    file: 'File',
    tasks: 'Tasks',
    device: 'Device',
    window: 'Window',
    ownerOnly: "Only in the owner's app",
    launcher: 'Open a surface in this panel',
    untitled: 'Browser',
    /** The strip's own entries: the drawers it opens, the rest of the surfaces, what a count says. */
    terminal: 'Terminal',
    board: 'Board',
    more: 'More',
    changesCount: '{count} files',
    agentsCount: '{count} at work',
    messages: 'Messages',
    /** The list beside the title bar's panel button: every surface and drawer by name. */
    launcherMenu: 'Open in the panel',
  }
} as const;
