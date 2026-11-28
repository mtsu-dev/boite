import type { Turn, Usage } from '@boite/contracts';
import type { Core } from '../core.ts';
import type { LateUsageEntry, LateUsageReports } from '../drivers/types.ts';
import { messageOf } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Journal } from '../journal.ts';
import { announceWorkflowUsage } from '../workflows/usage.ts';

const PREFIX = 'native-late-usage';

function clear(journal: Journal, prefix: string): void {
  journal.db.query('DELETE FROM settings WHERE key >= ? AND key < ?').run(`${prefix}:`, `${prefix};`);
}

/** App-server processes do not survive a core restart. Their counters no longer have a writer. */
export function clearStaleLateUsage(journal: Journal): void {
  clear(journal, PREFIX);
}

export function reviseTurnUsage(core: Core, threadId: string, { id, startedAt }: Pick<Turn, 'id' | 'startedAt'>, measured: Usage, remember?: () => void): void {
  const { journal } = core;
  if (journal.isClosed()) return;
  const saved = journal.getTurn(id);
  if (!saved || saved.threadId !== threadId || saved.startedAt !== startedAt) return;
  const usage: Usage = { ...measured, buckets: 1 };
  if (JSON.stringify(saved.usage) === JSON.stringify(usage)) {
    remember?.();
    return;
  }
  journal.append({ type: 'turn.usage', threadId, version: 1, payload: { turnId: id, usage } }, () => {
    remember?.();
    journal.putTurn({ ...saved, usage });
  });
  if (saved.finishedAt === null) return;
  announceWorkflowUsage(core, threadId);
  core.delegation.remote.state(threadId);
}

/** The journal holds the tally until the native process closes, with no age cutoff on reports. */
export function openLateUsage<T>(core: Core, threadId: string): LateUsageReports<T> {
  const { journal } = core;
  const prefix = `${PREFIX}:${newId('')}`;
  const key = (nativeTurnId: string) => `${prefix}:${nativeTurnId}`;
  return {
    load(nativeTurnId) {
      if (!journal.isClosed()) return journal.getSetting(key(nativeTurnId)) as LateUsageEntry<T> | undefined;
    },
    save(nativeTurnId, entry, measured) {
      if (journal.isClosed()) return;
      const remember = () => journal.setSetting(key(nativeTurnId), entry);
      if (measured !== undefined) return reviseTurnUsage(core, threadId, entry, measured, remember);
      try { remember(); }
      catch (error) { core.log('warn', `cannot save native usage tally: ${messageOf(error)}`, { source: 'usage', threadId, turnId: entry.id }); }
    },
    close() {
      if (journal.isClosed()) return;
      try { clear(journal, prefix); }
      catch (error) { core.log('warn', `cannot clear closed native usage reports: ${messageOf(error)}`, { source: 'usage', threadId }); }
    },
  };
}
