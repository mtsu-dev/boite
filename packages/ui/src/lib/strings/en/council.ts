export const strings = {
  /** A council (`docs/internals/council.md`): its card in the thread that started it, and the salon where the owner follows it. */
  council: {
    /** The salon's tab in the right panel. */
    salon: 'Council',
    title: 'Council · {topic}',
    /** Under the card's title: who takes part. */
    cast: '{count} AIs and you',
    /** The round under way, on the card's chip and in the salon's header. */
    round: 'Round {round}',
    /** Before the first round is asked. */
    starting: 'Starting',
    /** On the card's chip: the round is over and nothing runs until the thread asks another. */
    waiting: 'Round {round} done',
    done: 'Closed',
    stopped: 'Stopped',
    failed: 'Failed',
    open: 'Open the salon',
    you: 'You',
    members: 'Who takes part',
    /** The line over a round's answers: no member reads another's. */
    divider: 'Round {round} · each reviews alone',
    /** The line over messages the next round will read, before it starts. */
    nextRound: 'For the next round',
    toOne: 'To {name} only',
    replyTo: 'In reply to {name}',
    /** Who wrote what changed between two rounds: the thread that started the council. */
    author: 'The thread',
    /** Who wrote the last post of a debate from before the council. */
    summary: 'Summary',
    /** Who has not answered the round yet. */
    writingOne: '{name} is writing…',
    writingMany: '{names} are writing…',
    allAnswered: 'Everyone answered.',
    /** Between two rounds. */
    betweenRounds: 'Round {round} is done. The thread that started the council decides what comes next.',
    closed: 'Council closed. Its reviews went back to the thread.',
    closeRound: 'Close this round',
    closeRoundHint: 'Close this round now: whoever has not answered has no score in it',
    stop: 'Stop the council',
    placeholder: 'Write to the salon · @ to address one AI',
    send: 'Send',
    sending: 'Sending',
    /** The `@` list over the composer. */
    mention: 'Address one AI',
    readsAll: 'Every AI reads it next round.',
    readsOne: 'Only {name} reads it, next round.',
    tooLong: 'Too long: {max} characters at most.',
    /** In the composer's place once nothing more is read. */
    over: 'The council is over: the salon takes no more messages.',
    loading: 'Loading the council',
    missing: 'This council no longer exists.',
    /** The core does not answer for councils: the experiment off on the desktop, or an older core. */
    unavailable: 'Following a council needs the Council experiment, in the desktop app under Settings, Experiments.',
    empty: 'The members are reviewing. Their answers appear here.',
    /** The table of scores, as `councilTable` writes it. */
    table: {
      title: 'Council review',
      rounds: 'Rounds: {count}',
      delegate: 'Delegate',
      round: 'Round {round}',
      noScore: 'no score',
    },
  },
} as const;
