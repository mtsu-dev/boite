/*
 * Apps that keep one copy per user (docs/desktop.md#windows-and-macos). On a
 * Windows hidden desktop or among the user's macOS apps, launching Chrome while
 * the user's Chrome runs hands the request to the user's copy, which opens the
 * window on the user's screen. A browser gets a profile of its own in the
 * desktop's folder, which makes it a separate copy; another such app is
 * refused while the user runs it.
 */
import { join } from 'node:path';
import { descendants, type ProcessEntry } from './scope.ts';

/** Chromium browsers and Electron editors: `--user-data-dir` makes a copy of their own. */
const USER_DATA_DIR = new Set([
  'chrome', 'google chrome', 'chromium', 'chromium-browser', 'msedge', 'microsoft edge', 'brave', 'brave browser',
  'vivaldi', 'opera', 'thorium', 'code', 'code - insiders', 'cursor', 'windsurf',
]);

/** Firefox and its forks: `-no-remote -profile <folder>`. */
const FIREFOX = new Set(['firefox', 'librewolf', 'waterfox', 'zen']);

/** Apps that pass a launch to the user's running copy and take no profile. */
const SINGLE = new Set([
  'notepad', 'calc', 'calculatorapp', 'mspaint', 'winword', 'excel', 'powerpnt', 'outlook', 'onenote', 'msteams', 'ms-teams', 'teams',
  'discord', 'slack', 'spotify', 'steam', 'obsidian', 'windowsterminal', 'wt', 'telegram', 'whatsapp',
]);

/** The executable's own name, lowercased, without folder or `.exe`: `C:\...\chrome.exe` and `.../MacOS/Google Chrome` give `chrome` and `google chrome`. */
export function imageName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).toLowerCase().replace(/\.exe$/, '');
}

const hasFlag = (args: string[], names: string[]) => args.some(arg => names.some(name => arg === name || arg.startsWith(`${name}=`)));

export interface Launch {
  /** The arguments to start the app with, a profile added where it takes one. */
  args: string[];
  /** The profile folder to create before the start, or null. */
  profile: string | null;
}

/**
 * How to start `program` (the path the core will run) on a desktop whose
 * folder is `dir`, or why not: `processes` is every process of the machine,
 * `roots` the pids of the conversation's running apps.
 */
export function singleInstanceLaunch(program: string, args: string[], dir: string, processes: ProcessEntry[], roots: number[]): Launch | { refused: string } {
  const name = imageName(program);
  if (name === 'explorer') return { refused: 'explorer opens its windows in the user\'s own Explorer; run the program a folder or file opens instead' };
  if (USER_DATA_DIR.has(name)) {
    if (hasFlag(args, ['--user-data-dir'])) return { args, profile: null };
    const profile = join(dir, 'profiles', name);
    return { args: [`--user-data-dir=${profile}`, ...args], profile };
  }
  if (FIREFOX.has(name)) {
    if (hasFlag(args, ['-profile', '--profile', '-P'])) return { args, profile: null };
    const profile = join(dir, 'profiles', name);
    return { args: ['-no-remote', '-profile', profile, ...args], profile };
  }
  if (SINGLE.has(name)) {
    const owned = descendants(roots, processes);
    if (processes.some(entry => imageName(entry.name) === name && !owned.has(entry.pid))) {
      return { refused: `${name} already runs on the user's desktop and would open its window there; close it first or use another app` };
    }
  }
  return { args, profile: null };
}
