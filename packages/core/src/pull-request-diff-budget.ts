/**
 * Fits one page of pull request patches into a fixed budget of characters.
 * Files share it first: a file under its fair share keeps its whole patch and
 * leaves the rest to bigger ones. Inside a file over its share the hunks share
 * that file's part the same way: small hunks stay whole, big ones keep their
 * first lines. Each cut patch ends with a note naming what it lost and the page
 * and path that return it alone, up to REVIEW_FILE_LIMIT characters. Lock files and generated files, known by
 * their path, keep only a stat line. Notes and stat lines are paid for before
 * the split, so a page never exceeds the budget.
 */

/** Characters of patch text in one page of files, notes included. About 15,000 tokens; it holds 30 notes many times over. */
export const REVIEW_DIFF_BUDGET = 60_000;
/** A file read alone by path keeps up to this much of its patch. */
export const REVIEW_FILE_LIMIT = 100_000;

export interface BudgetFile { path: string; additions: number; deletions: number; patch: string | null }
export interface BudgetedPatch { patch: string | null; omitted: number }

const LOCK_FILES = new Set(['bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'gemfile.lock',
  'poetry.lock', 'pipfile.lock', 'composer.lock', 'go.sum', 'flake.lock', 'uv.lock', 'packages.lock.json', 'pubspec.lock', 'mix.lock', 'podfile.lock']);
const GENERATED_PATH = /(^|\/)(dist|vendor|node_modules|__generated__)\/|\.(lock|min\.js|min\.css|map|snap|pb\.go|g\.dart)$|_pb2\.py$|[._-]generated\.[a-z0-9]+$/i;

export function generatedFile(path: string): boolean {
  return LOCK_FILES.has(path.slice(path.lastIndexOf('/') + 1).toLowerCase()) || GENERATED_PATH.test(path);
}

/** A path past 200 characters is not repeated: the file entry carries it, and the note stays short. */
const where = (page: number, path: string) => `read it alone, up to ${REVIEW_FILE_LIMIT} characters, with threads.pullRequestFiles page ${page} path ${path.length > 200 ? 'of this file' : JSON.stringify(path)}`;

/**
 * Max-min fair split: the smallest asks are served whole and what they leave
 * goes to the rest. Never hands out more than `budget` in total.
 */
export function fairShares(sizes: number[], budget: number): number[] {
  const shares = sizes.map(() => 0), order = sizes.map((_, i) => i).sort((a, b) => sizes[a]! - sizes[b]!);
  let left = Math.max(0, budget), waiting = sizes.length;
  for (const i of order) { shares[i] = Math.min(sizes[i]!, Math.floor(left / waiting)); left -= shares[i]!; waiting--; }
  return shares;
}

/** Each part first gets its floor, the least it can be shown in; the rest is split fairly over what each still asks. */
function flooredShares(sizes: number[], floors: number[], budget: number): number[] {
  const extra = fairShares(sizes.map((size, i) => size - floors[i]!), budget - floors.reduce((n, f) => n + f, 0));
  return floors.map((floor, i) => floor + extra[i]!);
}

/** Splits a patch before each `@@` header. Text before the first header stays with the first hunk. */
function hunks(patch: string): string[][] {
  const out: string[][] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@') || !out.length) out.push([line]); else out.at(-1)!.push(line);
  }
  return out;
}

/** One hunk cut to `limit` characters at a line boundary; the header always stays. */
const marker = (n: number) => `[${n} more line${n === 1 ? '' : 's'} of this hunk left out]`;

function cutHunk(lines: string[], limit: number): { lines: string[]; omitted: number } {
  const kept = [lines[0]!];
  let used = lines[0]!.length + 1;
  const reserve = marker(lines.length).length + 1;
  for (const line of lines.slice(1)) { if (used + line.length + 1 + reserve > limit) break; kept.push(line); used += line.length + 1; }
  const dropped = lines.slice(kept.length);
  return { lines: [...kept, marker(dropped.length)], omitted: dropped.reduce((n, line) => n + line.length + 1, 0) };
}

/** The least a cut patch can take: its note alone. */
function noteOnly(patch: string, page: number, path: string): string {
  const count = hunks(patch).length;
  return `[patch cut to fit the review budget: ${count} of ${count} hunk${count === 1 ? '' : 's'} shortened, ${patch.length} characters in all; ${where(page, path)}]`;
}

/** One patch within `limit` characters, cut inside hunks when one of them does not fit whole. Never longer than `limit` once `limit` holds the note alone. */
export function cutPatch(patch: string, limit: number, page: number, path: string): BudgetedPatch {
  if (patch.length <= limit) return { patch, omitted: 0 };
  const parts = hunks(patch), sizes = parts.map(lines => lines.join('\n').length + 1);
  const note = (shortened: number) => `[patch cut to fit the review budget: ${shortened} of ${parts.length} hunk${parts.length === 1 ? '' : 's'} shortened, ${patch.length} characters in all; ${where(page, path)}]`;
  const room = limit - note(parts.length).length - 1;
  // A hunk shows at least its header and a marker; with no room for all of them, the note alone says where the patch is.
  const floors = parts.map((lines, i) => Math.min(sizes[i]!, lines[0]!.length + 1 + marker(lines.length).length + 1));
  if (room < floors.reduce((n, f) => n + f, 0)) return { patch: note(parts.length), omitted: patch.length };
  const shares = flooredShares(sizes, floors, room), body: string[] = [];
  let shortened = 0, omitted = 0;
  parts.forEach((lines, i) => {
    if (shares[i]! >= sizes[i]!) { body.push(...lines); return; }
    const cut = cutHunk(lines, shares[i]!);
    shortened++; omitted += cut.omitted; body.push(...cut.lines);
  });
  return { patch: [...body, note(shortened)].join('\n'), omitted };
}

/**
 * Patches of one page fitted into `budget`. `omitted` counts the characters of
 * the original patch that the reader does not get.
 */
export function budgetPatches(files: BudgetFile[], page: number, budget = REVIEW_DIFF_BUDGET): BudgetedPatch[] {
  const stats = files.map(f => f.patch !== null && generatedFile(f.path)
    ? `[generated or lock file: +${f.additions} -${f.deletions}, patch of ${f.patch.length} characters left out; ${where(page, f.path)}]` : null);
  const sizes = files.map((f, i) => stats[i]?.length ?? f.patch?.length ?? 0);
  const floors = files.map((f, i) => stats[i] !== null || f.patch === null ? sizes[i]! : Math.min(sizes[i]!, noteOnly(f.patch, page, f.path).length));
  const shares = flooredShares(sizes, floors, budget);
  return files.map((f, i) => {
    if (f.patch === null) return { patch: null, omitted: 0 };
    return stats[i] !== null ? { patch: stats[i]!, omitted: f.patch.length } : cutPatch(f.patch, shares[i]!, page, f.path);
  });
}
