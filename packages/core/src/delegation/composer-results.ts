import type { Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { followUpEndKey } from './completion.ts';
import { sentBack } from '../workflows/follow-up.ts';

const PREFIX = 'delegation-composer-result:';

/** Mark the wait ended and keep the result deliverable across worktree cleanup and shutdown. */
export function stageComposerResult(core: Core, turn: Turn): void {
  const parentId = core.journal.getThread(turn.threadId)?.parentThreadId;
  const config = parentId ? core.delegation.config(parentId) : null;
  const canSend = !config || (config.enabled && !config.paused);
  const workflow = core.workflows.owns(turn.threadId);
  core.journal.db.transaction(() => {
    core.journal.setSetting(followUpEndKey(turn.threadId), turn.id);
    if (canSend && (!workflow || sentBack(core, turn.threadId, turn))) core.journal.setSetting(`${PREFIX}${turn.id}`, true);
  })();
}

export function hasComposerResult(core: Core, turnId: string): boolean {
  return core.journal.getSetting(`${PREFIX}${turnId}`) === true;
}

export function clearComposerResult(core: Core, turnId: string): void {
  if (hasComposerResult(core, turnId)) core.journal.deleteSetting(`${PREFIX}${turnId}`);
}

export function pendingComposerResults(core: Core): Turn[] {
  const rows = core.journal.db.query('SELECT key FROM settings WHERE key GLOB ?').all(`${PREFIX}*`) as { key: string }[];
  return rows.flatMap(({ key }) => {
    const turn = core.journal.getTurn(key.slice(PREFIX.length));
    if (turn) return [turn];
    core.journal.deleteSetting(key);
    return [];
  });
}
