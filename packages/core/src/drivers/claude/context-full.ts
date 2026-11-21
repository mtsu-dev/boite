/*
 * Claude Code stops a turn with "Autocompact is thrashing" when three
 * compactions in a row left the conversation refilled to its limit within
 * three turns. What every request carries is then too big for any summary to
 * help: the instruction files the CLI loads from the thread's folder and its
 * parents are the usual cause, and the CLI's own advice (read in smaller
 * chunks, /clear) does not name them. A resume fails the same way.
 */

import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The CLI's words for it, as 2.1.329 writes them. */
export const CONTEXT_FULL = /autocompact is thrashing/i;

/** Files the CLI loads into every request from each folder between the thread's and the root. */
const LOADED = ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', 'AGENTS.md'];
/** Claude Code warns about an instruction file past 40,000 characters. */
export const LARGE_INSTRUCTIONS = 40_000;

export interface LoadedFile { path: string; bytes: number }

/** The instruction files over `LARGE_INSTRUCTIONS` in `cwd` and its parents, largest first. */
export function largeInstructionFiles(cwd: string): LoadedFile[] {
  const found: LoadedFile[] = [];
  for (let dir = cwd, parent = dirname(dir); ; dir = parent, parent = dirname(dir)) {
    for (const name of LOADED) {
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        if (stat.isFile() && stat.size > LARGE_INSTRUCTIONS) found.push({ path, bytes: stat.size });
      } catch { /* absent or unreadable: the CLI does not load it either */ }
    }
    if (parent === dir) break;
  }
  return found.sort((a, b) => b.bytes - a.bytes);
}

const kilobytes = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

/**
 * Why the turn stopped and what frees the context, naming the large files the
 * CLI may load from `cwd` up: candidates, since the CLI's own choice (which
 * files, what they import) is not visible from here.
 */
export function contextFullReason(cwd: string): string {
  const head = 'Claude could not compact this conversation: what every request carries refilled the compaction limit within three turns, three times in a row, so Boite does not resume it.';
  const files = largeInstructionFiles(cwd);
  if (files.length === 0) {
    return `${head} Shrink the instruction files the agent loads (AGENTS.md, CLAUDE.md) or what it reads at once, or raise the token limit in Settings, Advanced, Automatic compaction, then write to the thread.`;
  }
  const named = files.map(file => `${file.path} (${kilobytes(file.bytes)})`).join(', ');
  return `${head} Large instruction files in the thread's folder and its parents, likely in every request: ${named}. Shrink ${files.length === 1 ? 'it' : 'them'}, then write to the thread.`;
}
