import type { ModelInfo } from '@boite/contracts';
import type { FavoriteModel } from './model-order';

/**
 * The model picker's first level: the models a person uses, so today's pick
 * takes one click. The current choice first, then the starred ones in their
 * order, then the models of the latest threads. Everything else waits behind
 * "All models".
 */
export interface ShortModel {
  providerId: string;
  accountId: string;
  model: ModelInfo;
  favorite: boolean;
}

/** A thread as the shortlist reads it: who ran it, and when the user last wrote. */
export interface UsedModel {
  providerId: string;
  accountId: string;
  model: string | null;
  updatedAt?: number;
  lastUserMessageAt?: number | null;
  archivedAt?: number | null;
  /** A subagent's model is its parent's pick, not the user's. */
  parentThreadId?: string | null;
}

/** Recent rows under the stars: enough for a usual day, few enough to read at a glance. */
export const RECENT_MODELS = 3;

/**
 * `find` resolves a model on its account, null when that account does not
 * offer it (anymore): a recent row is only drawn when a click on it can land.
 * A recent model already starred, on any account, is not repeated.
 */
export function shortlist(
  favorites: readonly FavoriteModel[],
  threads: readonly UsedModel[],
  current: { providerId: string; accountId: string; model: string | null } | null,
  find: (providerId: string, accountId: string, modelId: string) => ModelInfo | null,
  recent = RECENT_MODELS
): ShortModel[] {
  // Keys of three parts mark a starred login, of two a model already listed.
  const seen = new Set<string>();
  const rows: ShortModel[] = [];
  for (const { providerId, accountId, model } of favorites) {
    const key = `${providerId}\n${accountId}\n${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key).add(`${providerId}\n${model.id}`);
    rows.push({ providerId, accountId, model: find(providerId, accountId, model.id) ?? model, favorite: true });
  }
  const limit = rows.length + recent;
  const latest = threads
    .filter((thread) => !thread.parentThreadId && !thread.archivedAt)
    .sort((a, b) => (b.lastUserMessageAt ?? b.updatedAt ?? 0) - (a.lastUserMessageAt ?? a.updatedAt ?? 0));
  for (const used of [current, ...latest]) {
    if (rows.length >= limit) break;
    const key = `${used?.providerId}\n${used?.model}`;
    if (!used?.model || seen.has(key)) continue;
    const model = find(used.providerId, used.accountId, used.model);
    if (!model) continue;
    seen.add(key);
    rows.push({ providerId: used.providerId, accountId: used.accountId, model, favorite: false });
  }
  // The choice in force leads, starred or not: the row a reopened picker is read from.
  const lead = current?.model ? leading(rows, current) : -1;
  if (lead > 0) rows.unshift(...rows.splice(lead, 1));
  return rows;
}

/** The row of the current choice: its own login's first, else the same model on another one, which stands for it. */
function leading(rows: readonly ShortModel[], current: { providerId: string; accountId: string; model: string | null }): number {
  const same = (row: ShortModel) => row.providerId === current.providerId && row.model.id === current.model;
  const own = rows.findIndex((row) => same(row) && row.accountId === current.accountId);
  return own >= 0 ? own : rows.findIndex(same);
}
