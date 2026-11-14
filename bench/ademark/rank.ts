/**
 * Where a set of Linux results would stand in ADEMark's published table.
 *
 *   bun bench/ademark/rank.ts --published <ademark results.json> [--bare <bare tokens.json>] <results.json | tokens.json>...
 *
 * A token count depends on what the machine's Claude Code setup adds to every
 * request, so with `--bare` the token tests compare each app's ratio to the
 * Bare CLI measured beside it, here and in the published run.
 *
 * ADEMark ranks by the number of tests won, then by the number of places in
 * the top third; the Bare CLI is a control and is never ranked. The published
 * numbers come from a Mac mini M4 and the real apps, these from this machine:
 * a place here is an estimate, not a published result.
 */
import { readFileSync } from 'node:fs';

/** The twelve ranked tests; the lower value wins in every one of them. */
const RANKED = ['A1/cold', 'A2/relaunch', 'A3/default-mode', 'A4/total', 'A8/p95', 'A11/open', 'A5/total', 'A6/front', 'A7/total-p95', 'A10/mb-per-thread', 'B1/total', 'B3/total'];
const CONTROL = 'bare-cli';

interface Published {
  apps: { id: string; name: string; tests: Record<string, { median: number | null } | undefined> }[];
}

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.splice(index, 2)[1];
};
const publishedPath = option('--published');
const barePath = option('--bare');
const files = args;
if (publishedPath === undefined || files.length === 0) {
  console.error('usage: bun bench/ademark/rank.ts --published <ademark results.json> [--bare <bare tokens.json>] <results.json | tokens.json>...');
  process.exit(2);
}

const published = JSON.parse(readFileSync(publishedPath, 'utf8')) as Published;
const values = (paths: string[]): Map<string, number> => {
  const found = new Map<string, number>();
  for (const file of paths) {
    const { results } = JSON.parse(readFileSync(file, 'utf8')) as { results: Record<string, unknown> };
    for (const [id, result] of Object.entries(results)) {
      const value = (result as { value?: unknown } | null)?.value;
      if (typeof value === 'number') found.set(id, value);
    }
  }
  return found;
};
const mine = values(files);
const bare = barePath === undefined ? new Map<string, number>() : values([barePath]);

const tally = new Map<string, { wins: number; thirds: number }>();
const count = (id: string): { wins: number; thirds: number } => {
  let entry = tally.get(id);
  if (entry === undefined) {
    entry = { wins: 0, thirds: 0 };
    tally.set(id, entry);
  }
  return entry;
};

console.log('| Test | Boite here | Place | Best published | Top-third limit | Bare CLI published |');
console.log('| --- | ---: | ---: | --- | ---: | ---: |');
for (const test of RANKED) {
  const control = published.apps.find((app) => app.id === CONTROL)?.tests[test]?.median ?? null;
  const here = bare.get(test);
  // A ratio to the Bare CLI of the same machine, when both sides have one.
  const ratio = here !== undefined && typeof control === 'number';
  const field: { id: string; value: number }[] = [];
  for (const app of published.apps) {
    const value = app.tests[test]?.median;
    if (typeof value === 'number' && app.id !== CONTROL) field.push({ id: app.id, value: ratio ? value / (control as number) : value });
  }
  const best = [...field].sort((a, b) => a.value - b.value)[0];
  const raw = mine.get(test);
  const own = raw === undefined ? undefined : ratio ? raw / (here as number) : raw;
  if (own !== undefined) field.push({ id: 'boite', value: own });
  field.sort((a, b) => a.value - b.value);
  const third = Math.ceil(field.length / 3);
  field.forEach((entry, index) => {
    if (index === 0) count(entry.id).wins += 1;
    if (index < third) count(entry.id).thirds += 1;
  });
  const place = own === undefined ? 'not measured' : `${field.findIndex((entry) => entry.id === 'boite') + 1} of ${field.length}`;
  const limit = field[third - 1]?.value;
  const show = (value: number | null | undefined): string => (typeof value === 'number' ? value.toFixed(2) : '');
  console.log(`| ${test}${ratio ? ', times the Bare CLI' : ''} | ${show(own)} | ${place} | ${best === undefined ? '' : `${best.id} ${show(best.value)}`} | ${show(limit)} | ${ratio ? '1.00' : show(control)} |`);
}

const order = [...tally.entries()].sort((a, b) => b[1].wins - a[1].wins || b[1].thirds - a[1].thirds);
console.log('\n| Rank | App | Tests won | Top-third places |');
console.log('| ---: | --- | ---: | ---: |');
order.forEach(([id, entry], index) => {
  if (index < 6 || id === 'boite') console.log(`| ${index + 1} | ${id} | ${entry.wins} | ${entry.thirds} |`);
});
