/*
 * How a program reaches a hidden Windows desktop: `boite-core --desktop-exec
 * <WinSta0\name> <program> [args...]` starts it there and waits for it
 * (platform/windows/hidden-desktop.ts). The core runs apps through it, the CLI
 * runs agent-desktop through it, both as ordinary child processes, so the
 * program keeps their job, trace, pipes and exit code.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DESKTOP_EXEC = '--desktop-exec';

/** A compiled boite-core embeds its sources; a checkout runs main.ts with bun. */
function compiled(url = import.meta.url): boolean {
  return url.startsWith('file:///$bunfs/') || url.startsWith('file:///B:/~BUN/');
}

/**
 * The command that runs `argv` on the hidden desktop `path`. Under bun the
 * entry is `src/main.ts` from the sources, or `main.js` beside this chunk in
 * the bundle an installed Boite runs.
 */
export function desktopExecCommand(path: string, argv: string[], execPath = process.execPath, isCompiled = compiled()): string[] {
  const entry = isCompiled ? null : ['../main.ts', './main.js'].map(file => fileURLToPath(new URL(file, import.meta.url))).find(existsSync) ?? null;
  return [execPath, ...(entry ? [entry] : []), DESKTOP_EXEC, path, ...argv];
}
