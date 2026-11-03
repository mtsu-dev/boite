export const strings = {
  /** A debate between AIs (`docs/debates.md`): its card in the thread that started it, and the salon where the owner follows it. */
  debates: {
    /** The salon's tab in the right panel. */
    salon: 'Debate',
    title: 'Debate · {topic}',
    /** Under the card's title: who takes part. */
    cast: '{count} AIs and you',
    roundOf: 'Round {round} of {rounds}',
    /** The salon's header, shorter. */
    roundShort: 'Round {round} / {rounds}',
    /** Before the first round is asked. */
    starting: 'Starting',
    summarizing: 'Writing the summary',
    done: 'Done · summary ready',
    stopped: 'Stopped',
    failed: 'Failed',
    open: 'Open the salon',
    /** Over the summary on the card, once it reached the thread. */
    summaryBack: 'Summary by {name}, back in the thread',
    /** The debaters read each other under letters; only the owner sees the names. */
    anonymous: 'Anonymous opinions for the AIs',
    /** The summarizer's chip: it reads the whole debate but took no part in it. */
    summarizer: 'Summary: {name} (not in the debate)',
    you: 'You',
    members: 'Who takes part',
    /** The rounds bar, for a screen reader. */
    roundsPlayed: '{round} of {rounds} rounds played',
    /** The line between rounds, by what the round asks. */
    blind: 'Round {round} · each proposes without reading the others',
    reply: 'Round {round} · they answer each other',
    vote: 'Round {round} · each votes',
    toOne: 'To {name} only',
    replyTo: 'In reply to {name}',
    votedFor: 'Votes for {proposal}',
    verdict: 'Debate summary · {name}',
    proposal: 'Proposal',
    votes: 'Votes',
    voteCount: '{votes} / {of}',
    /** Who has not answered the round yet. */
    writingOne: '{name} is writing…',
    writingMany: '{names} are writing…',
    allAnswered: 'Everyone answered.',
    allVoted: 'Everyone voted.',
    summaryWriting: '{name} is writing the summary…',
    concluding: 'The summary follows this round.',
    closed: 'Debate closed. The summary went back to the thread.',
    next: 'Next round',
    nextHint: 'Close this round now: whoever has not answered is absent from it',
    conclude: 'Conclude and summarize',
    concludeHint: 'Let this round finish, then write the summary',
    stop: 'Stop the debate',
    placeholder: 'Write to the salon · @ to address one AI',
    send: 'Send',
    sending: 'Sending',
    /** The `@` list over the composer. */
    mention: 'Address one AI',
    readsAll: 'Every AI reads it next round.',
    readsOne: 'Only {name} reads it, next round.',
    tooLong: 'Too long: {max} characters at most.',
    /** In the composer's place once nothing more is read. */
    over: 'The debate is over: the salon takes no more messages.',
    summarizingClosed: 'The summary is being written: the salon takes no more messages.',
    loading: 'Loading the debate',
    missing: 'This debate no longer exists.',
    /** The core does not answer for debates: the experiment off on the desktop, or an older core. */
    unavailable: 'Following a debate needs the AI debates experiment, in the desktop app under Settings, Experiments.',
    empty: 'The debaters are thinking. Their first proposals appear here.',
  },
} as const;
