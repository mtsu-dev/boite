/*
 * What changed between two snapshots of one document, for an agent that
 * already read the first: the lines added and removed, and above each run of
 * them the last unchanged heading, landmark or iframe line, which says where
 * on the page it is.
 */

/** Lines that place a change on the page: a heading, a landmark or the iframe around a frame's lines. */
const PLACE = /^\s*- (heading|iframe|navigation|main|form|dialog|complementary|region|banner|contentinfo)\b/;
/** The table of the longest common run holds this many cells at most; two snapshots that differ more are printed whole. */
const CELLS_MAX = 4_000_000;

/**
 * The diff from `before` to `after`, both lists of snapshot lines, or null
 * when they differ too much to compare. Each line carries a mark an agent
 * cannot take for a snapshot line: `+ ` added, `- ` removed, `= ` unchanged
 * and shown for context.
 */
export function snapshotDiff(before: string[], after: string[]): string | null {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const olds = before.slice(head, before.length - tail), news = after.slice(head, after.length - tail);
  if (!olds.length && !news.length) return `no change since your last snapshot of this page, ${after.length} lines unchanged; snapshot --full prints everything`;
  const width = news.length + 1;
  if ((olds.length + 1) * width > CELLS_MAX) return null;
  // common[i * width + j]: the longest common run of olds from i and news from j.
  const common = new Uint16Array((olds.length + 1) * width);
  for (let i = olds.length - 1; i >= 0; i--) {
    for (let j = news.length - 1; j >= 0; j--) {
      common[i * width + j] = olds[i] === news[j] ? common[(i + 1) * width + j + 1]! + 1 : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
    }
  }
  let place: string | null = null, placed: string | null = null;
  for (let at = 0; at < head; at++) if (PLACE.test(after[at]!)) place = after[at]!;
  const out: string[] = [];
  let removed: string[] = [], added: string[] = [], unchanged = head + tail;
  const flush = () => {
    if (!removed.length && !added.length) return;
    if (place !== null && place !== placed) { out.push(`= ${place}`); placed = place; }
    for (const line of removed) out.push(`- ${line}`);
    for (const line of added) out.push(`+ ${line}`);
    removed = []; added = [];
  };
  let i = 0, j = 0;
  while (i < olds.length || j < news.length) {
    if (i < olds.length && j < news.length && olds[i] === news[j]) {
      flush(); unchanged++;
      if (PLACE.test(news[j]!)) { place = news[j]!; placed = null; }
      i++; j++;
    } else if (j < news.length && (i === olds.length || common[i * width + j + 1]! >= common[(i + 1) * width + j]!)) added.push(news[j++]!);
    else removed.push(olds[i++]!);
  }
  flush();
  return [`diff since your last snapshot of this page, ${unchanged} lines unchanged (+ added, - removed, = context); snapshot --full prints everything`, ...out].join('\n');
}
