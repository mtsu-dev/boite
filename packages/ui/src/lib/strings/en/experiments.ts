export const strings = {

  experiments: {
    whip: {
      title: 'Whip',
      hint: 'An animated whip follows your pointer or finger. Flick to crack it, click or tap to drop it',
      action: 'Throw the whip',
      drop: 'Drop the whip',
      off: 'The whip needs animations, which are off in your system settings (Windows: Accessibility > Visual effects > Animation effects)'
    },
    contacts: {
      title: 'Contacts',
      hint: 'A Home page beside Threads where you link your Boite with another owner\'s through Tailscale. A built-in mochi, the Operator, carries every request between your agents and theirs. Not ready for everyday use'
    },
    autoGoal: {
      title: 'Automatic goals',
      hint: 'A long prompt starts a reviewed goal on itself, with its checklist and a card on the project board, and the agent may start one when a prompt lists several requests. Remove the goal from the goal bar to drop it',
      minChars: 'Prompt length',
      minCharsHint: 'A prompt that starts a turn with at least this many characters starts an automatic goal',
      unit: 'characters'
    },
    teams: {
      title: 'Teams',
      hint: 'Mochis that work together in a shared chat, listed above them on the Mochis page: a post wakes the mochis it names, and each answers in the group or privately. Your mochis post with boite team. Not ready for everyday use'
    },
    debates: {
      title: 'Council',
      hint: 'Your agents can ask several AIs to review a piece of work or a plan with boite delegate council, each alone and read-only. You follow them in a salon and may write there; the thread that started it gets their answers and scores. Not ready for everyday use'
    }
  }
} as const;
