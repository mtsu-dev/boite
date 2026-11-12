import { latest } from './latest.svelte';
import type { Store } from './store.svelte';

/*
 * A question waits at the top of the composer, always in sight
 * (`ThreadDecision`). A permission waits on its own command row in the
 * timeline (`PermissionCard`), which the reader can scroll away from: the row
 * registers here while it is drawn, and the strip over the composer offers
 * the way back while none of the rows is in view (`DecisionPill`). `count` is
 * the open thread's pending permissions (MessageList), drawn or not, since a
 * long conversation draws only the messages near the reading position.
 * `focus` and `nonce` let a line in the timeline bring one question up in the
 * composer, again after a fold.
 */
export const decisionTail = $state<{ count: number; away: boolean; card: HTMLElement | null; focus: string | null; nonce: number }>({
  count: 0, away: true, card: null, focus: null, nonce: 0
});

/**
 * What the top of this thread's composer asks (`ThreadDecision`): its own
 * questions and its subagents', their secrets, and the subagents' questions
 * this machine only knows by name. A setting, an agent's setting or a team
 * request the agent stopped for keeps its own card in the timeline.
 */
export function questionsWaiting(store: Store, threadId: string): number {
  const children = new Set(store.threads.filter((row) => row.parentThreadId === threadId && !row.archived).map((row) => row.id));
  const near = (ask: { threadId: string }) => ask.threadId === threadId || children.has(ask.threadId);
  const questions = store.pendingQuestions.filter((question) => near(question)
    && (question.async === true || !(question.setting || question.agentSetting || question.team)));
  const held = new Set([...questions, ...store.pendingSecrets.filter(near)].map((ask) => ask.threadId));
  return questions.length + store.pendingSecrets.filter(near).length
    + store.subagentQuestions(threadId).filter((child) => !held.has(child.threadId)).length;
}

/** The command rows drawn now, each with whether it is in view. */
const rows = new Map<HTMLElement, boolean>();

function settle(): void {
  decisionTail.card = rows.keys().next().value ?? null;
  decisionTail.away = ![...rows.values()].some(Boolean);
}

/**
 * Attached to a waiting permission's row: in view while at least half of it
 * shows inside the timeline's scroll root, or half the root when it is taller.
 */
export function watchDecision(node: HTMLElement): () => void {
  const root = node.closest<HTMLElement>('[data-scroll-root]');
  rows.set(node, true);
  settle();
  const sight = typeof IntersectionObserver === 'function' && root ? new IntersectionObserver(([entry]) => {
    if (!entry || !rows.has(node)) return;
    rows.set(node, entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= root.clientHeight / 2);
    settle();
  }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] }) : null;
  sight?.observe(node);
  return () => {
    sight?.disconnect();
    rows.delete(node);
    settle();
  };
}

/**
 * A question id brings that question up in the composer. Without one, back
 * to the oldest waiting permission: its row when it is drawn, else the
 * timeline's end, where the turn that asked stands.
 */
export function showDecision(questionId: string | null = null): void {
  decisionTail.focus = questionId;
  decisionTail.nonce++;
  if (questionId !== null) return;
  const card = decisionTail.card;
  if (card) card.scrollIntoView?.({ block: 'center' });
  else latest.jump?.();
  requestAnimationFrame(() => decisionTail.card?.focus({ preventScroll: true }));
}
