import type { ModelAlias, ModelInfo } from './providers.ts';

/** Exact IDs take precedence over aliases, even if an older catalog reuses an alias. */
export function resolveModelId<Row>(
  rows: readonly Row[], id: string | null | undefined, identify: (row: Row) => string,
  aliases: (row: Row) => readonly ModelAlias[] | undefined,
): { row: Row; alias?: ModelAlias } | undefined {
  if (id == null) return undefined;
  const exact = rows.find(row => identify(row) === id);
  if (exact !== undefined) return { row: exact };
  for (const row of rows) {
    const alias = aliases(row)?.find(entry => entry.id === id);
    if (alias !== undefined) return { row, alias };
  }
  return undefined;
}

/** Explicit effort is preserved for the caller to validate against the resolved model. */
export function resolveModelSelection(rows: readonly ModelInfo[], id: string | null | undefined, effort?: string | null) {
  const found = resolveModelId(rows, id, row => row.id, row => row.aliases);
  if (found === undefined) return undefined;
  return { model: found.row, effort: effort ?? found.alias?.effort ?? null, alias: found.alias };
}

type ModelAndEffort = { model: string | null; effort: string | null };
export type ResumeSelectionRequest = Partial<ModelAndEffort>;
export type ResumeSelectionReceipt = ResumeSelectionRequest & { aliasEffort?: string };

/** A resume on the same model keeps its effort unless the pick supplied a level. */
export function resumeModelSelection(rows: readonly ModelInfo[], current: ModelAndEffort, request: ResumeSelectionRequest) {
  const model = request.model === undefined ? current.model : request.model;
  const selected = resolveModelSelection(rows, model, request.effort);
  const held = resolveModelSelection(rows, current.model, current.effort);
  const currentEffort = held?.effort ?? current.effort;
  const changedModel = (selected?.model.id ?? model) !== (held?.model.id ?? current.model);
  const aliasEffort = request.model !== undefined ? selected?.alias?.effort : undefined;
  const pickedEffort = request.effort !== undefined || aliasEffort !== undefined;
  const effort = pickedEffort || changedModel ? selected?.effort ?? request.effort ?? null : currentEffort;
  return { model, effort, aliasEffort, changedModel, changed: changedModel || effort !== currentEffort };
}

/** A retry only checks the selection fields its caller specified, including an alias's level. */
export function resumeReceiptConflict(
  rows: readonly ModelInfo[],
  execution: ModelAndEffort | undefined,
  { model, effort }: ResumeSelectionRequest,
  recorded?: ResumeSelectionReceipt,
): 'model' | 'effort' | null {
  const selected = resolveModelSelection(rows, model === undefined ? execution?.model : model, effort);
  const accepted = resolveModelSelection(rows, execution?.model, execution?.effort);
  const sameRequestedModel = model !== undefined && recorded?.model !== undefined && model === recorded.model;
  if (model !== undefined && !sameRequestedModel && (selected?.model.id ?? model) !== (accepted?.model.id ?? execution?.model)) return 'model';
  // The same alias keeps its admission meaning when the catalog changes.
  const aliasEffort = (sameRequestedModel ? recorded?.aliasEffort : undefined) ?? selected?.alias?.effort;
  const identicalModelOnly = sameRequestedModel && effort === undefined && recorded?.effort === undefined;
  const sameRequestedEffort = effort !== undefined && recorded?.effort !== undefined && effort === recorded.effort;
  if (!identicalModelOnly
    && (effort !== undefined || (model !== undefined && aliasEffort !== undefined))
    && !sameRequestedEffort
    && (effort ?? aliasEffort ?? null) !== (accepted?.effort ?? execution?.effort)) return 'effort';
  return null;
}
