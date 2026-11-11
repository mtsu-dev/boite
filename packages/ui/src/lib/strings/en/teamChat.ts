export const strings = {
  /** The Teams section of the Bots page and a team's chat, where the owner talks with its bots (`docs/teams.md`). */
  teamChat: {
    heading: 'Teams',
    /** The Teams heading's button on the Bots page, and the empty line under it before the first team. */
    newTeam: 'New team',
    noTeams: 'No team yet: put a few bots in one chat.',
    /** On a paired phone, where creating a team and changing one stay on the computer (`docs/teams.md`). */
    onComputer: 'Only the computer running Boite can create or change teams.',
    /** The team chat header's menu. */
    menu: 'Team options',
    edit: 'Edit the team',
    pause: 'Pause',
    resume: 'Resume',
    archive: 'Archive',
    restore: 'Restore',
    pausedShort: 'Paused',
    archivedShort: 'Archived',
    archiveTitle: 'Archive {team}?',
    archiveBody: 'Its chat stays readable. It takes no more posts, and letters still waiting for its bots are dropped.',
    /** The dialog that creates a team by hand, or edits one: name, brief and members. */
    dialog: {
      createTitle: 'New team',
      editTitle: 'Edit {team}',
      intro: 'A few bots and you in one chat. Each bot answers from its own thread.',
      name: 'Name',
      namePlaceholder: 'Launch crew',
      brief: 'Brief',
      briefHint: 'What the team is for. Every member reads it.',
      briefPlaceholder: 'Optional',
      members: 'Members',
      selected: '{count} of {max}',
      create: 'Create the team',
      creating: 'Creating',
      save: 'Save',
      saving: 'Saving',
      noBots: 'This machine has no bots yet: create one first.',
      nameRequired: 'Give the team a name.',
      nameAt: 'A team name does not start with @.',
      nameTaken: 'A team is already named {name}.',
      membersRequired: 'Pick at least one bot.',
      localRequired: 'Pick a bot of this machine too: it holds the team.',
      /** Why a bot cannot be picked, in the small tooltip beside it. */
      otherMachine: "On {machine}: a team takes the bots of this machine's group.",
      moving: 'Moving to another machine: it joins no team until it has arrived.',
      full: 'A team holds at most {max} bots.',
      archived: 'The team is archived: restore it to add a bot.',
      gone: 'No longer a bot of this machine: unselect it to take it out.',
      goneOut: 'No longer a bot of this machine: it leaves the team when you save.',
      vanished: '{team} is no longer on this machine.',
      why: 'Why {name} cannot join',
    },
    /** Under the team's name over its chat: what the place is and who talks there. */
    room: 'Team chat',
    roomOne: 'Team chat · one bot and you',
    roomMany: 'Team chat · {count} bots and you',
    /** The team's members, in the band over its chat and in a row of the list. */
    members: 'Members',
    /** The owner, as the author of a post. */
    you: 'You',
    /** The owner named inside a sentence: "Private to you", "Replying to you". */
    youInText: 'you',
    paused: 'Paused: posts wait and reach the bots when the team resumes.',
    archived: 'This team is archived and takes no more posts.',
    /** In the composer's place when the core does not answer for the team: the Teams experiment off, or an older core. */
    unavailable: 'Posting here needs the Teams experiment, in the desktop app under Settings, Experiments.',
    empty: 'No posts yet. Write to the whole team, or name a bot with {mention}.',
    earlier: 'Show earlier posts',
    newer: 'Show newer posts',
    loading: 'Loading the posts',
    /** A post only its author, its one recipient and the owner read. */
    privateTo: 'Private to {name}',
    replyTo: 'In reply to {name}',
    reply: 'Reply',
    /** Who a post woke, under it. */
    woke: 'Woke {names}',
    wokeEveryone: 'Woke everyone',
    /** Under an owner post from before a post naming nobody woke the whole team. */
    nobody: 'Woke nobody',
    composer: {
      placeholder: 'Write to the team',
      placeholderPrivate: 'Write to {name} only',
      send: 'Send',
      sending: 'Sending',
      audience: 'Who reads it',
      everyoneReads: 'Whole team',
      onlyReads: 'Only {name}',
      mention: 'Name a bot',
      /** The mention that wakes every member: the core reads both @tous and @everyone. */
      everyone: '@everyone',
      everyoneLabel: 'Everyone',
      /** The `@name` placeholder in the hints. */
      name: '@name',
      replying: 'Replying to {name}',
      cancelReply: 'Cancel the reply',
      wakes: 'Wakes {names}',
      wakesEveryone: 'Wakes everyone',
      wakesReply: 'Wakes {name}, whose post this answers',
      wakesPrivate: 'Only {name} reads it and is woken.',
      tooLong: 'Too long: {max} characters at most.',
    },
  },
} as const;
