import type { Turn } from '@boite/contracts';
import { quietCompaction } from './agent-turns';

type RestingTurn = Pick<Turn, 'id' | 'status' | 'startedAt' | 'execution'>;

/**
 * The turn a finished thread ends on, whose summary line is the thread's one footer (`TurnSummary`'s `resting`).
 * Null while a turn waits or runs, after a stop or a failure (their own notices say it), and before any turn ran.
 * A cache ping or an automatic compaction that went through is not the thread's last word: the turn before it is,
 * whose line says it. The timeline still picks the line it ends on (`lastLined`): a folded wake draws none.
 */
export function restingTurn(turns: readonly RestingTurn[]): string | null {
  if (turns.some(turn => turn.status === 'running' || turn.status === 'queued')) return null;
  const last = turns.findLast(turn => turn.startedAt !== null && turn.execution?.operation !== 'keepalive' && !quietCompaction(turn));
  return last?.status === 'done' ? last.id : null;
}
