/**
 * Where `boite mochi remember` puts its line in MEMORY.md with `--replace` or
 * `--section`, for the core (`agents/memory.ts`) and the in-memory client
 * alike. Without either, the line goes at the end and neither calls this.
 */

/** The matching lines a refused `--replace` cites, and how much of each. */
const CITED_MAX = 10;
const CITED_CHARS = 200;

export interface MemoryPlacement {
  /** The start of the one line the new one replaces; zero or several such lines refuse the note. */
  replace?: string;
  /** The heading the new line goes under, `## <title>`; missing, the line goes at the end. */
  section?: string;
}

export type MemoryNoted =
  | { memory: string; replaced: string | null; section: boolean }
  | { refused: string; field: 'replace' | 'section' };

/** A note's own words: `- 2026-11-15 Nightly locale` reads `Nightly locale`. */
function noteWords(line: string): string {
  return line.replace(/^\s*[-*+]\s+/, '').replace(/^\d{4}-\d{2}-\d{2}:?\s+/, '');
}

const HEADING = /^(#{1,6})\s+(.*?)[\s#]*$/;

/** The line of the first heading `title` names (`Suivi`, `## Suivi` and `suivi` alike), or -1. */
export function memoryHeading(lines: readonly string[], title: string): number {
  const wanted = title.trim().replace(/^#+\s*/, '').toLowerCase();
  return wanted ? lines.findIndex(line => HEADING.exec(line)?.[2]?.toLowerCase() === wanted) : -1;
}

/**
 * MEMORY.md with `entry` (one line, no newline) placed. A line matches
 * `replace` when it starts with it, or its words do once its bullet and date
 * are left out; headings never match.
 */
export function placeMemoryNote(memory: string, entry: string, placement: MemoryPlacement): MemoryNoted {
  const lines = memory.length ? memory.replace(/\n$/, '').split('\n') : [];
  let at = lines.length;
  let replaced: string | null = null;
  if (placement.replace !== undefined) {
    const start = placement.replace.trim();
    if (!start) return { refused: '--replace needs the start of the line to replace', field: 'replace' };
    const found = lines.flatMap((line, index) => !HEADING.test(line) && (line.trimStart().startsWith(start) || noteWords(line).startsWith(start)) ? [index] : []);
    if (found.length === 0) return { refused: `no line of MEMORY.md starts with ${JSON.stringify(start)}; nothing was written (boite mochi memory reads the file)`, field: 'replace' };
    if (found.length > 1) {
      const cited = found.slice(0, CITED_MAX).map(index => `  ${JSON.stringify(lines[index]!.slice(0, CITED_CHARS))}`);
      const more = found.length > CITED_MAX ? [`  and ${found.length - CITED_MAX} more`] : [];
      return { refused: [`${found.length} lines of MEMORY.md start with ${JSON.stringify(start)}; nothing was written. Give more of the start of the one to replace:`, ...cited, ...more].join('\n'), field: 'replace' };
    }
    at = found[0]!;
    replaced = lines[at]!;
    lines.splice(at, 1);
  }
  let section = false;
  if (placement.section !== undefined) {
    if (!placement.section.trim().replace(/^#+\s*/, '')) return { refused: '--section needs the title of a heading', field: 'section' };
    const heading = memoryHeading(lines, placement.section);
    if (heading < 0) at = lines.length;
    else {
      section = true;
      const level = HEADING.exec(lines[heading]!)![1]!.length;
      // The section runs to the next heading of its level or above; the line goes after its last nonblank line.
      let end = heading + 1;
      while (end < lines.length && !((HEADING.exec(lines[end]!)?.[1]?.length ?? 7) <= level)) end += 1;
      while (end > heading + 1 && !lines[end - 1]!.trim()) end -= 1;
      at = end;
    }
  }
  lines.splice(at, 0, entry);
  return { memory: `${lines.join('\n')}\n`, replaced, section };
}

