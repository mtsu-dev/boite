import { DEFAULT_THREAD_DELETION_RETENTION_DAYS, DEFAULT_THREAD_DONE_RETENTION_DAYS, type Settings } from './settings';
import { DEFAULT_AUTO_COMPACT } from './settings-validation';

/** A fresh set of the defaults shared by the persisted and in-memory cores. */
export function defaultSettings(): Settings {
  return {
    threadDoneRetentionDays: DEFAULT_THREAD_DONE_RETENTION_DAYS,
    threadDeletionRetentionDays: DEFAULT_THREAD_DELETION_RETENTION_DAYS,
    worktreeStorage: { mode: 'project', directory: null },
    warmProcessMinutes: 0,
    listenOnLan: false,
    agentCpuCapPercent: 75,
    agentMemoryBudgetPercent: 60,
    threadMemoryCapMb: 0,
    memoryReserveMb: 0,
    memoryProtection: true,
    focusGuard: true,
    muteAgents: true,
    reapOrphans: true,
    autoUpdateHarnesses: false,
    autoCompact: { ...DEFAULT_AUTO_COMPACT, moments: [...DEFAULT_AUTO_COMPACT.moments] },
  };
}
