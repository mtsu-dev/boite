import { latest } from './latest.svelte';
import type { PermissionRequest } from '@boite/contracts';
import type { Store } from './store.svelte';

/*
 * What the thread on screen waits on stands at the end of its timeline
 * (`ThreadDecision`), never inside the composer: its own permissions and
 * questions, its secrets, and what its subagents ask. The card says how many
 * it holds and whether it is out of view, so the strip over the composer can
 * offer the way back to it (`DecisionPill`). `focus` and `nonce` let a line in
 * the timeline bring one question up, again after a fold.
 */
export const decisionTail = $state<{ count: number; away: boolean; card: HTMLElement | null; focus: string | null; nonce: number }>({
  count: 0, away: false, card: null, focus: null, nonce: 0
});

/** The decisions the end of this thread's timeline draws, as `ThreadDecision` lists them. */
export function decisionsWaiting(store: Store, threadId: string): number {
  if (store.openThread?.id !== threadId) return 0;
  const children = new Set(store.threads.filter((row) => row.parentThreadId === threadId && !row.archived).map((row) => row.id));
  const near = (ask: { threadId: string }) => ask.threadId === threadId || children.has(ask.threadId);
  // A setting, an agent's setting or a team request the agent stopped for keeps its own card in the timeline.
  const questions = store.pendingQuestions.filter((question) => question.threadId === threadId
    && (question.async === true || !(question.setting || question.agentSetting || question.team))).length;
  return questions + store.pendingSecrets.filter(near).length + store.pendingPermissions.filter(near).length
    + store.subagentQuestions(threadId).length;
}

/** Back to the card: the timeline's end, where it stands, then the focus on it. A question id brings that one up. */
export function showDecision(questionId: string | null = null): void {
  decisionTail.focus = questionId;
  decisionTail.nonce++;
  const card = decisionTail.card;
  if (latest.jump) latest.jump();
  else card?.scrollIntoView?.({ block: 'end' });
  card?.focus({ preventScroll: true });
}

type Answer = (request: PermissionRequest, decision: 'allow' | 'deny') => Promise<boolean>;
let answerer: Answer | null = null;
/** The card lends its Allow and Deny, which fold it to its receipt, to the field's keys; returns the release. */
export function lendAnswer(answer: Answer): () => void {
  answerer = answer;
  return () => { if (answerer === answer) answerer = null; };
}
/** Allow or Deny from the keyboard: through the card when it is drawn, so it folds to what was decided. */
export function answerPermission(store: Store, request: PermissionRequest, decision: 'allow' | 'deny'): Promise<boolean> {
  return answerer ? answerer(request, decision) : store.answer(request.id, decision);
}
