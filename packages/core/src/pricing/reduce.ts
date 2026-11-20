/**
 * The filter that turns the models.dev catalogue into the compact rate table
 * `priceOf` reads. `scripts/model-rates.ts` runs it to regenerate the bundled
 * `rates.json`, and the core runs it on each fetched catalogue (`live.ts`), so
 * both keep the same models.
 *
 * Only the model makers' own listings are kept, in the order of `MAKERS`: when
 * two makers list the same id (a GLM model resold by Alibaba), the first one
 * wins. Image, audio, vision and embedding models are left out, and so are a
 * model with no input or output rate, one released before 2025, an open-weight
 * size variant that third parties serve at their own prices, a dated alias of
 * a model listed at the same rates, and a reseller's copy (`zai-glm-5-3`).
 * Each model is `[input, output, cacheRead, cacheWrite]` in USD per million
 * tokens at the base tier, null where the catalogue gives no rate.
 */

export const RATES_SOURCE = 'https://models.dev/api.json';
export const MAKERS = ['anthropic', 'openai', 'google', 'xai', 'deepseek', 'moonshotai', 'zai', 'minimax', 'mistral', 'alibaba', 'meta'] as const;
/** The makers a fetched catalogue must list, or it is not one. */
export const REQUIRED_MAKERS = ['anthropic', 'openai'] as const;

const SINCE = '2025-01-01';
/** Speech, vision and computer-use builds, reseller copies and open-weight sizes such as `qwen3-14b` or `qwen3.6-35b-a3b`. */
const SKIPPED = /embedding|asr|voxtral|-vl\b|vl-|qvq|omni|vision|computer-use|^glm-[\d.]+v|v-turbo|^zai-|-\d+b(?:-a\d+b)?(?:-|$)/;
/** The release dates `priceOf` strips before it looks again (`index.ts`); only those aliases can go. */
const DATED = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

export type Rate = [input: number, output: number, cacheRead: number | null, cacheWrite: number | null];

interface Listed {
  release_date?: unknown;
  modalities?: { output?: unknown };
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A rate as a table stores it, or null when it is not one: four entries, input and output priced. */
export function rateOf(value: unknown): Rate | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [input, output, cacheRead, cacheWrite] = value.map(price);
  if (input === null || input === undefined || output === null || output === undefined || input + output === 0) return null;
  if ((cacheRead === null && value[2] !== null) || (cacheWrite === null && value[3] !== null)) return null;
  return [input, output, cacheRead ?? null, cacheWrite ?? null];
}

/** The kept models of a catalogue, sorted by id, and the makers it does not list. */
export function reduceCatalogue(data: unknown): { models: Record<string, Rate>; missing: string[] } {
  const catalogue = isObject(data) ? data : {};
  const models: Record<string, Rate> = {};
  const missing: string[] = [];
  for (const maker of MAKERS) {
    const section = catalogue[maker];
    const listed = isObject(section) && isObject(section.models) ? section.models : undefined;
    if (listed === undefined) { missing.push(maker); continue; }
    for (const [rawId, raw] of Object.entries(listed)) {
      if (!isObject(raw)) continue;
      const model = raw as Listed;
      const id = rawId.toLowerCase();
      if (Object.hasOwn(models, id)) continue;
      const output = Array.isArray(model.modalities?.output) ? model.modalities.output : ['text'];
      if (output.length !== 1 || output[0] !== 'text' || (SKIPPED.test(id) && !id.includes('coder'))) continue;
      if ((typeof model.release_date === 'string' ? model.release_date : '') < SINCE) continue;
      const input = price(model.cost?.input);
      const out = price(model.cost?.output);
      if (input === null || out === null || input + out === 0) continue;
      models[id] = [input, out, price(model.cost?.cache_read), price(model.cost?.cache_write)];
    }
  }
  // The core strips a date before it looks again, so `claude-haiku-4-5-20251001` finds `claude-haiku-4-5`.
  for (const id of Object.keys(models)) {
    const base = id.replace(DATED, '');
    if (base !== id && JSON.stringify(models[base]) === JSON.stringify(models[id])) delete models[id];
  }
  const sorted: Record<string, Rate> = {};
  for (const id of Object.keys(models).sort()) sorted[id] = models[id]!;
  return { models: sorted, missing };
}
