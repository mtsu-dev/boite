/**
 * How the agent dock lays its entries out: rows of at most `width`, two of
 * them, each entry at its whole name's width; when that leaves some out, every
 * entry narrows to `short` first. Only three or more left over become one
 * "+N" at the end of the last row; one or two keep their names on a third row.
 * Returns the entry indices per row and how many the "+N" stands for.
 */
export function dockRows(natural: number[], width: number, { gap = 8, more = 48, short = 120 } = {}): { rows: number[][]; hidden: number } {
  const pack = (needs: number[]) => {
    const rows: number[][] = [[]];
    let used = 0;
    for (let at = 0; at < needs.length; at++) {
      const need = Math.min(needs[at]!, width), row = rows[rows.length - 1]!;
      if (row.length > 0 && used + gap + need > width) {
        if (rows.length === 2) break;
        rows.push([]); used = 0;
      }
      used += (rows[rows.length - 1]!.length > 0 ? gap : 0) + need;
      rows[rows.length - 1]!.push(at);
    }
    return rows;
  };
  const held = (rows: number[][]) => rows.reduce((sum, row) => sum + row.length, 0);
  const whole = pack(natural);
  if (held(whole) === natural.length) return { rows: whole, hidden: 0 };
  const narrow = natural.map((need) => Math.min(need, short));
  const rows = pack(narrow);
  const left = natural.length - held(rows);
  if (left === 0) return { rows, hidden: 0 };
  if (left < 3) return { rows: [...rows, narrow.slice(held(rows)).map((_, at) => held(rows) + at)], hidden: 0 };
  // The "+N" takes its room on the last row from the entries before it.
  const last = rows[rows.length - 1]!;
  let room = last.reduce((sum, at) => sum + narrow[at]! + gap, 0) + more;
  while (last.length > 1 && room > width) room -= narrow[last.pop()!]! + gap;
  return { rows, hidden: natural.length - held(rows) };
}
