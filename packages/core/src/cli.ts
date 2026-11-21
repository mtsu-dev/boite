/**
 * `boite`, the CLI an agent runs inside a thread. It is `boite-core cli`
 * behind a shim on the PATH; a process the thread launched finds the core and
 * its own token in the environment the core put there (`AGENT_ENV`) and says
 * hello as the `agent` of that thread. Every answer is a few `key: value`
 * lines or one row per item, which is what a model reads back at the lowest
 * cost; `--json` gives the raw result to a script.
 *
 * Without that environment, `--thread <id>` drives any thread with the owner
 * token read out of `core.json`, the way `boite-core pair` finds its core.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
// Every `boite` call evaluates what is imported here before its command runs:
// the words, the flags and the help. Each command loads its own module, the
// client and the contracts once it runs (scripts/architecture/cli-startup.ts).
import { AGENT_ENV } from '../../contracts/src/agent-door.ts';
import { AGENT_SETTING_KEYS } from '../../contracts/src/agent-setting-requests.ts';
import { SETTINGS_PAGES } from '../../contracts/src/setting-requests.ts';
import type { AgentTask, AgentTaskChange, GitChange, PanelSurface, RpcParams, SettingsReading, Todo } from '@boite/contracts';
import type { CoreClient } from './client.ts';
import { CORE_VERSION } from './version.ts';
import { resolveDataDir } from './paths.ts';
import { canonicalCommand, contextRequest, parse, requiredText, Usage, type Parsed } from './cli-args.ts';
import { PLUGIN_COMMAND_TIMEOUT_MS, isControlCommand, isPluginCommandWord, ownerWithoutThread } from './cli-commands.ts';
import { cliHelp, cliUsageError, DEFAULT_HELP } from './cli-help.ts';
import type { Caller } from './control-cli.ts';

export { USAGE } from './cli-help.ts';

/** Command implementations share one lazy boundary (cli-families.ts). */
const families = () => import('./cli-families.ts');

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** Everything piped in, for a command that reads `-`. */
  stdin?(): Promise<string>;
}

const STATUS_LETTER: Record<GitChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflict: 'U',
};

const TASK_MARK: Record<AgentTask['status'], string> = {
  pending: '[ ]',
  in_progress: '[>]',
  completed: '[x]',
};


interface Target {
  url: string;
  token: string;
  threadId: string;
}

/** Loopback, Tailscale's 100.64.0.0/10 and its fd7a:115c:a1e0::/48: links that already encrypt or never leave the machine. */
export function privateLink(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
  const v4 = /^100\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) return Number(v4[1]) >= 64 && Number(v4[1]) <= 127;
  return host.startsWith('fd7a:115c:a1e0:');
}

/** The environment first; `--thread` and `core.json` when the command runs outside a thread. */
function targetOf(parsed: Parsed, env: CliIo['env']): Target {
  const url = env[AGENT_ENV.coreUrl] || undefined;
  const token = env[AGENT_ENV.token] || undefined;
  const own = env[AGENT_ENV.threadId] || undefined;
  if (url && token && own) {
    // Inside a thread the CLI speaks for that thread and no other: `--thread`
    // is the owner's way in from a terminal, not an agent's way out of its own.
    if (parsed.thread !== undefined && parsed.thread !== own) {
      throw new Error(`this CLI speaks for thread ${own}, not thread ${parsed.thread}`);
    }
    if (parsed.core !== undefined) throw new Error(`this CLI speaks for thread ${own} on its own core; --core is for a terminal`);
    return { url, token, threadId: own };
  }
  const threadId = parsed.thread ?? own ?? (['server', 'logs', 'issue', 'journal-check', 'plugin'].includes(parsed.positional[0] ?? '') || isPluginCommandWord(parsed.positional[0]) || ownerWithoutThread(parsed) ? '' : undefined);
  if (parsed.core !== undefined) {
    // The token stays out of the command line, where any process listing would show it.
    const remoteToken = env.BOITE_TOKEN || undefined;
    if (remoteToken === undefined) throw new Error('--core needs the token in BOITE_TOKEN');
    let url: URL;
    try { url = new URL(parsed.core); } catch { throw new Error(`--core: expected a URL such as https://host:3773, got ${parsed.core}`); }
    // The hello carries the token: cleartext only where the link is already private, loopback or a Tailscale address.
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateLink(url.hostname))) {
      throw new Error(`--core: expected https://, or http:// on loopback or a Tailscale address, got ${parsed.core}`);
    }
    const origin = url.origin;
    if (threadId === undefined) throw new Error(`pass --thread <id> with --core for ${parsed.positional[0] ?? 'this command'}`);
    return { url: origin, token: remoteToken, threadId };
  }
  if (threadId === undefined) {
    throw new Error(`not inside a Boite thread (${AGENT_ENV.threadId} is not set); pass --thread <id>`);
  }
  const dataDir = resolveDataDir(parsed.dataDir, parsed.channel);
  const file = join(dataDir, 'core.json');
  if (!existsSync(file)) throw new Error(`no core has run on ${dataDir}: ${file} does not exist`);
  let state: { port?: unknown; host?: unknown; token?: unknown };
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as typeof state;
  } catch {
    throw new Error(`${file} is not JSON`);
  }
  if (typeof state.port !== 'number' || typeof state.token !== 'string' || state.token.length === 0) {
    throw new Error(`${file} has no port or no token`);
  }
  const bound = typeof state.host === 'string' ? state.host : '127.0.0.1';
  const host = bound === '0.0.0.0' || bound === '::' ? '127.0.0.1' : bound;
  return { url: `http://${host.includes(':') ? `[${host}]` : host}:${state.port}`, token: state.token, threadId };
}

/** `src/a.ts:12` split into the file and the line; a Windows drive letter is not a line. */
export function splitLine(spec: string): { path: string; line: number | undefined } {
  const match = /^(.*):(\d+)$/.exec(spec);
  if (match && match[1] !== undefined && match[1].length > 0) return { path: match[1], line: Number(match[2]) };
  return { path: spec, line: undefined };
}

function absolute(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function taskRow(task: AgentTask): string {
  return `${task.id} ${TASK_MARK[task.status]} ${task.text}`;
}

function todoRow(todo: Todo): string {
  return `${todo.id} ${todo.status} ${todo.text}`;
}

function changeRow(change: GitChange): string {
  const counts = change.additions === null ? '' : ` +${change.additions} -${change.deletions ?? 0}`;
  const from = change.oldPath === null ? '' : ` (from ${change.oldPath})`;
  return `${STATUS_LETTER[change.status]}${change.staged ? '*' : ' '} ${change.path}${counts}${from}`;
}

type Printer = (lines: string[], value: unknown) => void;

/** A command that ran a child: the child's own output and code as it gave them, or the lines with --json. */
function childOutput(result: { lines: string[]; value: unknown; output?: { stdout: string; stderr: string; exitCode: number } }, json: boolean, io: CliIo, print: Printer): number | undefined {
  if (result.output === undefined || json) { print(result.lines, result.value); return result.output?.exitCode; }
  if (result.output.stdout) io.out(result.output.stdout);
  if (result.output.stderr) io.err(result.output.stderr);
  return result.output.exitCode;
}

async function run(parsed: Parsed, io: CliIo, client: CoreClient, threadId: string, print: Printer, caller: Caller): Promise<void | number> {
  const [command, ...rest] = parsed.positional;
  if (isControlCommand(parsed)) {
    await (await families()).controlCommand(client, caller, threadId, parsed, print);
    return;
  }
  const want = (index: number, what: string): string => {
    const value = rest[index];
    if (value === undefined || value.length === 0) throw new Usage(`${command} needs ${what}`);
    return value;
  };
  const opened = async (surface: PanelSurface): Promise<void> => {
    const { shown } = await client.call('panel.open', { threadId, surface });
    print([`shown: ${shown ? 'yes' : 'no, nobody is watching this thread; it is queued on its panel'}`], { shown });
  };

  // An agent's token reads the anonymized view; the owner's terminal reads its own records.
  const agentCaller = Boolean(io.env[AGENT_ENV.coreUrl] && io.env[AGENT_ENV.token] && io.env[AGENT_ENV.threadId]);
  /** `--rules-file`, read from where the command runs. */
  const readRules = (path: string): string => readFileSync(absolute(io.cwd, path), 'utf8');
  const commands: Record<string, () => Promise<void | number>> = {
    'journal-check': async () => {
      if (rest.length !== 0 && rest.length !== 2) throw new Usage('journal-check expects no arguments or a cursor table and rowid');
      const cursor = rest.length ? { table: rest[0] as import('@boite/contracts').JournalInspectionTable, afterRowid: Number(rest[1]) } : null;
      if (parsed.limit !== undefined && parsed.limit > 200) throw new Usage('journal-check takes --limit up to 200');
      const result = await client.call('journal.inspect', { cursor, limit: parsed.limit ?? 100 });
      print([`checked: ${result.checked}; issues: ${result.issues.length}; more: ${result.truncated ? 'yes' : 'no'}`,
        ...result.issues.map(issue => `${issue.table} row ${issue.rowId}: ${issue.code} (${issue.field}: ${issue.expected})`),
        ...(result.cursor ? [`next: boite journal-check ${result.cursor.table} ${result.cursor.afterRowid}`] : [])], result);
    },
    pr: async () => {
      const action = rest[0] ?? 'list';
      if (!['list', 'refresh', 'link', 'unlink', 'watch', 'unwatch'].includes(action) || rest.length > (action === 'list' || action === 'refresh' ? 1 : 2)) throw new Usage('pr expects list, refresh, link <url>, unlink <url>, watch [<url|number>] or unwatch [<url|number>]');
      if (action === 'watch') {
        const watch = await client.call('threads.watchPullRequest', { threadId, ...(rest[1] === undefined ? {} : { url: rest[1] }) });
        print([`watching #${watch.number} ${watch.url}: ${watchStatus(watch)}`, 'Boite wakes this thread when it changes: end your turn, do not poll.'], watch);
        return;
      }
      if (action === 'unwatch') {
        const left = await client.call('threads.unwatchPullRequest', { threadId, ...(rest[1] === undefined ? {} : { url: rest[1] }) });
        print(left.length ? left.map(watch => `still watching #${watch.number} ${watch.url}: ${watchStatus(watch)}`) : ['no pull request watched'], left);
        return;
      }
      const result = action === 'link' || action === 'unlink'
        ? await client.call(action === 'link' ? 'threads.linkPullRequest' : 'threads.unlinkPullRequest', { threadId, url: want(1, 'a pull request URL') })
        : await client.call('threads.pullRequests', { threadId, refresh: action === 'refresh' });
      print(result.map(pr => `${pr.state} #${pr.number} ${pr.title} (${pr.head} -> ${pr.base}) ${pr.url}${pr.error ? ` [${pr.error}]` : ''}`), result);
    },
    browser: async () => {
      const { BROWSER_HELP, browserCommand, browserRecipe, browserRun } = await families();
      if (rest[0] === 'help') return print([BROWSER_HELP], { help: BROWSER_HELP });
      const result = rest[0] === 'run' ? await browserRun(rest.slice(1), io, client, threadId)
        : rest[0] === 'recipe' ? await browserRecipe(rest.slice(1), io, client, threadId)
        : await browserCommand(rest, io, client, threadId);
      print(result.lines, result.value);
    },
    device: async () => {
      const result = await (await families()).deviceCommand(rest, io, client, threadId, parsed.timeout);
      print(result.lines, result.value);
    },
    window: async () => childOutput(await (await families()).windowCommand(rest, io, client, threadId), parsed.json, io, print),
    desktop: async () => childOutput(await (await import('./desktop-cli.ts')).desktopCommand(rest, io, client, threadId), parsed.json, io, print),
    secret: async () => childOutput(await (await families()).secretCommand(rest, io, client, threadId), parsed.json, io, print),
    team: async () => childOutput(await (await (await families()).teamCli()).teamCommand(rest, client, threadId, parsed.requestId), parsed.json, io, print),
    // `boite --limit 5 logs` parsed them as globals: they come first, so the command's own flags still win.
    // A global `--level` yields to the command's own `--min-level`, which it would otherwise override.
    logs: async () => (await families()).logsCommand([...(parsed.limit === undefined ? [] : ['--limit', String(parsed.limit)]), ...(parsed.level === undefined || rest.some(entry => entry === '--min-level' || entry.startsWith('--min-level=')) ? [] : ['--level', parsed.level]), ...rest], client, threadId, agentCaller, io.cwd, print),
    issue: async () => (await families()).issueCommand(rest, client, threadId, agentCaller, io.cwd, print),
    server: async () => {
      const action = rest[0] ?? 'check';
      if (!['check', 'update', 'cancel'].includes(action)) throw new Usage('server expects check, update or cancel');
      let state = action === 'cancel' ? await client.call('core.updateCancel', {}) : await client.call('core.updateStatus', { refresh: true });
      if (action === 'update') {
        if (state.phase === 'error') throw new Error(state.error ?? 'Server update check failed');
        if (state.mode !== 'systemd' && state.mode !== 'android') throw new Error('Automatic server updates need a standalone Linux systemd user installation or the managed Android server; see docs/internals/server.md');
        if (state.version && state.phase === 'available') state = await client.call('core.updateInstall', { version: state.version });
      }
      print([`server: ${state.currentVersion}`, `update: ${state.phase}`, ...(state.version ? [`version: ${state.version}`] : []), ...(state.error ? [`error: ${state.error}`] : [])], state);
    },
    bot: async () => {
      if (rest[0] === 'event') {
        if (rest.length < 3) throw new Usage('mochi event needs a mochi and the text: boite mochi event <mochi> [--key <key>] <text>');
        const sent = await client.call('agents.event', { agent: rest[1]!, text: rest.slice(2).join(' '), ...(parsed.key === undefined ? {} : { key: parsed.key }) });
        print([`event: ${sent.key} for ${sent.agentId}`, 'It wakes the mochi once its thread is free; a later event with the same key replaces it until then.'], sent);
        return;
      }
      const result = await (await families()).botCommand(client, threadId, rest);
      print([JSON.stringify(result)], result);
    },
    attach: async () => {
      const message = await client.call('artifacts.publish', { threadId, path: absolute(io.cwd, want(0, 'a file')) });
      print([`attached: ${rest[0]}`, `message: ${message.id}`], message);
    },
    proof: async () => {
      if (rest.length < 3 || rest.length > 4) throw new Usage('boite proof <message-id> <output-line> <unchecked> [capture]');
      const [messageId, line, unchecked, capture] = rest;
      const message = await client.call('artifacts.prove', {
        threadId, messageId: messageId!, line: line!, unchecked: unchecked!,
        ...(capture === undefined ? {} : { path: absolute(io.cwd, capture) }),
      });
      print([`proof: ${message.id}`], message);
    },
    delegate: async () => {
      const { DELEGATE_ACTIONS, delegateCommand } = await families();
      if (rest[0] === undefined) throw new Usage(`delegate needs ${DELEGATE_ACTIONS}`);
      await delegateCommand(client, threadId, rest, {
        ...(parsed.project === undefined ? {} : { project: parsed.project }),
        ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }), ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }),
        ...(parsed.title === undefined ? {} : { title: parsed.title }), ...(parsed.model === undefined ? {} : { model: parsed.model }),
        ...(parsed.effort === undefined ? {} : { effort: parsed.effort }), ...(parsed.speed === undefined ? {} : { speed: parsed.speed }), ...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
        ...(parsed.worktree === true ? { worktree: true } : {}), ...(parsed.refresh === true ? { refresh: true } : {}), ...(parsed.machine === undefined ? {} : { machine: parsed.machine }),
        ...(parsed.context === undefined ? {} : { context: contextRequest(parsed, readRules) }),
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
        owner: !agentCaller,
        cwd: io.cwd,
      }, print);
    },
    // `threads` alone or `threads list` lists (control-cli.ts); the rest talks to other threads.
    threads: async () => {
      const { agentsCommand, AgentsUsage } = await families();
      try {
        await agentsCommand(client, threadId, rest, { ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }), wait: parsed.wait, ...(parsed.timeout === undefined ? {} : { timeout: parsed.timeout }), ...(parsed.last === undefined ? {} : { last: parsed.last }), ...(parsed.before === undefined ? {} : { before: parsed.before }), ...(parsed.entry === undefined ? {} : { entry: parsed.entry }), ...(parsed.offset === undefined ? {} : { offset: parsed.offset }), ...(parsed.tool === undefined ? {} : { tool: parsed.tool }) }, print);
      } catch (error) {
        if (error instanceof AgentsUsage) throw new Usage(error.message);
        throw error;
      }
    },
    contacts: async () => { await (await families()).contactsCommand(client, threadId, rest, { ...(parsed.project === undefined ? {} : { project: parsed.project }), ...(parsed.model === undefined ? {} : { model: parsed.model }), ...(parsed.effort === undefined ? {} : { effort: parsed.effort }), worktree: parsed.worktree }, print); },
    workflow: async () => { await (await families()).workflowCommand(client, threadId, rest, io, print, parsed.requestId); },
    where: async () => {
      const where = await client.call('agent.where', { threadId });
      print(
        [
          `thread: ${where.threadId}`,
          `title: ${where.title}`,
          `project: ${where.projectPath}`,
          `cwd: ${where.cwd}`,
          `branch: ${where.branch ?? '(none)'}`,
          `worktree: ${where.worktree ? 'yes' : 'no'}`,
          `agent: ${where.providerId} ${where.model}`,
        ],
        where,
      );
    },
    projects: async () => { await (await families()).projectsCommand(client, caller, threadId, parsed, io.cwd, print); },
    thread: async () => {
      const action = want(0, 'move or new');
      if (action === 'new' && caller === 'owner') {
        if (parsed.machine !== undefined) throw new Usage('thread new --machine is for an agent in a thread; from a terminal, reach that machine with --core');
        // From a terminal the brief is the user's own prompt, not an agent's.
        await (await families()).ownerThreadNew(client, parsed, rest, print, contextRequest(parsed, readRules));
        return;
      }
      if (action === 'new') {
        const project = want(1, 'a project name, id or folder (boite projects lists them)');
        const prompt = requiredText(rest, 2, 'thread new needs a brief after the project');
        const spawned = await client.call('agent.spawn', {
          threadId, project, prompt, requestId: parsed.requestId ?? crypto.randomUUID(),
          ...(parsed.title === undefined ? {} : { title: parsed.title }), ...(parsed.worktree ? { worktree: true } : {}),
          ...(parsed.machine === undefined ? {} : { machine: parsed.machine }),
          ...(parsed.model === undefined ? {} : { model: parsed.model }), ...(parsed.effort === undefined ? {} : { effort: parsed.effort }), ...(parsed.speed === undefined ? {} : { speed: parsed.speed }),
          ...(parsed.context === undefined ? {} : { context: contextRequest(parsed, readRules) as RpcParams<'agent.spawn'>['context'] }),
        });
        // A bot hears of it through events on its desk, not as a message, on this machine or another.
        const persistent = await client.call('agents.snapshot', { threadId }).then(snapshot => snapshot.profiles.length > 0, () => false);
        const machine = spawned.machine ?? parsed.machine;
        print((await families()).spawnedLines(spawned, machine, persistent), spawned);
        return;
      }
      if (action !== 'move') throw new Usage(`thread: unknown action ${action}`);
      const project = requiredText(rest, 1, 'thread move needs a project name, id or folder');
      const moved = await client.call('agent.move', { threadId, project });
      const where = moved.cwd ?? `a new folder of ${moved.projectPath}`;
      const background = moved.stopsBackground ? ' Background work stops then.' : '';
      print(
        moved.when === 'turn-end'
          ? [`Moves to ${moved.project} (${moved.projectPath}) when this turn ends; the next turn starts in ${where}.${background}`]
          : [`Moved to ${moved.project} (${moved.projectPath}); the next turn starts in ${where}.${background}`],
        moved,
      );
    },
    show: async () => {
      const { path, line } = splitLine(want(0, 'a file'));
      await opened({ kind: 'file', path: absolute(io.cwd, path), ...(line === undefined ? {} : { line }) });
    },
    diff: async () => {
      const path = rest[0];
      await opened(path === undefined ? { kind: 'diff' } : { kind: 'diff', path: absolute(io.cwd, path) });
    },
    browse: async () => {
      const target = want(0, 'a url or an HTML file');
      if (!/^https?:/i.test(target) && /\.html?$/i.test(target)) {
        const result = await client.call('artifacts.preview', { threadId, path: absolute(io.cwd, target) });
        print([`preview: ${result.url}`, `shown: ${result.shown}`], result);
      } else await opened({ kind: 'browser', url: target });
    },
    view: async () => {
      if (rest[0] === 'help' || rest[0] === undefined) {
        const { VIEW_HELP } = await families();
        print([VIEW_HELP], { help: VIEW_HELP });
        return;
      }
      if (rest[0] === 'example') {
        const { VIEW_EXAMPLE } = await families();
        print([VIEW_EXAMPLE], { example: VIEW_EXAMPLE });
        return;
      }
      if (rest[0] === 'check') {
        const result = await (await families()).viewCheckCommand(rest.slice(1), io.cwd, client, threadId);
        print(result.lines, result.value);
        return result.code;
      }
      const result = await client.call('artifacts.view', { threadId, path: absolute(io.cwd, want(0, 'an HTML file')), ...(parsed.title === undefined ? {} : { title: parsed.title }) });
      const view = result.message.parts[0]?.type === 'artifact' ? result.message.parts[0].view : undefined;
      const source = view?.source ?? rest[0]!;
      const line = `![${(view?.title ?? '').replace(/[\s[\]]+/g, ' ').trim()}](${/[\s()<>]/.test(source) ? `<${source}>` : source})`;
      print([
        `view: ${view?.title ?? rest[0]}`,
        result.checked
          ? `checked: loaded without an error, ${view?.height}px tall on a desktop${view?.narrowHeight ? `, ${view.narrowHeight}px on a phone` : ''}`
          : 'checked: no, this machine has no browser to load it in; read the page once more before you answer',
        `place: ${line} alone on a line of your answer, right after the paragraph it explains. Without that line it is drawn under your final text when this turn ends. Do not announce it or repeat what it shows.`,
        ...result.advice.map(advice => `advice: ${advice}`),
      ], result);
    },
    preview: async () => {
      const result = await client.call('artifacts.preview', { threadId, path: absolute(io.cwd, want(0, 'an HTML file')) });
      print([`preview: ${result.url}`, `shown: ${result.shown}`], result);
    },
    'preview-close': async () => {
      const result = await client.call('artifacts.previewClose', { threadId, path: absolute(io.cwd, want(0, 'an HTML file')) });
      print(['preview closed'], result);
    },
    open: async () => {
      const kind = want(0, 'trace, tasks, changes, files or workflow');
      if (kind === 'trace' || kind === 'tasks') await opened({ kind });
      else if (kind === 'workflow') await opened(rest[1] === undefined ? { kind } : { kind, runId: rest[1] });
      else if (kind === 'changes') await opened({ kind: 'diff' });
      else if (kind === 'files') {
        const dir = rest[1];
        await opened(dir === undefined ? { kind: 'files' } : { kind: 'files', path: absolute(io.cwd, dir) });
      } else throw new Usage(`open: unknown surface ${kind}`);
    },
    settings: async () => {
      const { agentSettingArg, clipped, pictureDataUrl, settingsPlace, settingValue } = await families();
      const action = rest[0];
      if (action === 'request' || action === 'open') {
        if (parsed.why === undefined || parsed.why.trim().length === 0) throw new Usage(`settings ${action} needs --why <text>, the reason the user reads on the card`);
        const params = action === 'request'
          ? { threadId, reason: parsed.why, key: want(1, 'a setting key (boite settings lists them)'), value: settingValue(requiredText(rest, 2, 'settings request needs a value after the key', false)),
              ...(parsed.machine === undefined ? {} : { machine: parsed.machine }) }
          : { threadId, reason: parsed.why, ...settingsPlace(want(1, `a page: ${SETTINGS_PAGES.join(', ')}`)) };
        if (action === 'open' && rest.length > 2) throw new Usage('settings open takes one page, with an optional #card');
        const asked = await client.call('settings.request', params);
        const setting = asked.setting;
        print([
          `requested: ${asked.questionId}`,
          ...(setting.kind === 'change'
            ? [`change: ${setting.key} ${JSON.stringify(setting.previous)} -> ${JSON.stringify(setting.value)}${setting.machine === undefined ? '' : ` on ${setting.machine.name}`}`, typeof setting.value === 'boolean' ? 'card: the switch itself, in the chat' : 'card: Apply in the chat, or open Settings at the setting']
            : [`card: opens Settings at ${setting.section === null ? setting.page : `${setting.page}#${setting.section}`}`]),
          'Keep working. The outcome arrives as a message quoting your reason; without one, nothing changed.',
        ], asked);
        return;
      }
      if (action === 'bot') {
        const agent = parsed.bot === undefined ? {} : { agent: parsed.bot };
        if (rest[1] === 'create') {
          if (rest.length !== 3) throw new Usage('settings mochi create takes one name; quote a name with spaces');
          const created = await client.call('agents.create', {
            threadId, name: rest[2]!,
            ...(parsed.domain === undefined ? {} : { domain: parsed.domain }),
            ...(parsed.instructionsFile === undefined ? {} : { instructions: readRules(parsed.instructionsFile) }),
            ...(parsed.model === undefined ? {} : { model: parsed.model }),
            ...(parsed.effort === undefined ? {} : { effort: parsed.effort }),
            ...(parsed.project === undefined ? {} : { projects: parsed.project.split(',').map(name => name.trim()).filter(Boolean) }),
          });
          if (!('agent' in created)) {
            const { bot: asked } = created.setting;
            print([
              `asked: ${created.questionId}`,
              `card: the owner approves or declines the mochi ${asked.name} (${asked.selection.providerId}/${asked.selection.model ?? 'default'}, full access${created.setting.projects.length === 0 ? '' : `, projects ${created.setting.projects.join(', ')}`})`,
              (await families()).BOT_CARD_NOTE,
              'Keep working. The outcome arrives as a message (approved, declined); without one, nothing was created.',
            ], created);
            return;
          }
          const { agent: bot, threadId: conversation } = created;
          const { selection } = bot;
          print([
            `created: ${bot.name} (${bot.id})`,
            `route: ${selection.providerId}/${selection.model ?? 'default'}${selection.effort === null ? '' : ` (${selection.effort})`}`,
            ...(bot.projectIds?.length ? [`projects: ${bot.projectIds.join(', ')}`] : []),
            ...(conversation === null ? [] : [`conversation: ${conversation}; boite threads send ${conversation} <text> writes to it`]),
            'It introduces itself and schedules what its instructions call for.',
          ], created);
          return;
        }
        if (rest[1] === 'picture') {
          if (rest.length !== 3) throw new Usage('settings mochi picture takes one image file, or a robot code, one or two characters or "" for the robot its id draws');
          const wanted = rest[2]!;
          const file = absolute(io.cwd, wanted);
          const isFile = wanted.trim() !== '' && existsSync(file);
          if (!isFile && !/^(bot|img):/.test(wanted) && /[./\\]/.test(wanted)) throw new Usage(`settings mochi picture: no file at ${file}`);
          const avatar = isFile ? (await client.call('agents.picture.put', { threadId, dataUrl: pictureDataUrl(file) })).avatar : wanted;
          const saved = await client.call('agents.avatar.set', { threadId, avatar, ...agent });
          print([
            `picture: ${saved.name} (${saved.id}) now wears ${saved.avatar === '' ? 'the robot its id draws' : saved.avatar}`,
            'The user sees it at once, in the mochi list and its conversation.',
          ], saved);
          return;
        }
        if (rest[1] === 'request') {
          if (parsed.why === undefined || parsed.why.trim().length === 0) throw new Usage('settings mochi request needs --why <text>, the reason the user reads on the card');
          const key = want(2, `a key: ${AGENT_SETTING_KEYS.join(', ')}`);
          const fromFile = key === 'instructions' && parsed.instructionsFile !== undefined;
          if (parsed.picture !== undefined && key !== 'avatar') throw new Usage('--picture goes with settings mochi request avatar');
          const fromPicture = parsed.picture !== undefined;
          if (fromPicture && rest.length > 3) throw new Usage('settings mochi request avatar takes a value or --picture <path>, not both');
          if (!fromPicture && (fromFile ? rest.length > 3 : rest.length < 4)) throw new Usage(fromFile ? 'settings mochi request instructions takes the text or --instructions-file <path>, not both' : 'settings mochi request needs a value after the key');
          const value = fromPicture ? (await client.call('agents.picture.put', { threadId, dataUrl: pictureDataUrl(absolute(io.cwd, parsed.picture!)) })).avatar
            : fromFile ? readRules(parsed.instructionsFile!) : agentSettingArg(key, rest.slice(3));
          const asked = await client.call('agents.settings.request', { threadId, reason: parsed.why, key, value, ...agent });
          const setting = asked.setting;
          print([
            `requested: ${asked.questionId}`,
            `change: ${setting.agentName}'s ${setting.key} ${clipped(JSON.stringify(setting.previous))} -> ${clipped(JSON.stringify(setting.value))}`,
            'card: Apply, or the user changes it in the mochi\'s settings',
            'Keep working. The outcome arrives as a message quoting your reason; without one, nothing changed.',
          ], asked);
          return;
        }
        if (rest.length > 2) throw new Usage('settings mochi expects a key, request <key> <value>, picture <image> or create <name>');
        const read = await client.call('agents.settings.read', { threadId, ...agent });
        const shown = rest[1] === undefined ? read.settings : read.settings.filter(reading => reading.key === rest[1]);
        if (shown.length === 0) throw new Usage(`settings mochi: unknown key ${rest[1]}; the keys are ${AGENT_SETTING_KEYS.join(', ')}`);
        const named = (reading: (typeof shown)[number], value: unknown): string => {
          const text = JSON.stringify(reading.key === 'projects' && Array.isArray(value) ? value.map(id => reading.choices?.find(choice => choice.id === id)?.label ?? id) : value ?? null);
          return rest[1] === undefined ? clipped(text) : text;
        };
        // Every provider's models make a long list: the full view cuts it, `settings mochi model` shows it whole.
        const choices = (reading: (typeof shown)[number]): string => {
          const text = (reading.choices ?? []).map(choice => choice.label === choice.id ? choice.id : `${choice.label} (${choice.id})`).join(', ');
          return rest[1] === undefined ? clipped(text, 600) : text;
        };
        print([
          `mochi: ${read.agentName} (${read.agentId})`,
          ...shown.map(reading => `${reading.key} ${named(reading, reading.value)}${reading.choices?.length ? `\n    choices: ${choices(reading)}` : ''}`),
        ], rest[1] === undefined ? read : shown[0]);
        return;
      }
      if (rest.length > 1) throw new Usage('settings expects a key, a page, request <key> <value> or open <page>');
      const { read, shown } = await (await families()).readSettingsFor(client, threadId, action, 'settings');
      const rows = (await families()).settingsLines(shown, false);
      const one = action !== undefined && !(SETTINGS_PAGES as readonly string[]).includes(action);
      print(action === undefined ? [appLine(read.app), ...rows] : rows, one ? shown[0] : { app: read.app, settings: shown });
    },
    state: async () => (await families()).stateCommand(client, threadId, rest, print),
    ask: async () => {
      if (rest.length === 1 && rest[0] === 'list') {
        await (await families()).controlCommand(client, caller, threadId, { ...parsed, positional: ['questions', threadId] }, print);
        return;
      }
      const text = want(0, 'a question');
      const options = rest.slice(1);
      const asked = await client.call('questions.ask', { threadId, text, ...(options.length > 0 ? { options } : {}), ...(parsed.multiple ? { multiple: true } : {}), ...(parsed.open === undefined ? {} : { open: parsed.open }) });
      print([`asked: ${asked.questionId}`, 'Keep working. The answer arrives as a message quoting the question; without one, go on with a sensible default.'], asked);
    },
    status: async () => {
      const status = await client.call('git.status', { threadId });
      const head = [`branch: ${status.branch ?? '(detached)'}`];
      if (status.upstream !== null) head.push(`upstream: ${status.upstream} +${status.ahead} -${status.behind}`);
      head.push(`changes: ${status.changes.length}`);
      print([...head, ...status.changes.map(changeRow)], status);
    },
    task: async () => {
      const action = want(0, 'list, add, start, done, remove or clear');
      if (action === 'list') {
        const tasks = await client.call('threads.tasks.get', { threadId });
        print(tasks.length === 0 ? ['tasks: none'] : tasks.map(taskRow), tasks);
        return;
      }
      let change: AgentTaskChange;
      if (action === 'add') change = { action, text: requiredText(rest, 1, 'task add needs a text') };
      else if (action === 'clear') change = { action };
      else if (action === 'start' || action === 'done' || action === 'remove') change = { action, id: want(1, 'a task id') };
      else throw new Usage(`task: unknown action ${action}`);
      const { applyAgentTaskChange, isMethodNotFound } = await families();
      const activity = await client.call('threads.tasks.change', { threadId, ...change }).catch(async (error: unknown) => {
        if (!isMethodNotFound(error)) throw error;
        const current = await client.call('threads.tasks.get', { threadId });
        return client.call('threads.tasks.set', { threadId, tasks: applyAgentTaskChange(current, change) });
      });
      print(activity.tasks.length === 0 ? ['tasks: none'] : activity.tasks.map(taskRow), activity.tasks);
    },
    todo: async () => {
      const action = want(0, 'list, add or claim');
      if (action === 'list') {
        const todos = await client.call('todos.list', { threadId });
        print(todos.length === 0 ? ['todos: none'] : todos.map(todoRow), todos);
      } else if (action === 'add') {
        const text = requiredText(rest, 1, 'todo add needs a text');
        const todo = await client.call('todos.add', { threadId, text });
        print([todoRow(todo)], todo);
      } else if (action === 'claim') {
        const todo = await client.call('todos.update', { threadId, todoId: want(1, 'a todo id'), status: 'claimed' });
        print([todoRow(todo)], todo);
      } else throw new Usage(`todo: unknown action ${action}`);
    },
    plugin: async () => (await families()).pluginAction(client, io, threadId, rest, print),
    goal: async () => {
      const action = want(0, 'track');
      if (action !== 'track') throw new Usage(`goal: unknown action ${action}`);
      const activity = await client.call('threads.goal.track', { threadId });
      // This turn is the goal's first: its claim counts, so the agent learns the marker here.
      print([`goal: reviewed, tracking the user's last prompt (${activity.goal?.objective.length ?? 0} characters)`, 'when it is done and verified, end this turn with [BOITE_GOAL_COMPLETE] alone on its last line; a reviewer then checks it'], activity);
    },
  };
  const handler = command !== undefined && Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (handler === undefined && isPluginCommandWord(command)) return (await families()).pluginCommand(client, io, threadId, command!, rest);
  if (handler === undefined) throw new Usage(`unknown command ${command}`);
  return handler();
}

/** The exit code: 0, 1 on a refusal or a failure, 2 on a usage error. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(argv);
    if (parsed.help === undefined && parsed.positional.length === 0) throw new Usage('');
  } catch (error) {
    if (error instanceof Usage) return cliUsageError(io, error);
    throw error;
  }

  const print: Printer = (lines, value) => {
    io.out((parsed.json ? JSON.stringify(value) : lines.join('\n')) + '\n');
  };

  let client: CoreClient | null = null;
  try {
    const help = parsed.help ?? (parsed.positional.length === 1 && DEFAULT_HELP.has(parsed.positional[0]!) ? parsed.positional : undefined);
    if (help) {
      const text = await cliHelp(help);
      if (!help.length && !parsed.json) io.err(text + '\n');
      else print([text], { help: text });
      return 0;
    }
    if (parsed.positional[0] === 'journal-check' && (io.env[AGENT_ENV.coreUrl] || io.env[AGENT_ENV.token] || io.env[AGENT_ENV.threadId])) throw new Error('boite journal-check is owner-only outside the agent environment');
    if (parsed.positional[0] === 'mcp' && (!io.env[AGENT_ENV.coreUrl] || !io.env[AGENT_ENV.token] || !io.env[AGENT_ENV.threadId])) {
      throw new Error('boite mcp requires the thread-bound agent environment; owner credential fallback is disabled');
    }
    const target = targetOf(parsed, io.env);
    // An agent waiting for an answer holds its call up to five minutes; a secret card or command up to an hour.
    // A window capture may wait ten minutes for the owner's consent.
    const waits = parsed.positional[0] === 'threads' && (parsed.wait || parsed.positional[1] === 'wait');
    const requestTimeoutMs = waits ? ((await families()).WAIT_MAX_S + 30) * 1000
      : isPluginCommandWord(parsed.positional[0]) ? PLUGIN_COMMAND_TIMEOUT_MS + 60_000
      : parsed.positional[0] === 'secret' ? 3_660_000
      : parsed.positional[0] === 'window' ? (await families()).WINDOW_REQUEST_TIMEOUT_MS : undefined;
    const { connect } = await families();
    try {
      client = await connect(target.url, target.token, { client: { name: 'cli', version: CORE_VERSION }, ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }) });
    } catch (error) {
      throw new Error(`no core answers at ${target.url}: ${(error as Error).message}`);
    }
    if (parsed.positional[0] === 'mcp') {
      if (parsed.positional.length !== 1 || parsed.json) throw new Usage('boite mcp takes no positional arguments or --json');
      const { runBoiteMcp } = await import('./mcp/server.ts');
      await runBoiteMcp(client, target.threadId, io.err, () => connect(target.url, target.token, { client: { name: 'mcp-wait', version: CORE_VERSION }, requestTimeoutMs: 3_605_000 }));
    } else {
      const caller: Caller = io.env[AGENT_ENV.coreUrl] && io.env[AGENT_ENV.token] && io.env[AGENT_ENV.threadId] ? 'agent' : 'owner';
      const code = await run(parsed, io, client, target.threadId, print, caller);
      if (typeof code === 'number') return code;
    }
    return 0;
  } catch (error) {
    if (error instanceof Usage) {
      const [command, action] = error.command === undefined ? canonicalCommand(parsed.positional) : [error.command, error.action];
      return cliUsageError(io, error, command, action);
    }
    io.err(`error: ${(error as Error).message}\n`);
    return 1;
  } finally {
    client?.close();
  }
}

export function processIo(): CliIo {
  return {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
    stdin: () => Bun.stdin.text(),
  };
}

/** One line on what a watch last saw, for `boite pr watch` and `unwatch`. */
export function watchStatus(watch: import('@boite/contracts').PullRequestWatch): string {
  const paused = watch.paused ? `paused until ${new Date(watch.paused.until).toISOString()} (${watch.paused.reason === 'rate-limit' ? 'GitHub rate limit' : watch.paused.message})` : null;
  const seen = watch.seen;
  if (!seen) return paused ?? 'not read yet';
  const { total, running, failed } = seen.checks;
  const checks = total === 0 ? 'no checks' : `${total} checks, ${running} running, ${failed} failed`;
  const queue = seen.queue ? `merge queue position ${seen.queue.position}` : null;
  const baseFailure = seen.baseFailure;
  const baseStatus = baseFailure ? `base ${seen.base} (${baseFailure.sha.slice(0, 7)}): ${baseFailure.name} failed (${baseFailure.conclusion.toLowerCase()})${baseFailure.url ? ` ${baseFailure.url}` : ''}` : null;
  return [`head ${seen.head}`, checks, baseStatus, seen.conflicting ? `conflicts with ${seen.base}` : null, seen.behind ? `behind ${seen.base}` : null, queue, paused].filter(Boolean).join('; ');
}

/**
 * The first line of `boite settings`: which language the user reads Boite in,
 * so the agent names a setting the way the screen does, and where experiments
 * come from.
 */
function appLine(app: SettingsReading['app']): string {
  if (app === null) return 'app: no Boite app has reported yet; experiments are unknown and names are the keys';
  const language = app.language === 'fr' ? 'French' : 'English';
  const where = app.client === 'shell' ? `the desktop app${app.device === null ? '' : ` on ${JSON.stringify(app.device)}`}` : app.device === null ? 'the web app' : `the web app on a ${app.device}`;
  return `app: ${where} speaks ${language}; quoted names are what the user sees there, experiments are that app's own`;
}
