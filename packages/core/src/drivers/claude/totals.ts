import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentTotals } from '@boite/contracts';
import { heldUsage, NOTHING_HELD, ownTokens, restoredCost, type HeldUsage } from './mapping.ts';

/**
 * What one CLI process already charged and counted. `total_cost_usd` and
 * `modelUsage` count from the start of the process, so on a warm query every
 * result after the first carries the turns before it too; a cold process that
 * resumed a session starts from that session's restored totals.
 */
export class RunningTotals {
  /** The last `total_cost_usd` this process reported, which the next result includes. */
  #cost = 0;
  /** The last `modelUsage` it reported as buckets, null while what it restored is unknown. */
  #held: HeldUsage | null = NOTHING_HELD;
  /** A resumed session's earlier turns, until the first result says whether the CLI restored them. */
  #carried: AgentTotals | null;
  /** The CLI version seen restoring the session's totals on a resume (`AgentTotals.restores`). */
  #restores: string | null;
  /** This process's CLI version, from its init message. */
  #version: string | null = null;

  constructor(carried: AgentTotals | null) {
    this.#carried = carried;
    this.#restores = carried?.restores ?? null;
  }

  started(version: unknown): void {
    if (typeof version === 'string' && version.length > 0) this.#version = version;
  }

  /**
   * What earlier turns account for in `result`, read before the turn takes it:
   * the cost they were charged (null when unknown), the tokens they held and
   * the CLI version known to restore them.
   */
  before(result: SDKResultMessage): [cost: number | null, held: HeldUsage | null, restores: string | null] {
    const carried = this.#carried;
    this.#carried = null;
    if (carried === null) return [this.#cost, this.#held, this.#restores];
    // Claude Code 2.1.316 restores a resumed session's totals from its transcript every time (probed
    // 2026-10-31), so a version that showed it once is trusted for a compaction, whose own usage shows nothing.
    const restored = restoredCost(result, carried, this.#version !== null && this.#restores === this.#version);
    if (restored !== null) this.#cost = restored;
    // The CLI restored the carried totals, or started from zero.
    this.#held = restored === null ? null : restored === 0 ? NOTHING_HELD : (carried.held ?? null);
    // Only a result with tokens of its own shows whether the gap is restored totals.
    if (ownTokens(result) > 0 && carried.costUsd > 0 && carried.tokens > 0) this.#restores = restored !== null && restored > 0 ? this.#version : null;
    return [restored, this.#held, this.#restores];
  }

  /** A result the process ended on, the turn's own or one it ran by itself. */
  counted(result: SDKResultMessage): void {
    if (typeof result.total_cost_usd === 'number') this.#cost = result.total_cost_usd;
    if (result.modelUsage !== undefined) this.#held = heldUsage(result);
  }
}
