import type { ThreadId, Timestamp, TurnId } from './ids';

/**
 * The next message the agent predicts the owner sends, after the turn
 * `turnId` finished: Claude's `prompt_suggestion`, Codex's composer
 * prediction. Kept in memory, one per thread; a new turn, a sent message, an
 * archive or a removal clears it.
 */
export interface PromptSuggestion {
  turnId: TurnId;
  text: string;
  at: Timestamp;
}

export interface PromptSuggestionsRpcEvents {
  /** The agent's suggested next message for the thread, or null once it no longer applies. */
  'thread.suggestion': { threadId: ThreadId; suggestion: PromptSuggestion | null };
}
