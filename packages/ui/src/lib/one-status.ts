import { threadBusy, type DelegatedAgent, type Message, type MessagePart, type RequestId, type Turn } from '@boite/contracts';
import { upkeepOf } from './agent-upkeep';
import type { Store } from './store.svelte';
import type { TimelineCard } from './timeline-cards';
import { pairPermissions, thinkingShown, type ActivityPart } from './tool-groups';

/*
 * One status per fact. What is already said elsewhere (an ask in the card at
 * the timeline's end, a subagent or a workflow at work in the composer's
 * strip) is not said a second time by the stream while it lasts; the stream
 * keeps the outcome once it ends.
 */

/** A subagent the strip lists: at work, or waiting on its own background work, and not an agent's upkeep. */
export function inStrip(store: Store, agent: DelegatedAgent): boolean {
  return threadBusy(agent.thread) && !upkeepOf(store).has(agent.thread.id);
}

/** The thread on screen has a permission or a question in the card at its timeline's end (`ThreadDecision`). */
export function asksDocked(store: Store, threadId: string): boolean {
  const here = (ask: { threadId: string }) => ask.threadId === threadId;
  return store.openThread?.id === threadId && !!(store.pendingPermissions?.some(here) || store.pendingQuestions?.some(here));
}

/**
 * A question of the thread on screen that waits in the card at the timeline's end: the
 * stream draws no line for it while it waits (`asksDocked`). A settings, agent
 * setting or team card the agent stopped for keeps its own card.
 */
export function questionDocked(store: Store, part: Extract<MessagePart, { type: 'question' }>): boolean {
  return (part.answer ?? null) === null && store.pendingQuestions.some((asked) => asked.id === part.questionId)
    && (part.async === true || !(part.setting || part.agentSetting || part.team));
}

/**
 * A run of steps that holds nothing but permissions waiting in the card at the
 * timeline's end, and the calls they stand for: the stream draws nothing for
 * it while the card asks, so the card stands on that row. `asked` tells a
 * permission whose record the card holds.
 */
export function dockedRun(parts: readonly ActivityPart[], thinkingLive: boolean, asked: (requestId: RequestId) => boolean): boolean {
  const pairs = pairPermissions(parts);
  const waitingCall = new Set([...pairs].filter(([at]) => (parts[at] as Extract<ActivityPart, { type: 'permission' }>).decision === null).map(([, call]) => call));
  return parts.some((part) => part.type === 'permission') && parts.every((part, index) => {
    if (part.type === 'permission') return part.decision === null ? asked(part.requestId) : pairs.has(index);
    if (part.type === 'tool') return waitingCall.has(index);
    return !thinkingShown(part, thinkingLive && index === parts.length - 1);
  });
}

/**
 * The cards the stream draws for the thread on screen: a workflow still
 * running and a launch with a subagent still in the strip wait there, by
 * name; they come back with their outcome once they end.
 */
export function settledCards(store: Store, threadId: string, cards: Map<string, TimelineCard>): Map<string, TimelineCard> {
  if (store.openThread?.id !== threadId) return cards;
  return new Map([...cards].filter(([, card]) => card.kind === 'run' ? card.run.status !== 'running'
    : card.kind !== 'launch' || !card.launch.agents.some((agent) => inStrip(store, agent))));
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
