export const strings = {
  /** The Teams section of the lists and a team's chat, where the owner talks with its bots (`docs/teams.md`). */
  teamChat: {
    heading: 'Teams',
    /** Folded, the section's title says how many chats wait unread. */
    unread: '{count} unread',
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
    empty: 'No posts yet. Name a bot with {mention}, or everyone with {everyone}.',
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
    nobody: 'Nobody was pinged: name a bot with {mention}, or everyone with {everyone}.',
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
      wakesNobody: 'Wakes nobody: name a bot with {mention}, or everyone with {everyone}.',
      wakesPrivate: 'Only {name} reads it and is woken.',
      tooLong: 'Too long: {max} characters at most.',
    },
  },
} as const;
