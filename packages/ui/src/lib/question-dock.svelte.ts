/*
 * The line a docked question leaves in the timeline hands the dock the
 * question to show: a click on it brings that one up, open, above the
 * composer. `nonce` moves on each ask, so a second click on the same line
 * opens the dock again after the user folded it.
 */
export const questionDock = $state<{ focus: string | null; nonce: number }>({ focus: null, nonce: 0 });

/*
 * How tall the dock above the composer stands. It floats over the end of the
 * timeline. Folded rows and open questions reserve reading room while visible;
 * task details overlay it without moving the reading position. Clearance uses
 * the full measured height to keep the return button above every visible row.
 */
export const dockRoom = $state<{ height: number; clearance: number }>({ height: 0, clearance: 0 });

/**
 * Whether a pending question waits in the dock above the composer rather than
 * as a card in the timeline. Asked without stopping, every kind does. One the
 * agent stopped for does when it is a plain question: its options then sit on
 * the composer that writes and sends the answer. A setting, team or bot
 * request it stopped for keeps its card in the timeline.
 */
export function questionDocks(question: { async?: boolean; setting?: unknown; team?: unknown; agentSetting?: unknown }): boolean {
  return question.async === true || (!question.setting && !question.team && !question.agentSetting);
}

export function showDockedQuestion(questionId: string): void {
  questionDock.focus = questionId;
  questionDock.nonce++;
}
