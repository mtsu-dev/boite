import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import type { StepDecision } from '../types.ts';
import { compactFocus } from './compaction.ts';
import type { ClaudeTurn } from './turn.ts';

/**
 * How long the step hooks may hold the CLI, in seconds (the SDK's unit). At
 * the limit the core awaits a copy still running for up to
 * `BACKGROUND_COMPACT.timeoutMs` (300 s); the margin covers the swap itself.
 */
export const STEP_HOOK_TIMEOUT_S = 330;
/** How long a boundary waits for the result entries of its batch, which the SDK may yield just after the hook. */
const ENTRY_WAIT_MS = 1_000;
/** What the CLI is told when a hook stops its loop for a swap. */
export const SWAP_STOP_REASON = 'Boite goes on with the session compacted in the background';

/** What the step hooks read from their session: the turn the CLI is on and an interrupt. */
export interface StepHost {
  head(): ClaudeTurn | null;
  /** Stops the CLI's loop where it is, keeping the turn (`ClaudeSession.#interrupt`). */
  interrupt(): void;
}

/**
 * The claude half of a background compaction taken inside a turn
 * (`TurnContext.step`). `PostToolBatch` fires once every tool call of a batch
 * resolved, before the next model request: the boundary. It hands the core
 * the last result entry and the context, and on a swap returns
 * `continue: false`, which ends the CLI's run before that request (CLI 2.1.318,
 * probed 2026-11-05: a success result with `terminal_reason: 'hook_stopped'`).
 * `PreCompact(auto)` is the safety net for a native threshold that passes
 * before Boite's estimate does: with a copy the core hands over it answers
 * `block` and interrupts the CLI while the hook still runs, since a block
 * alone continues uncompacted and `continue: false` does not stop that hook
 * (same probe). Without one, the native compaction runs as before, with
 * Boite's summary focus.
 */
export function stepHooks(host: StepHost, summary: () => string | null): { PostToolBatch: HookCallbackMatcher[]; PreCompact: HookCallbackMatcher[] } {
  const focus = compactFocus(summary);
  return {
    PostToolBatch: [{ timeout: STEP_HOOK_TIMEOUT_S, hooks: [async (input) => {
      if (input.hook_event_name !== 'PostToolBatch' || input.agent_id !== undefined) return {};
      const decision = await reach(host.head(), input.tool_calls.map(call => call.tool_use_id), 0);
      return decision === null ? {} : { continue: false, stopReason: SWAP_STOP_REASON };
    }] }],
    PreCompact: [{ timeout: STEP_HOOK_TIMEOUT_S, hooks: [async (input, toolUseId, options) => {
      if (input.hook_event_name === 'PreCompact' && input.trigger === 'auto' && input.agent_id === undefined) {
        const turn = host.head();
        // The CLI crossed its threshold, which is the limit: the context is at least that.
        const decision = await reach(turn, null, turn?.ctx.autoCompactTokens?.() ?? 0);
        if (decision !== null) {
          host.interrupt();
          return { decision: 'block' };
        }
      }
      return focus(input, toolUseId, options);
    }] }],
  };
}

/**
 * The step at the turn's last complete entry: a tool result, with every call
 * of `toolIds` answered. Null when the turn has no such boundary, is over, or
 * the core gives no swap; otherwise the turn holds the swap for its session.
 */
async function reach(turn: ClaudeTurn | null, toolIds: readonly string[] | null, floor: number): Promise<StepDecision | null> {
  const step = turn?.ctx.step;
  if (turn === null || step === undefined || turn.settled || turn.isStopped || turn.swapping) return null;
  const deadline = Date.now() + ENTRY_WAIT_MS;
  let boundary = turn.boundary(toolIds, floor);
  while (boundary === null && toolIds !== null && Date.now() < deadline && !turn.settled) {
    await turn.nextEntry(deadline - Date.now());
    boundary = turn.boundary(toolIds, floor);
  }
  if (boundary === null) return null;
  const decision = await Promise.race([step(boundary), turn.stopped.then(() => null)]);
  if (decision === null || turn.settled || turn.isStopped) return null;
  turn.beginSwap(decision.swap);
  return decision;
}
