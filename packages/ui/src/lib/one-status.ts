import { threadBusy, type DelegatedAgent, type Message, type MessagePart, type Turn } from '@boite/contracts';
import { upkeepOf } from './agent-upkeep';
import type { Store } from './store.svelte';

/*
 * One status per fact. A question waiting at the top of the composer is not
 * drawn a second time by the stream while it waits; the stream keeps the
 * answer once it is given.
 */

/** A subagent at work, or waiting on its own background work, and not an agent's upkeep: the "Waiting on" line counts it. */
export function inStrip(store: Store, agent: DelegatedAgent): boolean {
  return threadBusy(agent.thread) && !upkeepOf(store).has(agent.thread.id);
}

/** The thread on screen has a question waiting at the top of its composer (`ThreadDecision`). */
export function asksDocked(store: Store, threadId: string): boolean {
  return store.openThread?.id === threadId && !!store.pendingQuestions?.some((ask) => ask.threadId === threadId);
}

/**
 * A question of the thread on screen that waits at the top of the composer:
 * the stream draws no line for it while it waits (`asksDocked`). A settings,
 * agent setting or team card the agent stopped for keeps its own card.
 */
export function questionDocked(store: Store, part: Extract<MessagePart, { type: 'question' }>): boolean {
  return (part.answer ?? null) === null && store.pendingQuestions.some((asked) => asked.id === part.questionId)
    && (part.async === true || !(part.setting || part.agentSetting || part.team));
}

/** A failed turn whose answer draws its error as a card: that card holds the turn's one Retry. */
export function failureCarded(turn: Turn, messages: readonly Message[]): boolean {
  return turn.status === 'error' && messages.some((message) => message.turnId === turn.id && message.role !== 'user' && message.parts.some((part) => part.type === 'error'));
}

/** The command a stopped run ended on: its exit code and log go behind the error card's fold. */
export type FailedCall = { exitCode: number | null; output: string | null };

/**
 * The last call of an answer that failed, when the answer ends in an error:
 * the error card shows its exit code and log in its details, so the stop,
 * its code and the way back read in one notice.
 */
export function failedCall(message: Message): FailedCall | null {
  if (!message.parts.some((part) => part.type === 'error')) return null;
  const call = message.parts.findLast((part) => part.type === 'tool');
  return call?.type === 'tool' && call.status === 'error' ? { exitCode: call.exitCode ?? null, output: call.output } : null;
}

/**
 * The call whose stop the turn's error card holds (`failedCall`): its own line
 * drops the red exit code, so the stop is said once, in the card.
 */
export function cardedCall(turn: Turn | undefined, messages: readonly Message[], message: Message): string | null {
  if (!turn || !failureCarded(turn, messages) || !failedCall(message)) return null;
  const call = message.parts.findLast((part) => part.type === 'tool');
  return call?.type === 'tool' ? call.toolId : null;
}
