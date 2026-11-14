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
    tasks: 'Goal and todos',
    device: 'Device',
    window: 'Window',
    ownerOnly: "Only in the owner's app",
    launcher: 'Open a surface in this panel',
    untitled: 'Browser',
    /** The open door's last row on a desktop, beside the head's own close. */
    closePanel: 'Close the panel',
    /** The panel launcher's search (PanelSwitcher.svelte), and what it says when nothing matches. */
    findPanel: 'Find a panel',
    noPanelMatch: 'No panel matches',
    /** The plain line under every panel's name in the launcher: what it holds. The board and the goal read apart by whose work it is. */
    roles: {
      board: "The whole project's todos, in columns", tasks: "This thread's goal, loop, todos and watches",
      trace: 'The programs this thread runs', messages: 'What this agent and other agents wrote each other',
      coordination: 'Let other agents find and message this thread',
      changes: 'What this thread changed in the code, file by file', files: "Browse and read the project's files",
      browser: 'The web page this thread and its agent look at', device: 'A phone or emulator screen the agent drives',
      desk: "This mochi's work now, its routines and its memory", agents: 'The helper agents this thread started',
      terminal: "A command line in the project's folder", customize: 'Choose which panels this list offers'
    },
    /** The launcher's groups: the panels this thread used, newest first, then every panel by family. */
    groups: { used: 'Used in this thread', work: 'Work', agents: 'Agents', tools: 'Tools' },
    /** A renamed row's tooltip: the name it had before. */
    formerly: {
      trace: 'Formerly Trace', tasks: 'Formerly Task manager', messages: 'Formerly Discussions',
      coordination: 'Formerly Thread links', customize: 'Formerly Choose the buttons'
    }
  }
} as const;
