// Model metadata, reasoning effort and provider capabilities.
import type { EffortLevel, ModelAlias, ModelInfo, Protocol, ProviderCapabilities } from '@boite/contracts';
import { reject, asObject, asString, asBoolean, asArray, checkKeys } from './validate-primitives.ts';

const CAPABILITY_KEYS: readonly (keyof ProviderCapabilities)[] = [
  'approvals',
  'hooks',
  'checkpoint',
  'images',
  'planMode',
  'resume',
];

/** Reasoning effort: a non-empty scale of uniquely named levels, one of them the default. */
function checkEffort(value: unknown, file: string, field: string): { levels: EffortLevel[]; default: string } {
  const obj = asObject(value, file, field);
  checkKeys(obj, ['levels', 'default'], file, field);

  const raw = asArray(obj['levels'], file, `${field}.levels`);
  if (raw.length === 0) {
    reject(file, `${field}.levels`, 'at least one level', `${field}.levels must list at least one level`);
  }
  const seen = new Set<string>();
  const levels = raw.map((entry, index) => {
    const levelField = `${field}.levels[${index}]`;
    const level = asObject(entry, file, levelField);
    checkKeys(level, ['id', 'label', 'description'], file, levelField);
    const id = asString(level['id'], file, `${levelField}.id`);
    if (seen.has(id)) {
      reject(file, `${levelField}.id`, 'an id no other level uses', `the effort level ${id} is listed twice`);
    }
    seen.add(id);
    const out: EffortLevel = { id, label: asString(level['label'], file, `${levelField}.label`) };
    if (level['description'] !== undefined) {
      out.description = asString(level['description'], file, `${levelField}.description`);
    }
    return out;
  });

  const fallback = asString(obj['default'], file, `${field}.default`);
  if (!seen.has(fallback)) {
    reject(
      file,
      `${field}.default`,
      `one of: ${[...seen].join(', ')}`,
      `${field}.default names ${fallback}, which is not one of the levels`,
    );
  }
  return { levels, default: fallback };
}

function checkAliases(value: unknown, file: string, field: string, model: ModelInfo): ModelAlias[] {
  const seen = new Set([model.id]);
  return asArray(value, file, field).map((entry, index) => {
    const path = `${field}[${index}]`;
    const alias = asObject(entry, file, path);
    checkKeys(alias, ['id', 'effort'], file, path);
    const id = asString(alias['id'], file, `${path}.id`);
    if (seen.has(id)) reject(file, `${path}.id`, 'a distinct alias', `the model already uses ${id}`);
    seen.add(id);
    if (alias['effort'] === undefined) return { id };
    const effort = asString(alias['effort'], file, `${path}.effort`);
    if (!model.effort?.levels.some(level => level.id === effort)) reject(file, `${path}.effort`, 'a reasoning level offered by the model', `the model does not offer ${effort}`);
    return { id, effort };
  });
}

export function checkModels(value: unknown, file: string, protocol: Protocol): ModelInfo[] {
  const raw = asArray(value, file, 'models');
  if (raw.length === 0 && protocol === 'echo') reject(file, 'models', 'at least one model for echo', 'echo models must list at least one model');
  return raw.map((entry, index) => {
    const obj = asObject(entry, file, `models[${index}]`);
    checkKeys(obj, ['id', 'name', 'default', 'legacy', 'badge', 'effort', 'aliases'], file, `models[${index}]`);
    const model: ModelInfo = {
      id: asString(obj['id'], file, `models[${index}].id`),
      name: asString(obj['name'], file, `models[${index}].name`),
    };
    if (obj['default'] !== undefined) model.default = asBoolean(obj['default'], file, `models[${index}].default`);
    if (obj['legacy'] !== undefined) model.legacy = asBoolean(obj['legacy'], file, `models[${index}].legacy`);
    if (obj['badge'] !== undefined) {
      const badge = asString(obj['badge'], file, `models[${index}].badge`);
      if (badge !== 'new') reject(file, `models[${index}].badge`, '"new"', `unknown badge ${badge}`);
      model.badge = 'new';
    }
    if (obj['effort'] !== undefined) model.effort = checkEffort(obj['effort'], file, `models[${index}].effort`);
    if (obj['aliases'] !== undefined) model.aliases = checkAliases(obj['aliases'], file, `models[${index}].aliases`, model);
    return model;
  });
}

export function checkCapabilities(value: unknown, file: string): ProviderCapabilities {
  const obj = asObject(value, file, 'capabilities');
  checkKeys(obj, CAPABILITY_KEYS, file, 'capabilities');
  return {
    approvals: asBoolean(obj['approvals'], file, 'capabilities.approvals'),
    hooks: asBoolean(obj['hooks'], file, 'capabilities.hooks'),
    checkpoint: asBoolean(obj['checkpoint'], file, 'capabilities.checkpoint'),
    images: asBoolean(obj['images'], file, 'capabilities.images'),
    planMode: asBoolean(obj['planMode'], file, 'capabilities.planMode'),
    resume: asBoolean(obj['resume'], file, 'capabilities.resume'),
  };
}

