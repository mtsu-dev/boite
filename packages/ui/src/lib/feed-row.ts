import type { PermissionRequest, QuestionRequest, ThreadSummary } from '@boite/contracts';
import { decisionTitle } from './decision-title';
import { hostMark } from './machine-host';
import type { RowPlace } from './row-place';

type Requests = { pendingQuestions: readonly Pick<QuestionRequest, 'threadId'>[]; pendingPermissions: readonly PermissionRequest[] };

/**
 * What an Activity row asks, in words, under its place line: a held permission by what it does, the composer's own
 * title (lib/decision-title.ts: "Push orbit/csv-import", the raw command in mono under it); anything else the feed's
 * reason (lib/activity-feed.ts). Null when that reason only names where the row lives, which the place line says.
 * Both the desktop row and the phone's call it, so they read the same.
 */
export function feedAsk(owner: Requests, threadId: ThreadSummary['id'], row: { reason?: string; place?: string }): string | null {
  if (!owner.pendingQuestions.some(question => question.threadId === threadId)) {
    const permission = owner.pendingPermissions.find(entry => entry.threadId === threadId);
    if (permission) return decisionTitle(permission.toolName, permission.input);
  }
  return !row.reason || row.reason === row.place ? null : row.reason;
}

/**
 * Where an Activity row comes from, on its place line: its project (a bot's name, Drafts), then its machine as a
 * place (MachinePlace.svelte) once the user has several, and always while it is out of reach, with its state.
 */
export function feedWhere(row: { place: string; machine: { label: string; store: { connection: string } } }, several: boolean): RowPlace {
  const { connection } = row.machine.store;
  const host = several || connection !== 'ready' ? hostMark(row.machine.label, connection) : undefined;
  return { project: row.place, host, text: host ? `${row.place} ${host.text}` : row.place };
}
