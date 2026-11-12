export const strings = {

  workflow: {
    status: { running: 'Running', paused: 'Paused', done: 'Done', failed: 'Failed', stopped: 'Stopped' },
    stepStatus: { waiting: 'Waiting', running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped', stopped: 'Stopped' },
    steps: '{done} of {total} done',
    /** Under a failed run's row in the chat: the step that failed and the first line of its error. */
    stepFailed: '{step}: {error}',
    phase: 'Phase {n}',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    retry: 'Retry',
    stopTitle: 'Stop "{name}"?',
    stopBody: 'Running steps are stopped and the rest never starts. Finished steps keep their results.',
    forEach: 'One per item of {path}',
    after: 'After {steps}',
    condition: 'Only if {condition}',
    loop: 'Repeats from {step} until {condition}, {max} rounds at most',
    inLoop: 'Runs again in the loop of {step}',
    round: 'Round {round} of {max}',
    loopTitle: 'Round {round} of {max}: back to {from} until {condition}',
    loopsBack: 'Loops back to {step}',
    task: 'Task',
    result: 'Result',
    output: 'Output',
    items: 'Executions',
    openThread: 'Open thread',
    back: 'Back to the graph',
    close: 'Close details',
    notStarted: 'Not started yet.',
    skipped: 'Skipped: its condition did not hold.',
    show: 'Show the workflow',
    tokens: '{tokens} tokens',
    tokensHelp: 'Reported usage from completed turns, including cache reads, cache writes and retries.'
  }
} as const;
