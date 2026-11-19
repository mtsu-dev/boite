/**
 * What a mochi's next turn is told when its MEMORY.md changed since its
 * session last read it: the lines gone and the lines new, instead of the whole
 * context block again (`context.ts`).
 */

const HEADING = /^#{1,6}\s/;

/**
 * The lines gone and the lines new between two reads of a memory, by content
 * rather than position, blank lines aside: a line that only moved is neither.
 * Each new line names the heading it sits under, or null above the first.
 */
export function memoryChange(before: string, after: string): { removed: string[]; added: { line: string; heading: string | null }[] } {
  const left = new Map<string, number>();
  for (const line of before.split('\n')) if (line.trim()) left.set(line, (left.get(line) ?? 0) + 1);
  const added: { line: string; heading: string | null }[] = [];
  let heading: string | null = null;
  for (const line of after.split('\n')) {
    if (!line.trim()) continue;
    const kept = left.get(line) ?? 0;
    if (kept > 0) left.set(line, kept - 1);
    else added.push({ line, heading });
    if (HEADING.test(line)) heading = line.trim();
  }
  const removed: string[] = [];
  for (const line of before.split('\n')) {
    const count = left.get(line) ?? 0;
    if (count > 0) { removed.push(line); left.set(line, count - 1); }
  }
  return { removed, added };
}

/** The note a turn carries for a memory that changed, or '' when no line did (only blank lines moved). */
export function memoryChangeText(path: string, before: string, after: string): string {
  const { removed, added } = memoryChange(before, after);
  if (!removed.length && !added.length) return '';
  const parts = [`Boite: your memory changed since this session last read it (${path}).`];
  if (removed.length) parts.push(`Lines removed:\n${removed.join('\n')}`);
  let group: { heading: string | null; lines: string[] } | null = null;
  const groups: { heading: string | null; lines: string[] }[] = [];
  for (const { line, heading } of added) {
    if (group === null || group.heading !== heading) groups.push(group = { heading, lines: [] });
    group.lines.push(line);
  }
  for (const { heading, lines } of groups) parts.push(`Lines added ${heading === null ? 'at the top' : `under ${heading}`}:\n${lines.join('\n')}`);
  return `${parts.join('\n\n')}\n\n`;
}
