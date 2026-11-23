import type { EffortLevel, ModelInfo, SpeedTier } from '@boite/contracts';

interface CapabilityRefusals {
  effort?: true;
  speeds?: true;
  adaptive?: true;
}

export type DiscoveredModel = ModelInfo & { capabilityRefusals?: CapabilityRefusals };

type Row = Record<string, unknown>;

function object(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
}

function labelOf(id: string): string {
  if (id === 'xhigh') return 'Extra high';
  if (id === 'extra-low') return 'Extra low';
  return id[0]!.toUpperCase() + id.slice(1);
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined;
}

function choices(input: unknown, idKey: string): Map<string, EffortLevel & { markedDefault?: true }> {
  const result = new Map<string, EffortLevel & { markedDefault?: true }>();
  for (const value of Array.isArray(input) ? input.slice(0, 40) : [input]) {
    const row = object(value);
    const id = typeof value === 'string' ? value : row?.[idKey] ?? row?.id ?? row?.effort ?? row?.reasoning_effort;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(id) || result.has(id)) continue;
    const description = text(row?.description, 2000);
    result.set(id, { id, label: text(row?.label ?? row?.name, 200) ?? labelOf(id),
      ...(description ? { description } : {}), ...(row?.default === true ? { markedDefault: true } : {}) });
  }
  return result;
}

function normalizeEffort(row: Row, scale: unknown, declared: Row | undefined, adaptive: unknown, preferred: string | undefined): ModelInfo['effort'] {
  const metadata = choices(row.reasoning_efforts, 'id');
  const primary = choices(scale ?? [...metadata.keys()], 'reasoningEffort');
  primary.delete('ultrathink');
  if (adaptive === true) primary.set('ultrathink', { id: 'ultrathink', label: 'Ultrathink' });
  const levels = [...primary.values()].map(({ markedDefault: _, ...level }) => {
    const detail = metadata.get(level.id);
    if (detail === undefined) return level;
    const { markedDefault: _marked, ...fields } = detail;
    return { ...level, ...fields };
  });
  if (!levels.length) return undefined;
  const marked = [...metadata.values(), ...primary.values()].find(level => level.markedDefault && primary.has(level.id));
  const defaultEffort = [row.defaultReasoningEffort, row.default_reasoning_effort, declared?.default, marked?.id, preferred]
    .find(candidate => typeof candidate === 'string' && primary.has(candidate));
  return { levels, default: typeof defaultEffort === 'string' ? defaultEffort : levels[0]!.id };
}

function normalizeSpeeds(row: Row, speed: unknown): SpeedTier[] | null | undefined {
  if (speed === false) return null;
  const declared = object(speed)?.options ?? speed;
  const sources = [declared, row.service_tiers ?? row.serviceTiers, row.additional_speed_tiers ?? row.additionalSpeedTiers];
  const options = choices(sources[0], 'id');
  for (const source of sources.slice(1)) {
    for (const [id, tier] of choices(source, 'id')) {
      if (!options.has(id)) options.set(id, tier);
    }
  }
  if (speed === true && !options.has('fast')) options.set('fast', { id: 'fast', label: 'Fast' });
  const known = options.size > 0 || sources.some(list => Array.isArray(list) && list.length === 0);
  options.delete('default');
  options.delete('standard');
  if (!options.size) return known ? null : undefined;
  return [...options.values()].map(({ markedDefault: _, ...tier }) => tier);
}

/** Parse native and gateway catalog fields into the same explicit controls. */
export function modelCapabilities(row: Row, options: { claude?: boolean } = {}): Partial<DiscoveredModel> {
  const caps = object(row.capabilities);
  const adaptive = options.claude ? caps?.adaptive_thinking : undefined;
  const speeds = normalizeSpeeds(row, caps?.speed);
  const declared = object(caps?.effort);
  const scale = row.supportedReasoningEfforts ?? declared?.levels ?? object(row.thinking)?.levels;
  const declaredEfforts = scale ?? row.reasoning_efforts;
  const effortRefused = row.supportsEffort === false || caps?.effort === false
    || (Array.isArray(declaredEfforts) && declaredEfforts.length === 0);
  const effort = normalizeEffort(row, effortRefused ? [] : scale, declared, adaptive, options.claude ? 'high' : undefined);
  const refusal: CapabilityRefusals = {
    ...(effortRefused ? { effort: true } : {}),
    ...(speeds === null ? { speeds: true } : {}),
    ...(adaptive === false ? { adaptive: true } : {}),
  };
  return {
    ...(effort ? { effort } : {}),
    ...(speeds ? { speeds } : {}),
    ...(Object.keys(refusal).length ? { capabilityRefusals: refusal } : {}),
  };
}

function fillEffort(native: DiscoveredModel, proxy: DiscoveredModel): ModelInfo['effort'] {
  const refusal = native.capabilityRefusals;
  const effort = native.effort ?? (refusal?.effort ? undefined : proxy.effort);
  if (!effort) return undefined;
  const proxyAdaptive = proxy.effort?.levels.find(level => level.id === 'ultrathink');
  const hasAdaptive = effort.levels.some(level => level.id === 'ultrathink');
  const levels = refusal?.adaptive ? effort.levels.filter(level => level.id !== 'ultrathink')
    : proxyAdaptive && !hasAdaptive ? [...effort.levels, proxyAdaptive] : effort.levels;
  if (!levels.length) return undefined;
  return { levels, default: levels.some(level => level.id === effort.default) ? effort.default : levels[0]!.id };
}

export function fillModelCapabilities(native: DiscoveredModel, proxy: DiscoveredModel): DiscoveredModel {
  const effort = fillEffort(native, proxy);
  const speeds = native.speeds ?? (native.capabilityRefusals?.speeds ? undefined : proxy.speeds);
  const aliases = new Map([...(proxy.aliases ?? []), ...(native.aliases ?? [])].map(alias => [alias.id, alias]));
  return { ...native, effort, speeds, ...(aliases.size ? { aliases: [...aliases.values()] } : {}) };
}

export function publicModel({ capabilityRefusals: _refusals, ...model }: DiscoveredModel): ModelInfo {
  const { effort, speeds, ...identity } = model;
  return { ...identity, ...(effort ? { effort } : {}), ...(speeds ? { speeds } : {}) };
}
