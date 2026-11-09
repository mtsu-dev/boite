export const strings = {

  /** The panel on the right of the chat: its tab strip, its launcher, its surfaces. */
  rightPanel: {
    backToChat: 'Back to chat',
    resize: 'Resize the panel, double-click to reset',
    maximize: 'Maximize the panel',
    restore: 'Restore the panel',
    scrollLeft: 'Scroll the tabs left',
    scrollRight: 'Scroll the tabs right',
    closeTab: 'Close {title}',
    closeOthers: 'Close others',
    closeToRight: 'Close to the right',
    closeAll: 'Close all',
    trace: 'Processes',
    browser: 'Browser',
    changes: 'Changes',
    files: 'Files',
    file: 'File',
    tasks: 'Task manager',
    device: 'Device',
    window: 'Window',
    ownerOnly: "Only in the owner's app",
    launcher: 'Open a surface in this panel',
    untitled: 'Browser',
    /** A line under the two lists of work to do, so they read apart. */
    roles: { board: "The project's todos in columns", tasks: "This thread's goal, checklist and watches" },
    /** The selector's groups: the panels picked last, then every panel by family. */
    groups: { recent: 'Recent', work: 'Work', agents: 'Agents', tools: 'Tools' },
    /** A renamed row's tooltip: the name it had before. */
    formerly: {
      trace: 'Formerly Trace', tasks: 'Formerly Tasks', messages: 'Formerly Discussions',
      coordination: 'Formerly Thread links', customize: 'Formerly Choose the buttons'
    }
  }
} as const;
