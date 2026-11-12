/*
 * What agent-desktop may do where the desktop shares the user's session
 * (docs/internals/desktop.md#windows-and-macos). A Windows desktop is hidden but its
 * clipboard, notifications and physical input are the user's; on macOS the
 * apps run among the user's own, so every command must also aim at an app the
 * conversation started. Linux has its own display and needs none of this.
 */
import type { VirtualDesktopKind } from '@boite/contracts';

/** The agent-desktop commands `boite desktop` passes on Windows and macOS. */
const SHARED_SESSION_COMMANDS = new Set([
  'snapshot', 'find', 'get', 'is', 'screenshot',
  'click', 'right-click', 'set-value', 'clear', 'select', 'toggle', 'check', 'uncheck', 'expand', 'collapse', 'scroll', 'scroll-to',
  'wait', 'list-apps', 'list-windows', 'list-surfaces', 'list-displays',
  'close-app', 'resize-window', 'move-window', 'minimize', 'maximize', 'restore',
  'status', 'permissions', 'version', 'skills', 'session', 'trace', 'help',
]);

/** Why a refused command is refused, and what does the job instead. */
const REFUSED: Record<string, string> = {
  type: 'types with real keys; use set-value @ref "text"',
  press: 'sends keys to the foreground app, which is the user\'s; click the menu item or button instead',
  'key-down': 'holds the user\'s keyboard', 'key-up': 'holds the user\'s keyboard',
  focus: 'takes the user\'s keyboard focus', 'focus-window': 'brings a window over the user\'s',
  'double-click': 'moves the user\'s mouse', 'triple-click': 'moves the user\'s mouse', hover: 'moves the user\'s mouse', drag: 'moves the user\'s mouse',
  'mouse-move': 'moves the user\'s mouse', 'mouse-click': 'moves the user\'s mouse', 'mouse-down': 'moves the user\'s mouse', 'mouse-up': 'moves the user\'s mouse', 'mouse-wheel': 'moves the user\'s mouse',
  'clipboard-get': 'reads the user\'s clipboard', 'clipboard-set': 'writes the user\'s clipboard', 'clipboard-clear': 'clears the user\'s clipboard',
  'list-notifications': 'reads the user\'s notifications', 'dismiss-notification': 'acts on the user\'s notifications',
  'dismiss-all-notifications': 'acts on the user\'s notifications', 'notification-action': 'acts on the user\'s notifications',
  'open-system-surface': 'opens the user\'s taskbar, menus or Dock', 'cursor-overlay': 'draws over the user\'s screen',
  launch: 'starts an app Boite does not track; use boite desktop run',
  batch: 'runs commands Boite cannot check one by one; run them one at a time',
};

/** Flags that read or show more than an app's window: a display, an HTML capture, the session's events. */
const SCREEN_FLAGS: Record<string, string> = {
  '--screen': 'captures a whole display, the user\'s windows included; use --window-id',
  '--screenshot': 'writes a capture Boite cannot aim at one window',
  '--debug': 'writes a capture Boite cannot aim at one window',
  '--event': 'watches every app and window of the session',
  '--notification': 'reads the user\'s notifications',
};

/** The surfaces of an app's own windows; the others (Dock, taskbar, menu bar extras) are the user's. */
const APP_SURFACES = new Set(['window', 'focused', 'menu', 'sheet', 'popover', 'alert']);

/** Commands that read or act on no app: they need no target. */
const UNTARGETED = new Set(['status', 'permissions', 'version', 'skills', 'session', 'trace', 'help', 'list-displays', 'list-apps', 'list-windows']);

/** Commands whose word right after the command is a ref from a snapshot. */
const REF_COMMANDS = new Set(['click', 'right-click', 'set-value', 'clear', 'select', 'toggle', 'check', 'uncheck', 'expand', 'collapse', 'scroll', 'scroll-to', 'get', 'is']);

/** `wait` flags that read the front app or the session's windows, whatever --element says. */
const WAIT_ON_APP = ['--window', '--text', '--menu', '--menu-closed'];

/** A ref from a snapshot, `@s8f3k2p9:e1`: snapshots only reach the conversation's apps, so their refs do too. */
const REF = /^@[A-Za-z0-9]+:e\d+$/;

/** The words before `--`: after it come texts, never flags. */
export function flagWords(args: string[]): string[] {
  const end = args.indexOf('--');
  return end === -1 ? args : args.slice(0, end);
}

/** The value of `--name value` or `--name=value`, or null. */
export function flagValue(args: string[], name: string): string | null {
  const words = flagWords(args);
  for (let at = 0; at < words.length; at++) {
    if (words[at] === name) return words[at + 1] ?? null;
    if (words[at]!.startsWith(`${name}=`)) return words[at]!.slice(name.length + 1);
  }
  return null;
}

/** True when `words` holds `name` or `name=value`. */
function hasFlag(words: string[], name: string): boolean {
  return words.some(word => word === name || word.startsWith(`${name}=`));
}

/** The flags that name what a command reaches, checked against the conversation's apps. */
const SCOPE_FLAGS = ['--window-id', '--app', '--surface', '--root', '--element'];

/** Why `args` may not run on a desktop of kind `kind`, or null. Linux takes everything. */
export function sharedSessionRefusal(kind: VirtualDesktopKind, args: string[]): string | null {
  if (kind === 'x11') return null;
  const where = kind === 'windows' ? 'a hidden Windows desktop' : 'macOS, among the user\'s own apps';
  const [command = ''] = args;
  const words = flagWords(args);
  if (hasFlag(words, '--headed')) return `--headed is refused on ${where}: it drives the user's own keyboard and mouse`;
  const reason = REFUSED[command];
  if (reason) return `${command} is refused on ${where}: it ${reason}`;
  if (!SHARED_SESSION_COMMANDS.has(command)) return `${command} is not one boite desktop runs on ${where}`;
  for (const [flag, why] of Object.entries(SCREEN_FLAGS)) {
    if (hasFlag(words, flag)) return `${flag} is refused on ${where}: it ${why}`;
  }
  // agent-desktop finds the app by process name, which may be the user's copy; stop ends the conversation's apps.
  if (command === 'close-app' && (kind === 'windows' || hasFlag(words, '--force'))) {
    return `close-app${kind === 'windows' ? '' : ' --force'} is refused on ${where}: it can reach the user's copy of the app; boite desktop stop ends the conversation's apps`;
  }
  if (command === 'permissions' && (hasFlag(words, '--request') || hasFlag(words, '--guide'))) {
    return 'permissions only reads here: --request and --guide open prompts and settings in the user\'s session, which are the user\'s to answer';
  }
  // Only the first value of a flag is checked, so a second one could carry another target.
  const repeated = SCOPE_FLAGS.find(flag => words.filter(word => word === flag || word.startsWith(`${flag}=`)).length > 1);
  if (repeated) return `${repeated} is given more than once; give it once`;
  const surface = flagValue(args, '--surface');
  if (surface !== null && !APP_SURFACES.has(surface)) return `--surface ${surface} is the user's, not an app's; use one of ${[...APP_SURFACES].join(', ')}`;
  return null;
}

export interface ListedWindow { id: string; pid: number; app_name?: string; title?: string }

/**
 * macOS: why `args` would reach an app the conversation did not start, or
 * null. `windows` is agent-desktop's `list-windows`, `owned` the pids of the
 * desktop's apps and their children.
 */
export function macosTargetProblem(args: string[], windows: ListedWindow[], owned: ReadonlySet<number>): string | null {
  const [command = ''] = args;
  if (UNTARGETED.has(command)) return null;
  const words = flagWords(args).slice(1);
  const windowId = flagValue(args, '--window-id');
  if (windowId !== null) {
    const window = windows.find(found => found.id === windowId);
    if (!window || !owned.has(window.pid)) {
      const mine = windows.filter(found => owned.has(found.pid)).map(found => `${found.id} (${found.app_name ?? 'app'}${found.title ? `: ${found.title}` : ''})`);
      return `window ${windowId} is not one of this conversation's apps${mine.length ? `; its windows: ${mine.join(', ')}` : ''}`;
    }
  }
  // close-app names its app as its first word.
  const app = command === 'close-app' ? words.find(word => !word.startsWith('-')) ?? null : flagValue(args, '--app');
  if (app !== null) return appProblem(app, windows, owned);
  if (windowId !== null) return null;
  // A ref right after the command comes from a snapshot, which only reached the conversation's apps.
  if (REF_COMMANDS.has(command) && REF.test(words[0] ?? '')) return null;
  // A snapshot under a ref, or a wait on one, reads only that ref's app.
  if (command === 'snapshot' && REF.test(flagValue(args, '--root') ?? '')) return null;
  if (command === 'wait') {
    if (REF.test(flagValue(args, '--element') ?? '') && !WAIT_ON_APP.some(flag => hasFlag(words, flag))) return null;
    if (words.length === 1 && /^\d+$/.test(words[0]!)) return null;
  }
  if (REF_COMMANDS.has(command)) return `${command} takes its ref right after it here: boite desktop ${command} @ref ...`;
  return `${command} needs --app or --window-id naming an app this conversation started; without one it reaches the user's front app`;
}

/** Why the app named `app` is not only the conversation's, or null. */
function appProblem(app: string, windows: ListedWindow[], owned: ReadonlySet<number>): string | null {
  const named = windows.filter(window => sameApp(window.app_name, app));
  const mine = named.filter(window => owned.has(window.pid));
  if (mine.length === 0) return `${app} is not one of this conversation's apps: start it with boite desktop run`;
  if (mine.length < named.length) return `the user runs ${app} too: name the window with --window-id ${mine[0]!.id}`;
  return null;
}

function sameApp(listed: string | undefined, wanted: string): boolean {
  const plain = (name: string) => name.toLowerCase().replace(/\.app$/, '');
  return listed !== undefined && plain(listed) === plain(wanted);
}

/** `list-apps` or `list-windows` JSON with only the owned entries, or the text unchanged when it is not that JSON. */
export function ownedListing(stdout: string, owned: ReadonlySet<number>): string {
  let parsed: { data?: unknown };
  try { parsed = JSON.parse(stdout); } catch { return stdout; }
  const keep = (list: unknown) => Array.isArray(list) ? list.filter(entry => owned.has((entry as { pid?: number }).pid ?? -1)) : list;
  if (Array.isArray(parsed.data)) parsed.data = keep(parsed.data);
  else if (parsed.data && typeof parsed.data === 'object' && 'apps' in parsed.data) (parsed.data as { apps: unknown }).apps = keep((parsed.data as { apps: unknown }).apps);
  return `${JSON.stringify(parsed)}\n`;
}

export interface ProcessEntry { pid: number; ppid: number; name: string }

/** `ps -axo pid=,ppid=,comm=` output; `comm`, the executable, may hold spaces. */
export function parsePs(ps: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of ps.split('\n')) {
    const found = /^\s*(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (found) entries.push({ pid: Number(found[1]), ppid: Number(found[2]), name: found[3]!.trim() });
  }
  return entries;
}

/** The pids under `roots`, roots included. */
export function descendants(roots: number[], processes: ProcessEntry[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of processes) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const found = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (found.has(pid)) continue;
    found.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}
