import type { Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { followUpEndKey, maintenanceTurn, pendingComposerFollowUp, taskTurn } from './completion.ts';
import { sentBack } from '../workflows/follow-up.ts';

const PREFIX = 'delegation-composer-result:';

/** Record the Stop and its result policy before its caller ends any live work. */
export function stageChildStop(core: Core, threadId: string, reportResult: boolean, coreOwned: boolean): Turn | null {
  const target = core.scheduler.stopTarget(threadId);
  const turn = core.journal.runningTurn(threadId) ?? (target ? core.journal.getTurn(target) : null);
  if (turn?.status === 'running' || turn?.status === 'queued') {
    core.threads.handoff.recordUserStop(turn.id);
    if (!maintenanceTurn(turn) && (!coreOwned || sentBack(core, threadId, turn))) stageComposerResult(core, turn, reportResult);
  }
  const last = core.composer.hasQueuedInput(threadId) || core.activity.composerFollowUp(threadId) ? taskTurn(core, threadId) : null;
  if (!last || !pendingComposerFollowUp(core, last)) return null;
  stageComposerResult(core, last, reportResult);
  return last;
}

/** Mark the wait ended and keep the result deliverable across worktree cleanup and shutdown. */
export function stageComposerResult(core: Core, turn: Turn, reportResult = true): void {
  const parentId = core.journal.getThread(turn.threadId)?.parentThreadId;
  const config = parentId ? core.delegation.config(parentId) : null;
  const workflow = core.workflows.owns(turn.threadId);
  core.journal.db.transaction(() => {
    core.journal.setSetting(followUpEndKey(turn.threadId), turn.id);
    if ((!config || config.enabled) && (!workflow || sentBack(core, turn.threadId, turn))) {
      const key = `${PREFIX}${turn.id}`;
      // A team Stop suppresses new results and preserves a result already owed.
      if (reportResult || core.journal.getSetting(key) !== true) core.journal.setSetting(key, reportResult);
    }
  })();
}

export function hasComposerResult(core: Core, turnId: string): boolean {
  return core.journal.getSetting(`${PREFIX}${turnId}`) === true;
}

export function composerResultSuppressed(core: Core, turnId: string): boolean {
  return core.journal.getSetting(`${PREFIX}${turnId}`) === false;
}

export function clearComposerResult(core: Core, turnId: string): void {
  core.journal.deleteSetting(`${PREFIX}${turnId}`);
}

export function pendingComposerResults(core: Core): Turn[] {
  const rows = core.journal.db.query('SELECT key, value FROM settings WHERE key GLOB ?').all(`${PREFIX}*`) as { key: string; value: string }[];
  return rows.flatMap(({ key, value }) => {
    const turn = core.journal.getTurn(key.slice(PREFIX.length));
    if (!turn || (value === 'false' && turn.finishedAt !== null)) core.journal.deleteSetting(key);
    else if (value === 'true' && turn.finishedAt !== null) return [turn];
    return [];
  });
}
