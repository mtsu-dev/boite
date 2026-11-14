/**
 * Where a set of Linux results would stand in ADEMark's published table.
 *
 *   bun bench/ademark/rank.ts --published <ademark results.json> [--bare <bare tokens.json>] <results.json | tokens.json>...
 *
 * A token count depends on what the machine's Claude Code setup adds to every
 * request, so with `--bare` the token tests compare each app's ratio to the
 * Bare CLI measured beside it, here and in the published run.
 *
 * The order is the default one of ADEMark's results grid (`Results.astro` of
 * its site): tests led, then places in the top third behind the leader, then
 * in the middle third. Equal medians share a rank, equal tallies a position,
 * an app measured in fewer than 9 of the 12 tests gets no position, and the
 * Bare CLI is a control, never ranked. ADEMark calls that order a help for
 * scanning, not a score. The published numbers come from a Mac mini M4 and
 * the real apps, these from this machine: a place here is an estimate, not a
 * published result.
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

/** Fewer measured tests than this and an app has no position: a missing test says nothing about it. */
const MIN_MEASURED = 9;
/** Per app: tests led, top third behind the leader, middle third, tests measured. */
const tally = new Map<string, { led: number; top: number; middle: number; measured: number }>();
const count = (id: string): { led: number; top: number; middle: number; measured: number } => {
  let entry = tally.get(id);
  if (entry === undefined) {
    entry = { led: 0, top: 0, middle: 0, measured: 0 };
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
  // Equal values share the rank of the first of them.
  const rankOf = (value: number): number => field.findIndex((entry) => entry.value === value) + 1;
  const share = (rank: number): number => (field.length > 1 ? (rank - 1) / (field.length - 1) : 0);
  for (const entry of field) {
    const rank = rankOf(entry.value);
    const tallied = count(entry.id);
    tallied.measured += 1;
    if (rank === 1) tallied.led += 1;
    else if (share(rank) <= 1 / 3) tallied.top += 1;
    else if (share(rank) <= 2 / 3) tallied.middle += 1;
  }
  const place = own === undefined ? 'not measured' : `${rankOf(own)} of ${field.length}`;
  const limit = field.findLast((entry) => share(rankOf(entry.value)) <= 1 / 3)?.value;
  const show = (value: number | null | undefined): string => (typeof value === 'number' ? value.toFixed(2) : '');
  console.log(`| ${test}${ratio ? ', times the Bare CLI' : ''} | ${show(own)} | ${place} | ${best === undefined ? '' : `${best.id} ${show(best.value)}`} | ${show(limit)} | ${ratio ? '1.00' : show(control)} |`);
}

const key = (entry: { led: number; top: number; middle: number }): string => `${entry.led},${entry.top},${entry.middle}`;
const order = [...tally.entries()]
  .filter(([, entry]) => entry.measured >= MIN_MEASURED)
  .sort((a, b) => b[1].led - a[1].led || b[1].top - a[1].top || b[1].middle - a[1].middle || a[0].localeCompare(b[0]));
console.log('\n| Position | App | Tests led | Top third | Middle third | Tests measured |');
console.log('| ---: | --- | ---: | ---: | ---: | ---: |');
for (const [id, entry] of order) {
  const position = order.findIndex(([, other]) => key(other) === key(entry)) + 1;
  console.log(`| ${position} | ${id} | ${entry.led} | ${entry.top} | ${entry.middle} | ${entry.measured} |`);
}
const partial = [...tally.entries()].filter(([, entry]) => entry.measured < MIN_MEASURED);
if (partial.length > 0) console.log(`\nNo position, fewer than ${MIN_MEASURED} tests measured: ${partial.map(([id, entry]) => `${id} (${entry.measured})`).join(', ')}`);
