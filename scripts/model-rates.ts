/**
 * Regenerates `packages/core/src/pricing/rates.json`, the public API rates the
 * usage page prices tokens at, from the models.dev catalogue OpenCode also reads.
 *
 *   bun scripts/model-rates.ts                       # fetch https://models.dev/api.json
 *   bun scripts/model-rates.ts ~/.cache/opencode/models.json
 *
 * The filter is the core's own (`packages/core/src/pricing/reduce.ts`), which
 * also reduces the catalogue a running core fetches, so the bundled table and
 * a fetched one keep the same models. The table ships inside the core bundle,
 * which has a size budget.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATES_SOURCE, reduceCatalogue } from '../packages/core/src/pricing/reduce.ts';

const OUT = join(import.meta.dir, '..', 'packages', 'core', 'src', 'pricing', 'rates.json');

async function catalogue(from: string | undefined): Promise<unknown> {
  if (from !== undefined) return JSON.parse(readFileSync(from, 'utf8'));
  const response = await fetch(RATES_SOURCE, { headers: { 'user-agent': 'boite' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${RATES_SOURCE}: HTTP ${response.status}`);
  return await response.json();
}

const { models, missing } = reduceCatalogue(await catalogue(process.argv[2]));
if (missing.length > 0) throw new Error(`${missing.join(', ')}: missing from the catalogue`);
const ids = Object.keys(models);
const lines = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(models[id])}`);
const date = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, `{\n  "source": ${JSON.stringify(RATES_SOURCE)},\n  "date": ${JSON.stringify(date)},\n  "models": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`${ids.length} models written to ${OUT}`);
