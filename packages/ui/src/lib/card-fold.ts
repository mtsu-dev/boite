/**
 * A project card stays short: its rows with something to say (the user's
 * turn, work, a failure, news, a pin, the open thread) always show, then the
 * quiet ones fill it up to `keep` rows and the rest fold under one "N more"
 * line. One row is never folded alone: its line would take the row's place.
 */
export function foldQuiet<T>(rows: readonly T[], live: (row: T) => boolean, keep = 3): { shown: T[]; folded: T[] } {
  const shown: T[] = [], folded: T[] = [];
  let room = Math.max(0, keep - rows.filter(live).length);
  for (const row of rows) {
    if (live(row)) shown.push(row);
    else if (room > 0) { shown.push(row); room--; }
    else folded.push(row);
  }
  return folded.length > 1 ? { shown, folded } : { shown: [...rows], folded: [] };
}
