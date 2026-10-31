/**
 * `boite desktop`: the conversation's private virtual desktop (Linux). The
 * core starts the desktop and the apps on it, which outlive the turn; every
 * other word goes to agent-desktop, run here with the desktop's environment,
 * so its refs, snapshots and screenshots see that desktop and nothing else.
 * The agent-desktop is the pinned build the core installs (desktop.tool), or
 * one on the agent's PATH when that install is refused. See docs/desktop.md.
 */
import { RpcErrorCode, VIRTUAL_DESKTOP_SIZE, type VirtualDesktopApp, type VirtualDesktopSession, type VirtualDesktopSupport } from '@boite/contracts';
import type { CoreClient } from './client.ts';
import type { CliIo } from './cli.ts';
import { Usage } from './cli-args.ts';
import { DESKTOP_MARK, withDesktopEnv } from './desktop/env.ts';

export const DESKTOP_HELP = `boite desktop <command> [args]
  status                         this conversation's desktop, its apps, and what
                                 the machine lacks to start one
  start [--size WxH]             start it (${VIRTUAL_DESKTOP_SIZE.defaultWidth}x${VIRTUAL_DESKTOP_SIZE.defaultHeight} by default); run starts it too
  run <program> [args...]        start a GUI app on it, in the current folder; it
                                 outlives the turn, its output goes to a log file
  env                            export lines for one command of yours, in a subshell:
                                 (eval "$(boite desktop env)"; bun test)
  stop                           stop the desktop and every app on it
  <agent-desktop command>        anything else runs agent-desktop on the desktop:
    list-apps                              the names --app takes, not always the program's
    snapshot --app <name> -i --compact     the accessibility tree with @refs
    click @ref | type @ref "text" | press ctrl+s | set-value @ref "v"
    type --headed @ref "text"              real keys, safe on this private display, for
                                           a web field with no text action of its own
    find --role button --name Save | wait --text Done
    screenshot --app <name> shot.png       then boite attach shot.png, from this folder
    skills get desktop                     agent-desktop's own guide, in boite desktop words
A Linux machine only: Xvfb in memory, openbox, its own D-Bus and accessibility
bus. Nothing reaches the user's screen, keyboard or speakers. Chrome, Electron,
Qt and GTK apps expose their tree there; refs come from the last snapshot.
Boite installs agent-desktop itself the first time. Archiving the conversation
stops the desktop.`;

/** agent-desktop commands that read no desktop. */
const OFFLINE = new Set(['skills', 'version', 'help', '--help', '-h', '--version', '-V']);

export interface DesktopCliResult {
  lines: string[];
  value: unknown;
  /** agent-desktop's own output and exit code, printed as it gave them. */
  output?: { stdout: string; stderr: string; exitCode: number };
}

function supportLines(support: VirtualDesktopSupport): string[] {
  return support.available ? [] : [`no virtual desktop on this machine: ${support.reason ?? 'no reason given'}`];
}

function appLine(app: VirtualDesktopApp): string {
  return `  pid ${app.pid}  ${app.exitCode === null ? 'running' : `exited ${app.exitCode}`}  ${app.command}\n    log: ${app.log}`;
}

function sessionLines(session: VirtualDesktopSession): string[] {
  return [`desktop: ${session.display} ${session.width}x${session.height}`, ...(session.apps.length ? ['apps:', ...session.apps.map(appLine)] : ['apps: none'])];
}

/** POSIX shell words, as `eval` reads them back. */
const quote = (value: string) => /^[\w.:/=@,+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

/** Where agent-desktop is on the agent's PATH, or null. */
export function findAgentDesktop(env: CliIo['env']): string | null {
  return Bun.which('agent-desktop', { PATH: env['PATH'] ?? env['Path'] ?? '' });
}

/**
 * The pinned agent-desktop Boite installs. One on PATH only when the core could
 * not install it, or is too old to know desktop.tool; never past a refusal, such
 * as the machine policy turning the desktop off.
 */
async function agentDesktopBinary(io: CliIo, client: CoreClient, threadId: string): Promise<string> {
  try {
    return (await client.call('desktop.tool', { threadId })).path;
  } catch (error) {
    const code = (error as { rpc?: { code?: number } }).rpc?.code;
    const own = code === RpcErrorCode.Unavailable || code === RpcErrorCode.MethodNotFound ? findAgentDesktop(io.env) : null;
    if (own) return own;
    throw error;
  }
}

/**
 * agent-desktop's guides and help name its own command; here the same words
 * go through `boite desktop`, which aims them at this conversation's desktop.
 * Only a command form is rewritten: in code or `$(...)`, at an indented line
 * start (a JSON-escaped `\n` included) or after `Usage: `.
 */
export function inBoiteWords(text: string): string {
  return text.replace(/(`|\$\(|(?:^|\\n)[ \t]*|Usage: )agent-desktop (?=[\w@<[-])/gm, '$1boite desktop ');
}

function size(rest: string[]): { width?: number; height?: number } {
  const at = rest.indexOf('--size');
  if (at === -1) return {};
  const match = /^(\d+)x(\d+)$/.exec(rest[at + 1] ?? '');
  if (!match) throw new Usage('desktop start --size takes WIDTHxHEIGHT, such as 1280x800');
  rest.splice(at, 2);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function done(rest: string[]): void {
  if (rest.length > 0) throw new Usage(`desktop does not take ${rest[0]}\n${DESKTOP_HELP}`);
}

async function agentDesktop(binary: string, args: string[], io: CliIo, env: Record<string, string> | null): Promise<DesktopCliResult> {
  const child = Bun.spawn({
    cmd: [binary, ...args],
    cwd: io.cwd,
    env: env ? withDesktopEnv(io.env, env) : io.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [raw, rawErr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  // Guides and help only: an app's own text in a snapshot stays as the app wrote it.
  const words = env === null;
  const stdout = words ? inBoiteWords(raw) : raw;
  const stderr = words ? inBoiteWords(rawErr) : rawErr;
  return { lines: [stdout.trimEnd()], value: { stdout, stderr, exitCode }, output: { stdout, stderr, exitCode } };
}

export async function desktopCommand(args: string[], io: CliIo, client: CoreClient, threadId: string): Promise<DesktopCliResult> {
  const [command = 'status', ...rest] = args;
  switch (command) {
    case 'help': return { lines: [DESKTOP_HELP], value: { help: DESKTOP_HELP } };
    case 'status': {
      done(rest);
      const status = await client.call('desktop.status', { threadId });
      return { lines: [...supportLines(status.support), ...(status.session ? sessionLines(status.session) : ['desktop: not started'])], value: status };
    }
    case 'start': {
      const wanted = size(rest);
      done(rest);
      const { session } = await client.call('desktop.start', { threadId, ...wanted });
      return { lines: sessionLines(session), value: { session } };
    }
    case 'run': {
      const words = rest[0] === '--' ? rest.slice(1) : rest;
      if (words.length === 0) throw new Usage('desktop run needs a program, such as: boite desktop run gnome-calculator');
      const { app, session } = await client.call('desktop.run', { threadId, command: words, cwd: io.cwd });
      const state = app.exitCode === null ? `running as pid ${app.pid} on ${session.display}` : `exited at once with code ${app.exitCode}; its output is in ${app.log}`;
      return { lines: [`${app.command}: ${state}`, ...(app.exitCode === null ? [`log: ${app.log}`] : [])], value: { app, session } };
    }
    case 'env': {
      done(rest);
      const { session } = await client.call('desktop.status', { threadId });
      if (!session) throw new Error('no desktop yet: boite desktop start');
      // Without the mark: a shell that exports it would have its own commands, `boite desktop stop` included, killed by the stop.
      const env = Object.fromEntries(Object.entries(session.env).filter(([key]) => key !== DESKTOP_MARK));
      const lines = Object.entries(env).map(([key, value]) => value === '' ? `unset ${key}` : `export ${key}=${quote(value)}`);
      return { lines, value: { env } };
    }
    case 'stop': {
      done(rest);
      const { stopped } = await client.call('desktop.stop', { threadId });
      return { lines: [stopped ? 'desktop stopped' : 'no desktop was running'], value: { stopped } };
    }
    default: {
      // Words after `--` are text (`type @ref -- --help`), never a request for help.
      const flags = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
      if (OFFLINE.has(command) || flags.includes('--help') || flags.includes('-h')) return agentDesktop(await agentDesktopBinary(io, client, threadId), args, io, null);
      const { session, support } = await client.call('desktop.status', { threadId });
      // The policy can turn the desktop off while one runs: nothing more acts on it, only stop.
      if (!support.available) throw new Error(supportLines(support)[0]!);
      if (!session) throw new Error('no desktop yet: boite desktop run <app> starts one with the app');
      return agentDesktop(await agentDesktopBinary(io, client, threadId), args, io, session.env);
    }
  }
}
