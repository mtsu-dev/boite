import type { ThreadArchiveReason } from '@boite/contracts';
import type { Journal } from './journal.ts';
import type { MergedPrProof } from './pull-requests.ts';

export interface MergedPrArchiveState {
  generation: number;
  binding?: MergedPrProof;
  reason?: ThreadArchiveReason;
  dismissed?: string[];
  /** Pull requests the agent was already asked about (`merged-pr-ask.ts`): never twice for the same one. */
  asked?: string[];
  restoredCheckout?: { projectId: string | null; cwd: string; branch: string | null };
}
export const archiveStateKey = (id: string): string => `merged-pr-archive:${id}`;
export function archiveState(journal: Journal, id: string): MergedPrArchiveState {
  return (journal.getSetting(archiveStateKey(id)) as MergedPrArchiveState | undefined) ?? { generation: 0 };
}
