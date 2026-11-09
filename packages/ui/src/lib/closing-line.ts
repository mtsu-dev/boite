import { requestWork, type Message, type Turn } from '@boite/contracts';
import { changeCount, changeText } from './change-count';
import { elapsed } from './format';
import { fill, strings } from './strings';
import { turnDiffs, turnFiles, turnLineCounts } from './turn-files';

type ClosingTurn = Pick<Turn, 'id' | 'status' | 'queuedAt' | 'startedAt' | 'finishedAt' | 'execution'>;

/**
 * The quiet line a finished thread ends on: "Done · Worked for 4m 12s · 3 files, +40 −12". Null while a turn waits
 * or runs, after a stop or a failure (their own notices say it), and before any turn ran. The time counts the whole
 * request the last turn closes (`requestWork`); the files are that turn's.
 */
export function closingLine(turns: readonly ClosingTurn[], messages: readonly Message[], cwd: string): string | null {
  if (turns.some(turn => turn.status === 'running' || turn.status === 'queued')) return null;
  const last = turns.findLast(turn => turn.startedAt !== null && turn.execution?.operation !== 'keepalive');
  if (!last || last.status !== 'done' || last.startedAt === null || last.finishedAt == null) return null;
  const spent = Math.max(0, last.finishedAt - last.startedAt) + (requestWork(turns).get(last.id) ?? 0);
  const parts = messages.filter(message => message.role === 'assistant' && message.turnId === last.id).flatMap(message => message.parts);
  const files = turnFiles(parts, cwd);
  const lines = files.length > 0 ? turnLineCounts(turnDiffs(parts), cwd).total : null;
  const changes = lines ? changeText(changeCount(files.length, lines.added, lines.removed)) : '';
  return [strings.notify.done, fill(strings.chat.workedFor, { time: elapsed(spent) }), changes].filter(Boolean).join(' · ');
}
