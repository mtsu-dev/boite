/*
 * The line a docked question leaves in the timeline hands the dock the
 * question to show: a click on it brings that one up, open, above the
 * composer. `nonce` moves on each ask, so a second click on the same line
 * opens the dock again after the user folded it.
 */
export const questionDock = $state<{ focus: string | null; nonce: number }>({ focus: null, nonce: 0 });

export function showDockedQuestion(questionId: string): void {
  questionDock.focus = questionId;
  questionDock.nonce++;
}
