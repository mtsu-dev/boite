import type { ModelInfo } from '@boite/contracts';

const LEVELS = ['minimal', 'extra-low', 'low', 'medium', 'high', 'xhigh', 'max'];
const SUFFIX = /^(.+?)-(extra-low|minimal|medium|xhigh|low|high|max)$/;
const LABELS: Record<string, string> = { 'extra-low': 'Extra low', xhigh: 'Extra high' };

export function antigravityVariant(id: string): { family: string; effort: string } | undefined {
  const match = SUFFIX.exec(id);
  return match === null ? undefined : { family: match[1]!, effort: match[2]! };
}

type Variant = { model: ModelInfo; effort: string };

function groupVariants(models: readonly ModelInfo[], include: (id: string) => boolean = () => true): Map<string, Variant[]> {
  const groups = new Map<string, Variant[]>();
  for (const model of models) {
    if (!include(model.id)) continue;
    const variant = antigravityVariant(model.id);
    if (!variant) continue;
    const bucket = groups.get(variant.family) ?? [];
    bucket.push({ model, effort: variant.effort });
    groups.set(variant.family, bucket);
  }
  return groups;
}

function familyLabel(id: string, variants: Variant[]): string {
  const labels = variants.filter(({ model }) => model.name !== model.id);
  const plain = labels.find(({ model }) => !/\s*\([^()]*\)$/.test(model.name));
  if (plain) return plain.model.name;
  for (const { model, effort } of labels) {
    const match = /^(.*?)\s*\(([^()]*)\)$/.exec(model.name);
    const normalized = match?.[2]?.toLowerCase().replace(/[ _]+/g, '-');
    if (match?.[1] && (normalized === effort || (effort === 'xhigh' && normalized === 'extra-high'))) return match[1];
  }
  return labels[0]?.model.name ?? id;
}

function aliasesFor(variants: Variant[]) {
  return variants.map(({ model, effort }) => ({ id: model.id, effort }));
}

function folded(id: string, variants: Variant[], base: ModelInfo | undefined, defaults: ReadonlySet<string>): ModelInfo {
  const available = new Set(variants.map(variant => variant.effort));
  const levels = LEVELS.filter(level => available.has(level));
  const announced = variants.find(({ model }) => defaults.has(model.id))?.effort
    ?? variants.find(({ model }) => available.has(model.effort?.default ?? ''))?.model.effort?.default;
  const aliases = new Map([...(base?.aliases ?? []), ...aliasesFor(variants)].map(alias => [alias.id, alias]));
  return {
    ...base, id, name: base?.name && base.name !== id ? base.name : familyLabel(id, variants),
    default: base?.default === true || variants.some(({ model }) => model.default === true),
    aliases: [...aliases.values()],
    effort: {
      levels: levels.map(level => ({ id: level, label: LABELS[level] ?? level[0]!.toUpperCase() + level.slice(1) })),
      default: announced ?? ['medium', 'high'].find(level => available.has(level)) ?? levels[0],
    },
  };
}

/**
 * Fold selectable wire IDs in catalog order. Historical IDs supply a family's
 * scale until the session selects that family and reports its own levels.
 */
export function antigravityCatalog(primary: ModelInfo[], legacy: ModelInfo[] = [], defaults: ReadonlySet<string> = new Set()): ModelInfo[] {
  const exact = new Map(primary.map(model => [model.id, model]));
  const groups = groupVariants(primary);
  const legacyGroups = groupVariants(legacy, id => !exact.has(id));
  const consumed = new Map<string, Variant[]>();
  const folds = new Map<string, ModelInfo>();
  for (const family of new Set([...groups.keys(), ...legacyGroups.keys()])) {
    const base = exact.get(family);
    const levels = base?.effort?.levels;
    const variants = groups.get(family) ?? [];
    const historical = base ? (legacyGroups.get(family) ?? []) : [];
    if (levels?.length) consumed.set(family, variants.filter(variant => levels.some(level => level.id === variant.effort)));
    else if (historical.length || new Set(variants.map(entry => entry.effort)).size >= 2) {
      folds.set(family, folded(family, [...variants, ...historical], base, defaults));
    }
  }
  const emitted = new Set<string>();
  return primary.flatMap(model => {
    const variant = antigravityVariant(model.id);
    if (variant && consumed.get(variant.family)?.some(entry => entry.model.id === model.id)) return [];
    const family = variant && folds.has(variant.family) ? variant.family : folds.has(model.id) ? model.id : null;
    if (family !== null) {
      if (emitted.has(family)) return [];
      emitted.add(family);
      return [folds.get(family)!];
    }
    if (variant) return [model];
    const levels = model.effort?.levels;
    const historical = (legacyGroups.get(model.id) ?? []).filter(entry => !levels?.length || levels.some(level => level.id === entry.effort));
    const offered = [...(consumed.get(model.id) ?? []), ...historical];
    if (!offered.length) return [model];
    const aliases = new Map([...(model.aliases ?? []), ...aliasesFor(offered)].map(alias => [alias.id, alias]));
    return [{ ...model, default: model.default || offered.some(entry => entry.model.default === true), aliases: [...aliases.values()] }];
  });
}

/** Exact values advertised by the model control, grouped by their encoded effort. */
export function antigravityWireValues(values: readonly string[], family: string): Map<string, string> {
  const variants = new Map<string, string>();
  for (const value of values) {
    const variant = antigravityVariant(value);
    if (variant?.family === family) variants.set(variant.effort, value);
  }
  return variants;
}
