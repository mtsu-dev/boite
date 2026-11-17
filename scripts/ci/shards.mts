/**
 * The split shared by the E2E, core and UI shards. The UI test sequencer loads
 * it under Node through the Vitest config: no Bun API, and `.mts` because the
 * root package is CommonJS to Node.
 */
export type Shard = { files: string[]; seconds: number };

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Longest first, each to the lightest shard; ties go to the lower shard and
 * equal times keep path order, so every runner computes the same split.
 */
export function assignShards(files: string[], seconds: Record<string, number>, count: number): Shard[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count: expected a positive integer, got ${count}`);
  const fallback = median(files.flatMap((file) => seconds[file] === undefined ? [] : [seconds[file]!]));
  const timed = files.map((file) => ({ file, seconds: seconds[file] ?? fallback }));
  timed.sort((a, b) => b.seconds - a.seconds || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const shards: Shard[] = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const { file, seconds: cost } of timed) {
    const lightest = shards.reduce((best, shard) => shard.seconds < best.seconds ? shard : best);
    lightest.files.push(file);
    lightest.seconds += cost;
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}
