/**
 * What a turn the core resumes or retries by itself tells the agent, and how
 * its opening reads in the conversation. The agent's own session holds the
 * rest. `threads/resume.ts` plans the resumes; a restart handoff, a delegated
 * child a restart cut and a retry at capacity read their leads here too.
 */

/** The close every carry-on prompt shares. */
export const CARRY_ON = 'Continue the current task from where it stopped. Verify interrupted work and give your final answer if finished.';

export const RESUME_TEXT = {
  /** A spent subscription window reset (`threads/limit-resume.ts`). */
  limit: {
    prompt: 'The subscription limit reset. Continue the current task from where it stopped.',
    label: 'Resumed after the usage limit reset',
  },
  /** The agent or its API failed; the prompt quotes the error before `CARRY_ON`. */
  error: { label: 'Resumed after an error' },
  /** A core died under the turn. */
  crash: {
    prompt: 'Boite stopped unexpectedly and restarted. Verify interrupted commands and resume where you stopped.',
    label: 'Resumed after a crash',
  },
  /** The turn ended right after a compaction, before its answer. */
  compaction: {
    prompt: `The context compacted before the previous turn answered. ${CARRY_ON}`,
    label: 'Resumed after a compaction',
  },
  /** Background work the agent waited on ended without waking it; the prompt names the work. */
  background: { label: 'Resumed after background work was interrupted' },
  /** A restart the owner asked for cut the turn (`threads/handoff.ts`, `delegation/restart.ts`). */
  handoff: {
    prompt: 'Boite restarted during the previous turn. Verify interrupted commands and resume where you stopped.',
  },
  /** The model was at capacity partway through an attempt (`threads/turn-attempts.ts`). */
  capacity: {
    prompt: 'Model capacity interrupted the last attempt. Continue from where you stopped.',
  },
} as const;

/** The planned resumes `threads/resume.ts` sends, by why the turn stopped. */
export type PlannedReason = 'limit' | 'error' | 'crash' | 'compaction' | 'background';

/** A permission mode change restarts the agent mid-turn: the turn goes on with its request quoted (`threads/turn-attempts.ts`). */
export function modeRestartPrompt(mode: string, request: string): string {
  return `The user set permission mode to ${mode}. Resume where you stopped, keeping later instructions.\n\nRequest for reference:\n${request}`;
}
