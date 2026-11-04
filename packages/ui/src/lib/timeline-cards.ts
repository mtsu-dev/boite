import type { Message, WorkflowRun } from '@boite/contracts';
import { contactAsksIn, type ContactAsk } from './contact-asks';
import { teamLaunches, type TeamLaunch } from './delegation-progress';
import type { Store } from './store.svelte';

/** A row of its own in a thread's timeline, keyed by its row id and placed at `at`. */
export type TimelineCard =
  | { kind: 'launch'; at: number; launch: TeamLaunch }
  | { kind: 'run'; at: number; run: WorkflowRun }
  | { kind: 'ask'; at: number; ask: ContactAsk };

/**
 * The cards `threadId`'s timeline shows among `messages`: one per launch of
 * its team, where it happened; the workflow runs it started, where each
 * began; the contact requests it made or, as the Contacts bot, forwarded and
 * settled. A held page shows the launches and requests of its span only.
 */
export function timelineCards(store: Store, threadId: string, messages: readonly Message[]): Map<string, TimelineCard> {
  const delegation = store.delegation;
  const team = delegation?.rootThreadId === threadId ? delegation.agents : [];
  const open = store.openThread?.id === threadId ? store.openThread : null;
  const cards = new Map<string, TimelineCard>();
  for (const launch of teamLaunches(team, messages, (open?.messagesBefore ?? null) !== null, (open?.messagesAfter ?? null) !== null)) cards.set(launch.id, { kind: 'launch', at: launch.createdAt, launch });
  for (const run of store.workflowsOf(threadId)) if (run.rootThreadId === threadId) cards.set(`workflow:${run.id}`, { kind: 'run', at: run.createdAt, run });
  for (const ask of contactAsksIn(store, threadId, messages)) cards.set(ask.id, { kind: 'ask', at: ask.at, ask });
  return cards;
}
