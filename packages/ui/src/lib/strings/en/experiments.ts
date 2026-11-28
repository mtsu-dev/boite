export const strings = {

  /** The title and hint of each experiment with a switch, by its id (`lib/experiment-copy.ts`). */
  experiments: {
    'draft-backdrop': {
      title: 'New thread background',
      hint: 'An animated scene in the manner of an early 2000s console behind the empty new thread screen. Pick it under Appearance. Respects reduced motion'
    },
    contacts: {
      title: 'Contacts',
      hint: 'A Home page beside Threads where you link your Boite with another owner\'s through Tailscale. A built-in mochi, the Operator, carries every request between your agents and theirs. Applies to this machine. Not ready for everyday use'
    },
    teams: {
      title: 'Teams',
      hint: 'Mochis that work together in a shared chat, listed above them on the Mochis page: a post wakes the mochis it names, and each answers in the group or privately. Your mochis post with boite team. Not ready for everyday use'
    },
    'auto-goal': {
      title: 'Automatic goals',
      hint: 'A long prompt starts a reviewed goal on itself, with its checklist and a card on the project board. Remove the goal from the goal bar to drop it. Applies to this machine. Not ready for everyday use'
    },
    'session-import': {
      title: 'Session import',
      hint: 'Open a Claude Code or Codex session started outside Boite as a thread, from the command palette. Not ready for everyday use'
    },
    'background-compaction': {
      title: 'Background compaction',
      hint: 'Automatic compactions run on a copy of the conversation while the agent keeps working, and the thread moves to it when it is ready. Applies to this machine. Not ready for everyday use'
    },
    'device-stream': {
      title: 'Live device stream',
      hint: 'The Device panel plays an Android phone plugged into this machine as live video through scrcpy, and sends touches, keys, text and the clipboard through it. Applies to this machine. Not ready for everyday use'
    },
    'discord-presence': {
      title: 'Discord rich presence',
      hint: 'Shows Playing Boite in your Discord profile, with what your agents are doing: their number, their models and how long they have been working. Works with Discord, Vesktop, Legcord and the other clients that read rich presence, and with any app that reads the same socket, such as the bridges to Fluxer. Desktop app only'
    }
  }
} as const;
