/**
 * Automatic goals (`docs/internals/goals.md`): a long enough prompt, or
 * `boite goal track`, becomes a reviewed goal with a card on the project's
 * board. Reached through `auto-goal-entry.ts`, which loads it lazily. The
 * machine's `autoGoals` setting turns both on; they are off without it. The goal it starts is an
 * ordinary one: running and reviewing it is `activity.ts`.
 */
import { AUTO_GOAL_MIN_CHARS, isComposerActivity } from '@boite/contracts';
import type { ComposerChoice, Settings, ThreadActivity } from '@boite/contracts';
import type { ActivityStore } from './activity.ts';
import type { Core } from './core.ts';
import { messageOf, refused } from './errors.ts';
import { nativeCommandPrompt } from './threads/operations.ts';
import { addGoalCard } from './todos.ts';

/**
 * Whether a prompt that starts a turn also starts an automatic reviewed goal:
 * automatic goals are on in the machine's settings (`autoGoals`) and the
 * prompt, no command, holds at least `autoGoalMinChars` characters.
 */
export function startsAutoGoal(text: string, settings: Pick<Settings, 'autoGoals' | 'autoGoalMinChars'>): boolean {
  if (settings.autoGoals !== true || isComposerActivity(text) || nativeCommandPrompt(text)) return false;
  return text.trim().length >= (settings.autoGoalMinChars ?? AUTO_GOAL_MIN_CHARS.default);
}

/**
 * The user's message `messageId` becomes a reviewed goal's objective,
 * verbatim, and the project's board gets a card linked to it. False, and
 * nothing changes, when the conversation is a subthread or already holds a
 * goal or a loop. It never throws: the turn it follows is already accepted,
 * so a goal that cannot start is logged and the prompt runs alone.
 */
export function autoGoal(core: Core, activity: ActivityStore, threadId: string, turnId: string, messageId: string, objective: string, executionChoice?: ComposerChoice): boolean {
  const thread = core.journal.getThread(threadId);
  if (!thread || thread.archived || thread.parentThreadId || activity.busy(threadId) || !objective.trim()) return false;
  try { activity.set({ threadId, goal: { objective, review: true } }, undefined, executionChoice, true); } catch (error) {
    core.log('warn', `automatic goal: ${messageOf(error)}`);
    return false;
  }
  // The turn still under way is the goal's first: its claim or blocker counts, and no second run starts before them.
  // `first` keeps that across a restart, while the turn waits in line.
  const first = ['queued', 'running', 'waiting'].includes(core.journal.getTurn(turnId)?.status ?? '');
  if (first) activity.takeFirstTurn(threadId, turnId);
  core.journal.setSetting(`auto-goal:${threadId}`, { turnId, messageId, ...(first ? { first } : {}) });
  try { addGoalCard(core, threadId, objective); } catch (error) { core.log('warn', `automatic goal card: ${messageOf(error)}`); }
  return true;
}

/**
 * `boite goal track`: the agent asks for an automatic goal on the user's
 * last prompt, below the threshold. Refused while automatic goals are off,
 * while a goal or a loop runs, and when that prompt already started one.
 */
export function track(core: Core, activity: ActivityStore, threadId: string): ThreadActivity {
  const thread = core.journal.getThread(threadId);
  if (!thread || thread.archived) throw refused('goal track needs an existing, unarchived conversation');
  if (core.settings.get().autoGoals !== true) throw refused('goal track needs automatic goals, which are off on this machine (Settings, General, Agent replies)', { reason: 'auto-goals-off' });
  if (activity.busy(threadId)) throw refused('this conversation already has a goal or a loop; it must finish or be removed first', { reason: 'busy' });
  const last = lastPrompt(core, threadId);
  if (!last) throw refused('this conversation has no prompt of the user to track', { reason: 'no-prompt' });
  const started = core.journal.getSetting(`auto-goal:${threadId}`) as { messageId?: string } | undefined;
  if (started?.messageId === last.messageId) throw refused("the user's last prompt already started a goal", { reason: 'already-tracked' });
  if (!autoGoal(core, activity, threadId, last.turnId, last.messageId, last.text)) throw refused('a reviewed goal starts reviewer conversations; start it in a top-level conversation', { reason: 'subthread' });
  return activity.get(threadId);
}

/** The user's newest prompt, a steer included: no operation, no goal or loop turn, no native command. */
function lastPrompt(core: Core, threadId: string): { turnId: string; messageId: string; text: string } | null {
  for (const message of core.journal.walkMessages(threadId, { newestFirst: true, blobs: false })) {
    if (message.role !== 'user' || !message.turnId || core.journal.getTurn(message.turnId)?.execution?.operation) continue;
    const part = message.parts[0];
    if (part?.type !== 'text' || part.activity || part.startedBy) continue;
    const text = part.displayText ?? part.text;
    if (!text.trim() || nativeCommandPrompt(text)) continue;
    return { turnId: message.turnId, messageId: message.id, text };
  }
  return null;
}
