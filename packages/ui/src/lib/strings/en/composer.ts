export const strings = {

  composer: {
    /** Above the box while a sent message is being edited. */
    editing: 'Editing a sent message: sending replaces it and everything after it',
    editingQueued: 'Send or remove the queued messages before replacing a sent message.',
    draftCleared: 'Draft cleared',
    draftReplaced: 'Draft replaced',
    editUnavailable: "This thread's provider is unavailable. Reconnect it before editing a sent message.",
    filesUnavailable: 'The messages were rewound, but this edit has no complete file backup. The code could not be restored.',
    filesBusy: 'The messages were rewound. Another agent is still working in this folder, so the files were left as they are.',
    editingCancel: 'Stop editing (Esc)',
    /** The box while the agent works: what is written answers. One line on a 360 px phone. */
    replyPlaceholder: 'Reply to {name}',
    /** The box while a question at its top takes a written answer beside its options, or alone: Send reads Answer and answers it. */
    answerPlaceholder: 'Or type your own answer',
    answerTextPlaceholder: 'Type your answer',
    /** The box while a question at its top takes no text: a message is queued until the answer. */
    afterAnswerPlaceholder: 'A message waits until you answer',
    /** The box while a permission waits on its command row in view, beside its Deny and Allow once. One line on a 360 px phone. */
    permissionPlaceholder: 'Or tell {name} what to do instead',
    /** Send while a permission waits and the box holds text: it denies the permission, stops the turn and sends the message as the next one. */
    declineSend: 'Decline and send',
    /** Its tooltip, the permission named by its title ("Push orbit/csv-import"). */
    declineSendHint: 'Declines {title}, then sends your message',
    declineSendHintFallback: 'Declines this request, then sends your message',
    switchTitle: 'Switch a {tokens} token thread to {provider}?',
    switchBody: '{provider} starts a new session and receives excerpts of the opening and of the most recent exchanges, about 20k tokens. The rest is lost to it. Compacting first changes nothing.',
    switchConfirm: 'Switch',
    switchCancel: 'Stay on {provider}',
    cacheTitle: 'Rebuild the cache of a {tokens} token thread?',
    cacheBody: 'This change may make the provider process the whole conversation again uncached on the next turn, using more quota. Changing a model or reasoning effort can affect the cache, as can enabling Claude Fast mode for the first time.',
    cacheConfirm: 'Change',
    cacheCancel: 'Keep as is',
    options: 'Add to the message',
    mentionFile: 'Mention a file',
    commands: 'Commands',
    /** A mochi's model, effort and permission chips: read at rest, changed in its settings. */
    botSettings: "Set in {name}'s settings",
    /** The same chips while the mochi's account is gone: the banner above holds the remedy. */
    botAccountGone: "{name}'s account was removed. Pick another account to continue.",
    /** The box at rest, on a new conversation or one under way: who reads the message. */
    placeholder: 'Message {name}',
    /** `{name}` in the two placeholders when the provider is unknown. */
    placeholderAgent: 'the agent',
    /** The field while the account behind the box is removed: it stays locked until another is picked. */
    placeholderPickAccount: 'Pick another account to send',
    placeholderOffline: '{machine} is offline: messages wait here and go out when it reconnects',
    placeholderOfflineDraft: '{machine} is offline: the conversation starts when it reconnects',
    /** The field under that notice: what Send does, the notice having said offline. */
    placeholderAway: 'Sends when {machine} is back',
    /** The notice over the box of a thread whose machine is out of reach, with Reconnect. */
    machineOffline: '{machine} is offline',
    machineOfflineHint: 'Messages sent now wait on this device and go out in order once {machine} answers again.',
    /** The foot's row while a permission waits out of view: what waits, by its title, and the way back to it. */
    footDecision: 'Waiting for approval:',
    footDecisions: '{count} decisions waiting:',
    footShowHint: 'Scroll to the command that asks',
    /** The strip over the composer, the same on every screen: what this conversation waits on (`delegation.waiting`); a press unfolds it. */
    stripOpen: 'Show each one',
    stripClose: 'Fold into one line',
    /** The strip's Stop, worded by what it stops, its tooltip saying the rest. */
    stopAgent: 'Stop agent',
    stopAgentHint: 'Stops the agent\'s turn',
    stopAll: 'Stop all',
    stopAllHint: 'Stops the agent\'s turn and everything it waits on',
    stopSubagents: 'Stop subagents',
    stopSubagentsHint: 'Stops the work this conversation sent and waits on. The agent itself is not stopped.',
    stopWorkflows: 'Stop workflows',
    stopWorkflowsHint: 'Stops the workflows this conversation waits on. The agent itself is not stopped.',
    stopSent: 'Stop all',
    stopSentHint: 'Stops the subagents and workflows this conversation waits on. The agent itself is not stopped.',
    send: 'Send',
    sendWhenLoaded: 'Sends once the files are ready',
    stop: 'Stop',
    queued: 'Sent after the next tool, or when the turn ends',
    /** A refused send held the pending messages until the user sends again. */
    queuedPaused: 'Held after a refused send',
    sendNow: 'Send now',
    sendNowHint: 'Stops the current turn and sends pending messages. Enter in the empty composer does the same.',
    retryQueuedHint: 'Sends all pending messages together again. Enter in the empty composer does the same.',
    /** The outbox: messages written while the machine was away, kept on this device. */
    outboxKept: 'Kept on this device and sent in order, once each',
    outboxStarts: 'Kept on this device: the conversation starts once {machine} is back',
    outboxWaiting: 'Waiting for {machine}',
    outboxNext: 'Goes out when the thread is free',
    outboxSending: 'Sending',
    outboxFailed: 'Not sent: {reason}',
    outboxRetry: 'Send again',
    outboxSettings: 'The model and effort it was written with could not be set again.',
    removeQueued: 'Delete this pending message',
    picker: 'Provider and model',
    models: 'Models',
    searchModels: 'Search models',
    noModels: 'No model matches',
    noModelsAvailable: 'The agent has not listed any models. Refresh to retry.',
    showAllModels: 'Show all {count} models',
    legacyModels: 'Legacy models',
    refreshModels: 'Refresh models',
    probing: "Reading the agent's models",
    notInstalled: 'Not installed on this machine',
    installInSettings: 'Install in Settings',
    /** The effort chip and its slider: one short word, the levels say the rest. */
    effortTitle: 'Effort',
    speed: 'Response speed',
    /** The reasoning chip of a model whose agent keeps its own level until one is picked. */
    effortDefault: 'Default',
    effortDefaultHint: 'Let the agent pick its own level for this model',
    standardSpeed: 'Standard speed',
    favorites: 'Favorites',
    favorite: 'Add to favorites',
    unfavorite: 'Remove from favorites',
    favoritesEmpty: 'Star a model to find it here.',
    favoriteUnavailable: 'This favorite is no longer offered by the account. Choose another model.',
    compact: 'Compact context',
    compactBusy: 'Wait for the current turn to finish',
    compactUnavailable: 'This agent has not advertised context compaction',
    compactNoSession: 'Send a message before compacting',
    newBadge: 'new',
    lockedHint: 'A thread keeps its provider and account',
    /** The model menu's provider name when it has several accounts: the button that lists them. */
    switchAccount: 'Switch account',
    /** The permission chip's name; on a phone, the "+" row that reads the mode beside it. */
    mode: 'Permission',
    model: 'Model',
    unavailable: 'not installed',
    noAccount: 'no account',
    noProvider: 'No AI connected',
    /** The draft's worktree switch, off and on. */
    worktree: 'Worktree',
    worktreeOff: 'Start in a git worktree on its own branch',
    worktreeOn: 'Starts in a git worktree on its own branch',
    /** Images sent with the prompt: the strip above the box and what refuses one. */
    attach: 'Attach files',
    editQueued: 'Edit this pending message, or press Up in the empty composer',
    attachReadError: '{name} could not be read.',
    attachRemove: 'Remove {name}',
    attachAlt: 'Attached file',
    imageReference: '[Image {number}]',
    imagePreview: 'Preview {image}',
    imagePreviewClose: 'Close image preview',
    attachPending: 'Reload to recover',
    attachLoading: 'Loading',
    /** The last tile of a full strip: how many more it hides, and folding them back. */
    attachMore: 'Show {count} more',
    attachLess: 'Show fewer',
    attachUnnamed: 'the attachment',
    attachFormat: '{name} is {type}, and an image must be one of {formats}.',
    attachTooLarge: '{name} is too big: a file may weigh {max} at most.',
    attachTooMany: 'A turn carries at most {max} files, so {name} was left out.',
    attachTotalOver: 'These files still weigh over {max} together, even with the pictures at their smallest: remove some before sending.',
    attachTotalTooLarge: 'The files of one turn weigh {max} at most together, so {name} was left out.',
    attachNoImages: '{provider} takes no images: send the prompt without them.'
  }
} as const;
