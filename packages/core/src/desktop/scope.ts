/*
 * What agent-desktop may do where the desktop shares the user's session
 * (docs/desktop.md#windows-and-macos). A Windows desktop is hidden but its
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

/** The surfaces of an app's own windows; the others (Dock, taskbar, menu bar extras) are the user's. */
const APP_SURFACES = new Set(['window', 'focused', 'menu', 'sheet', 'popover', 'alert']);

/** Commands that read or act on no app: they need no target. */
const UNTARGETED = new Set(['status', 'permissions', 'version', 'skills', 'session', 'trace', 'help', 'list-displays', 'list-apps', 'list-windows']);

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

/** Why `args` may not run on a desktop of kind `kind`, or null. Linux takes everything. */
export function sharedSessionRefusal(kind: VirtualDesktopKind, args: string[]): string | null {
  if (kind === 'x11') return null;
  const where = kind === 'windows' ? 'a hidden Windows desktop' : 'macOS, among the user\'s own apps';
  const [command = ''] = args;
  const words = flagWords(args);
  if (words.includes('--headed')) return `--headed is refused on ${where}: it drives the user's own keyboard and mouse`;
  const reason = REFUSED[command];
  if (reason) return `${command} is refused on ${where}: it ${reason}`;
  if (!SHARED_SESSION_COMMANDS.has(command)) return `${command} is not one boite desktop runs on ${where}`;
  const surface = flagValue(args, '--surface');
  if (surface !== null && !APP_SURFACES.has(surface)) return `--surface ${surface} is the user's, not an app's; use one of ${[...APP_SURFACES].join(', ')}`;
  if (command === 'wait' && words.includes('--notification')) return 'wait --notification reads the user\'s notifications';
  return null;
}

export interface ListedWindow { id: string; pid: number; app_name?: string; title?: string }

/** A ref from a snapshot, `@s8f3k2p9:e1`: snapshots only reach the conversation's apps, so their refs do too. */
const REF = /^@[A-Za-z0-9]+:e\d+$/;

/**
 * macOS: why `args` would reach an app the conversation did not start, or
 * null. `windows` is agent-desktop's `list-windows`, `owned` the pids of the
 * desktop's apps and their children.
 */
export function macosTargetProblem(args: string[], windows: ListedWindow[], owned: ReadonlySet<number>): string | null {
  const [command = ''] = args;
  if (UNTARGETED.has(command)) return null;
  const words = flagWords(args).slice(1);
  const ownedIds = () => windows.filter(window => owned.has(window.pid)).map(window => `${window.id} (${window.app_name ?? 'app'}${window.title ? `: ${window.title}` : ''})`);
  const windowId = flagValue(args, '--window-id');
  if (windowId !== null) {
    const window = windows.find(found => found.id === windowId);
    if (window && owned.has(window.pid)) return null;
    return `window ${windowId} is not one of this conversation's apps${ownedIds().length ? `; its windows: ${ownedIds().join(', ')}` : ''}`;
  }
  const app = flagValue(args, '--app');
  if (app !== null) {
    const named = windows.filter(window => sameApp(window.app_name, app));
    const mine = named.filter(window => owned.has(window.pid));
    if (mine.length === 0) return `${app} is not one of this conversation's apps: start it with boite desktop run`;
    if (mine.length < named.length) return `the user runs ${app} too: name the window with --window-id ${mine[0]!.id}`;
    return null;
  }
  // A ref, or a wait on time or on a ref, needs no app of its own.
  if (words.some(word => REF.test(word))) return null;
  if (command === 'wait' && (words.length === 0 || /^\d+$/.test(words[0]!))) return null;
  return `${command} needs --app or --window-id naming an app this conversation started; without one it reads the user's front app`;
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

/** The pids under `roots`, roots included, from `ps -axo pid=,ppid=` output. */
export function descendants(roots: number[], ps: string): Set<number> {
  const children = new Map<number, number[]>();
  for (const line of ps.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    children.set(ppid!, [...(children.get(ppid!) ?? []), pid!]);
  }
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
