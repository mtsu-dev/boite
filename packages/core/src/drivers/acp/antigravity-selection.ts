import { resolveModelSelection, type ModelInfo } from '@boite/contracts';
import { antigravityVariant, antigravityWireValues } from './antigravity-catalog.ts';

export type AntigravityPlan = { model: string; effort: string | null; integrated: boolean };

function takeVariant(model: string, effort: string | null, values: Map<string, string>, fallback?: string): AntigravityPlan {
  const level = effort ?? fallback ?? '';
  const wire = values.get(level);
  if (wire === undefined) throw new Error(`thread.effort: Antigravity offers no ${level || 'default'} effort for ${model}; expected ${[...values.keys()].join(', ')}`);
  return { model: wire, effort: null, integrated: true };
}

function takeIsolatedVariant(model: ModelInfo, level: string, effort: string | null): AntigravityPlan {
  if (model.effort?.levels.length) return { model: model.id, effort, integrated: false };
  return takeVariant(model.id, effort, new Map([[level, model.id]]), level);
}

/** Resolve a requested selection using only the values this session can send. */
export function antigravityPlan(catalog: ModelInfo[], values: string[], model: string, effort: string | null, nativeModel: string | undefined): AntigravityPlan {
  const resolved = resolveModelSelection(catalog, model, effort);
  const variant = antigravityVariant(model);
  if (variant && values.includes(model) && resolved?.alias === undefined) {
    return takeIsolatedVariant(resolved?.model ?? { id: model, name: model }, variant.effort, effort);
  }
  const family = resolved?.model.id ?? variant?.family ?? model;
  const variants = antigravityWireValues(values, family);
  const level = resolved?.effort ?? effort ?? variant?.effort ?? null;
  const hasBase = values.includes(family);
  if (!hasBase && variants.size === 0) throw new Error(`thread.model: Antigravity offers no model ${model}`);
  if (hasBase) {
    const native = nativeModel === family;
    const nativeLevel = native && resolved?.model.effort?.levels.some(choice => choice.id === level);
    const bakedLevel = level !== null && variants.has(level);
    // Selecting the base can expose native levels absent from the model control.
    if (nativeLevel || (!bakedLevel && (level !== null || native || variants.size < 2))) return { model: family, effort: level, integrated: false };
  }
  const fallback = !hasBase && variants.size === 1 ? variants.keys().next().value : resolved?.model.effort?.default;
  return takeVariant(family, level, variants, fallback);
}
