/**
 * `bun run dev:instance`: this checkout's core and UI on the persistent Dev
 * data (`boite2-dev`), headless, started in the background. See
 * docs/internals/development.md, "Testing in Boite Dev".
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PAIR_QUERY_PARAM } from '../../packages/contracts/src/index.ts';
import { ensureProductionUi, productionUiIsFresh } from '../../tests/e2e/lib/prod-ui.ts';
import { processPlatform } from '../../packages/core/src/platform/index.ts';
import { BRANCH_SCHEMA, copyDevData, coreUrl, devDataDir, lockHolder, messages, schemaState } from './dev-data.ts';

const ROOT = resolve(import.meta.dir, '..', '..');
const MAIN = join(ROOT, 'packages', 'core', 'src', 'main.ts');
const READY = /boite-core ready (\S+)/;
const TEMP_PREFIX = 'boite-dev-instance-';
const RUN = 'bun run dev:instance';

const USAGE = `${RUN} [start] [options]   start this checkout on the Dev data, in the background
${RUN} stop                stop what this checkout started, and remove its temporary data
${RUN} status              say what this checkout runs
${RUN} cli <args>          the boite CLI as the owner of this instance: ${RUN} cli projects
${RUN} url                 print the owner link (it carries the token: use it in a command substitution, never paste it)
${RUN} capture <file.png>  screenshot the running instance in a headless browser [--width 1280 --height 800]

options of start:
  --copy       run on a copy of the Dev data in a temporary directory, removed at stop
  --migrate    let this branch migrate the real Dev data when its journal schema is newer
  --scratch    run on empty temporary data, removed at stop
  --echo       set BOITE_ECHO=1: the echo provider, whose turns cost nothing
  --shell      build Boite Dev and launch its window hidden (BOITE_SHELL_HIDDEN=1) instead of a bare core
  --no-build   serve packages/ui/dist as it is
  --env K=V    one more variable for the core; inherited BOITE_* variables are never passed on,
               and none that chooses the data directory is accepted
  --timeout N  seconds to wait for the ready line (default 90)`;

/** What decides where a core or a shell keeps its data. None is taken from --env: the directory checked is the one opened. */
const DATA_VARIABLES = new Set(['BOITE_DATA_DIR', 'XDG_DATA_HOME', 'HOME', 'USERPROFILE', 'LOCALAPPDATA']);

class Refusal extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
  }
}

interface Options {
  command: string;
  rest: string[];
  copy: boolean;
  migrate: boolean;
  scratch: boolean;
  echo: boolean;
  shell: boolean;
  build: boolean;
  env: Record<string, string>;
  timeoutMs: number;
  width: number;
  height: number;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { command: 'start', rest: [], copy: false, migrate: false, scratch: false, echo: false, shell: false, build: true, env: {}, timeoutMs: 90_000, width: 1280, height: 800 };
  const words: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new Refusal(`${arg} needs a value\n\n${USAGE}`, 2);
      index += 1;
      return next;
    };
    const count = (): number => {
      const number = Number(value());
      if (!Number.isInteger(number) || number <= 0) throw new Refusal(`${arg} needs a positive integer\n\n${USAGE}`, 2);
      return number;
    };
    if (arg === '--copy') options.copy = true;
    else if (arg === '--migrate') options.migrate = true;
    else if (arg === '--scratch') options.scratch = true;
    else if (arg === '--echo') options.echo = true;
    else if (arg === '--shell') options.shell = true;
    else if (arg === '--no-build') options.build = false;
    else if (arg === '--timeout') options.timeoutMs = count() * 1000;
    else if (arg === '--width') options.width = count();
    else if (arg === '--height') options.height = count();
    else if (arg === '--env') {
      const pair = value();
      const at = pair.indexOf('=');
      if (at <= 0) throw new Refusal(`--env expects NAME=VALUE, got ${pair}`, 2);
      const name = pair.slice(0, at);
      if (DATA_VARIABLES.has(name.toUpperCase())) throw new Refusal(`--env ${name} would choose the data directory: this command opens the Dev data it checked, or what --copy and --scratch make`, 2);
      options.env[name] = pair.slice(at + 1);
    } else if (arg === '--help' || arg === '-h') throw new Refusal(USAGE, 0);
    else if (arg.startsWith('--')) throw new Refusal(`unknown option ${arg}\n\n${USAGE}`, 2);
    else words.push(arg);
  }
  if (words.length > 0) options.command = words[0]!;
  options.rest = words.slice(1);
  const modes = [options.copy, options.migrate, options.scratch].filter(Boolean).length;
  if (modes > 1) throw new Refusal('--copy, --migrate and --scratch exclude each other', 2);
  if (options.shell && (options.copy || options.scratch)) throw new Refusal('--shell always opens the real Dev data: the app picks its directory itself, so --copy and --scratch are for the bare core', 2);
  return options;
}

interface State {
  /** The core: captured at spawn, or read from `core.json` of the shell this script launched. */
  pid: number;
  /** Which run of `pid` that was (`processIdentity`); null where the OS would not say. */
  identity: string | null;
  shellIdentity?: string | null;
  /** The Boite Dev shell, captured at spawn, in `--shell` mode. */
  shellPid?: number;
  url: string;
  dataDir: string;
  mode: 'dev' | 'copy' | 'scratch';
  log: string;
  root: string;
  startedAt: number;
}

/** One instance per checkout and Dev data directory. The file holds no token. */
export function statePath(devDir: string): string {
  const key = createHash('sha256').update(`${ROOT}\0${devDir}`).digest('hex').slice(0, 12);
  return join(tmpdir(), `${TEMP_PREFIX}${key}.json`);
}

function readState(devDir: string): State | null {
  try {
    return JSON.parse(readFileSync(statePath(devDir), 'utf8')) as State;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** One run of a pid, as the OS names it: a later process wearing the same pid reads differently. */
function processIdentity(pid: number): string | null {
  const key = processPlatform.startKey?.(pid) ?? null;
  if (key !== null) return key;
  const startedAt = processPlatform.startedAt(pid);
  return startedAt === null ? null : String(startedAt);
}

/** Is `pid` still the process this script started? Unknown counts as no: nothing is signalled on a guess. */
function ours(pid: number, identity: string | null | undefined): boolean {
  return identity !== null && identity !== undefined && alive(pid) && processIdentity(pid) === identity;
}

function coreFile(dataDir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'core.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const say = (text: string): void => { process.stdout.write(`${text}\n`); };

/** The environment of what this script starts: none of the caller's own Boite identity or data directory. */
function childEnv(options: Options): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('BOITE_')) env[name] = value;
  }
  if (options.echo) env.BOITE_ECHO = '1';
  return { ...env, ...options.env };
}

function tail(file: string, lines = 30): string {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function waitFor<T>(read: () => T | null, timeoutMs: number, stopped: () => boolean): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (stopped() || Date.now() > deadline) return read();
    await Bun.sleep(100);
  }
}

function removeTemporary(state: Pick<State, 'mode' | 'dataDir'>): void {
  // Only a directory this script made: a temporary one under its own prefix.
  if (state.mode === 'dev' || !basename(state.dataDir).startsWith(TEMP_PREFIX) || dirname(state.dataDir) !== tmpdir()) return;
  rmSync(state.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

async function startCore(options: Options, dataDir: string, temporary: boolean, log: string): Promise<Started> {
  const out = openSync(log, 'w', 0o600);
  // Always the directory this script checked: `--data-dir` wins over anything in the environment.
  // A free port for temporary data; the real Dev data keeps the port its last run bound.
  const args = [MAIN, '--channel', 'dev', '--data-dir', dataDir, ...(temporary ? ['--port', '0'] : [])];
  const child = spawn(process.execPath, args, { cwd: ROOT, env: childEnv(options), detached: true, stdio: ['ignore', out, out], windowsHide: true });
  closeSync(out);
  let exited = false;
  child.once('exit', () => { exited = true; });
  const pid = child.pid;
  if (pid === undefined) throw new Refusal('the core could not be started', 1);
  const identity = processIdentity(pid);
  const url = await waitFor(() => READY.exec(tail(log, 200))?.[1] ?? null, options.timeoutMs, () => exited);
  if (url === null) {
    // Only the process this call spawned.
    if (!exited) child.kill();
    throw new Refusal(`the core ${exited ? 'exited before it was ready' : `printed no ready line in ${options.timeoutMs / 1000} s and was stopped`}. Its output (${log}):\n${tail(log)}`, 1);
  }
  child.unref();
  return { pid, identity, url };
}

interface Started { pid: number; identity: string | null; url: string; shellPid?: number; shellIdentity?: string | null }

function run(cmd: string[], what: string): void {
  // The build's own output goes to stderr, so stdout stays what this command reports.
  const result = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, stdio: ['ignore', 2, 2], windowsHide: true });
  if (result.status !== 0) throw new Refusal(`${what} failed (${cmd.join(' ')}), see above`, 1);
}

async function startShell(options: Options, devDir: string, log: string): Promise<Started> {
  if (process.platform === 'linux' && spawnSync('pkg-config', ['--exists', 'webkit2gtk-4.1']).status !== 0) {
    throw new Refusal('--shell needs the WebKitGTK headers on Linux (docs/internals/development.md, "Rebuilding the shell executable"). Without them, run the bare core: the same command without --shell.', 5);
  }
  if (options.build) {
    run(['bun', 'run', 'build:shell:dev'], 'the Boite Dev build');
    run(['bun', 'run', 'apps/shell/scripts/stage-sidecar.ts'], 'staging the core beside the shell');
  }
  const manifest = join(ROOT, 'apps', 'shell', 'src-tauri', 'Cargo.toml');
  const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest], { encoding: 'utf8', windowsHide: true });
  if (metadata.status !== 0) throw new Refusal(`cargo metadata failed: ${metadata.stderr}`, 1);
  const target = (JSON.parse(metadata.stdout) as { target_directory: string }).target_directory;
  const executable = join(target, 'release', process.platform === 'win32' ? 'boite-dev-shell.exe' : 'boite-dev-shell');
  if (!existsSync(executable)) throw new Refusal(`no Boite Dev shell at ${executable}: run without --no-build`, 1);
  const directory = devDir;
  const launchedAt = Date.now();
  const out = openSync(log, 'w', 0o600);
  const child = spawn(executable, [], { cwd: ROOT, env: { ...childEnv(options), BOITE_SHELL_HIDDEN: '1' }, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  closeSync(out);
  let exited = false;
  child.once('exit', () => { exited = true; });
  const shellPid = child.pid;
  if (shellPid === undefined) throw new Refusal('the shell could not be started', 1);
  const shellIdentity = processIdentity(shellPid);
  // The shell starts its own core, which writes `core.json` once it listens.
  const core = await waitFor(() => {
    const record = coreFile(directory);
    const url = record === null ? null : coreUrl(record);
    return record !== null && url !== null && typeof record.pid === 'number' && typeof record.startedAt === 'number' && record.startedAt >= launchedAt - 2000 && alive(record.pid) ? { pid: record.pid, url } : null;
  }, options.timeoutMs, () => exited);
  if (core === null) {
    if (!exited) child.kill();
    throw new Refusal(`the Boite Dev shell ${exited ? 'exited' : 'was stopped'} before its core was ready. Its output (${log}):\n${tail(log)}`, 1);
  }
  child.unref();
  return { ...core, identity: processIdentity(core.pid), shellPid, shellIdentity };
}

async function start(options: Options): Promise<void> {
  const devDir = devDataDir();
  const running = readState(devDir);
  if (running !== null && ours(running.pid, running.identity)) {
    throw new Refusal(`This checkout already runs a Dev instance at ${running.url} (pid ${running.pid}, data ${running.dataDir}).\nStop it first: ${RUN} stop`, 3);
  }
  const schema = schemaState(devDir);
  let dataDir: string | null = null;
  let mode: State['mode'] = 'dev';
  if (options.scratch) mode = 'scratch';
  else if (options.copy) {
    if (schema.kind === 'empty') throw new Refusal(messages.nothingToCopy(devDir), 2);
    if (schema.kind === 'newer') throw new Refusal(messages.newer(devDir, schema.found, schema.branch), 4);
    mode = 'copy';
  } else {
    const holder = lockHolder(devDir);
    if (holder !== null) throw new Refusal(messages.held(devDir, holder), 3);
    if (schema.kind === 'newer') throw new Refusal(messages.newer(devDir, schema.found, schema.branch), 4);
    if (schema.kind === 'older' && !options.migrate) throw new Refusal(messages.older(devDir, schema.found, schema.branch), 4);
  }

  if (options.build && !options.shell) {
    const fresh = productionUiIsFresh();
    if (!fresh) process.stderr.write('building the UI (packages/ui/dist is missing or older than its sources)\n');
    ensureProductionUi();
    say(`ui      ${fresh ? 'packages/ui/dist is up to date' : 'rebuilt packages/ui/dist'}; the core runs from this checkout's sources`);
  }

  if (mode !== 'dev') {
    dataDir = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
    if (mode === 'copy') {
      const copyAt = Date.now();
      try {
        copyDevData(devDir, dataDir);
      } catch (error) {
        removeTemporary({ mode, dataDir });
        throw error;
      }
      say(`copy    ${devDir} -> ${dataDir} in ${Date.now() - copyAt} ms`);
    }
  }
  if (mode === 'dev' && schema.kind === 'empty') say(messages.empty(devDir));
  if (mode === 'dev' && schema.kind === 'older') say(`migrate ${devDir} goes from journal schema ${schema.found} to ${schema.branch}, for good (--migrate)`);

  const log = statePath(devDir).replace(/\.json$/, '.log');
  let started: Started;
  try {
    started = options.shell ? await startShell(options, devDir, log) : await startCore(options, dataDir ?? devDir, dataDir !== null, log);
  } catch (error) {
    if (dataDir !== null) removeTemporary({ mode, dataDir });
    throw error;
  }
  const state: State = { ...started, dataDir: dataDir ?? devDir, mode, log, root: ROOT, startedAt: Date.now() };
  writeFileSync(statePath(devDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const data = { dev: 'the persistent Dev data', copy: 'a copy of the Dev data, removed at stop', scratch: 'empty temporary data, removed at stop' }[mode];
  say([
    `boite-core ready ${state.url}`,
    `data    ${state.dataDir} (${data}${mode === 'dev' && schema.kind === 'same' ? `, journal schema ${schema.found}, reused as it is` : ''})`,
    `process pid ${state.pid}${state.shellPid === undefined ? '' : `, Boite Dev shell pid ${state.shellPid} (hidden)`}, output in ${state.log}`,
    `open    the page needs the owner token of ${join(state.dataDir, 'core.json')}; "${RUN} url" prints the full link.`,
    `        Headless browser: <browser> "$(bun run --silent dev:instance url)", or ${RUN} capture shot.png`,
    '        Keep that link out of files, commits and logs.',
    `cli     ${RUN} cli projects   (the boite CLI on this instance; a plain "boite" in a Boite thread talks to that thread's own core)`,
    `stop    ${RUN} stop`,
    ...(mode === 'scratch' ? [] : [messages.quota(options.echo)]),
    ...(mode === 'copy' ? ['The copy carries the same sign-ins as the Dev data: an agent that renews a sign-in here may sign the original out.'] : []),
  ].join('\n'));
}

async function stop(): Promise<void> {
  const devDir = devDataDir();
  const state = readState(devDir);
  if (state === null) {
    say(`Nothing to stop: this checkout (${ROOT}) started no Dev instance.`);
    return;
  }
  const coreOurs = ours(state.pid, state.identity);
  const shellOurs = state.shellPid !== undefined && ours(state.shellPid, state.shellIdentity);
  const unknown = [[state.pid, state.identity] as const, ...(state.shellPid === undefined ? [] : [[state.shellPid, state.shellIdentity] as const])]
    .filter(([pid, identity]) => alive(pid) && (identity === null || identity === undefined)).map(([pid]) => pid);
  if (unknown.length > 0) {
    throw new Refusal(`pid ${unknown.join(' and ')} is alive, but this system gave no start time to tell it from the process this checkout started: nothing was signalled. Stop it yourself if it is the instance, then remove ${statePath(devDir)}.`, 1);
  }
  if (!coreOurs && !shellOurs) {
    const reused = [state.pid, ...(state.shellPid === undefined ? [] : [state.shellPid])].filter(alive);
    removeTemporary(state);
    rmSync(statePath(devDir), { force: true });
    say(reused.length > 0
      ? `The instance this checkout started is gone: pid ${reused.join(' and ')} ${reused.length > 1 ? 'are' : 'is'} no longer the processes this checkout started, so nothing was signalled. Its state was removed.`
      : `The instance this checkout started (pid ${state.pid}) was already gone. Its state was removed.`);
    return;
  }
  // The shell first, or it would start its core again. Only the run captured at spawn.
  if (shellOurs) process.kill(state.shellPid!);
  if (coreOurs) {
    const record = coreFile(state.dataDir);
    const stillOurs = (): true | null => (ours(state.pid, state.identity) ? null : true);
    try {
      if (record?.pid === state.pid) await fetch(`${state.url}/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${String(record.token)}` } });
    } catch {
      // No answer: the wait below decides.
    }
    let gone = await waitFor(stillOurs, record?.pid === state.pid ? 20_000 : 0, () => false);
    if (gone === null && state.shellPid === undefined && ours(state.pid, state.identity)) {
      // The run this script spawned, checked again at the moment of the signal.
      process.kill(state.pid);
      gone = await waitFor(stillOurs, 15_000, () => false);
    }
    if (gone === null) throw new Refusal(`the core (pid ${state.pid}) did not stop; its data ${state.dataDir} was kept`, 1);
  }
  removeTemporary(state);
  rmSync(statePath(devDir), { force: true });
  say(`stopped ${state.url} (pid ${state.pid})${state.mode === 'dev' ? `; the Dev data ${state.dataDir} is kept` : `; removed ${state.dataDir}`}`);
}

function runningState(): State {
  const state = readState(devDataDir());
  if (state === null || !ours(state.pid, state.identity)) throw new Refusal(`This checkout runs no Dev instance. Start one: ${RUN}`, 1);
  return state;
}

function ownerLink(state: State): string {
  const token = coreFile(state.dataDir)?.token;
  if (typeof token !== 'string' || token === '') throw new Refusal(`${join(state.dataDir, 'core.json')} carries no token`, 1);
  return `${state.url}/?${PAIR_QUERY_PARAM}=${token}`;
}

/**
 * The `boite` CLI as the owner of this checkout's instance. A caller inside a
 * Boite thread carries BOITE_CORE_URL, BOITE_AGENT_TOKEN and BOITE_THREAD_ID,
 * which send a plain `boite` to that thread's own core: none is passed on, and
 * the data directory names the core, whose `core.json` the CLI reads.
 */
function cli(args: string[]): number {
  const state = runningState();
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('BOITE_')) env[name] = value;
  }
  const result = spawnSync(process.execPath, [MAIN, 'cli', '--data-dir', state.dataDir, ...args], { env, stdio: 'inherit', windowsHide: true });
  return result.status ?? 1;
}

/** The suite's browser, else a `chrome-headless-shell` on the PATH, which the suite does not look for. */
async function browserExecutable(): Promise<string> {
  const { findBrowser } = await import('../../tests/e2e/lib/cdp.ts');
  try {
    return findBrowser();
  } catch (error) {
    const headless = Bun.which('chrome-headless-shell');
    if (headless !== null) return headless;
    throw new Refusal(`${(error as Error).message}\nA chrome-headless-shell on the PATH is used too.`, 1);
  }
}

async function capture(options: Options): Promise<void> {
  const file = options.rest[0];
  if (file === undefined) throw new Refusal(`capture needs a file: ${RUN} capture shot.png`, 2);
  const state = runningState();
  const { BrowserPage } = await import('../../tests/e2e/lib/cdp.ts');
  const page = await BrowserPage.launch({ url: ownerLink(state), executable: await browserExecutable(), windowSize: { width: options.width, height: options.height } });
  try {
    await page.waitFor('document.readyState === "complete" && document.body.innerText.trim().length > 0', 30_000);
    await Bun.sleep(1500);
    await page.screenshot(resolve(file));
  } finally {
    await page.close();
  }
  say(`captured ${resolve(file)} (${options.width}x${options.height})`);
}

async function main(argv: string[]): Promise<void> {
  // Every word after `cli` is the CLI's own, flags included.
  if (argv[0] === 'cli') {
    process.exitCode = cli(argv.slice(1));
    return;
  }
  const options = parseArgs(argv);
  if (options.command === 'start') await start(options);
  else if (options.command === 'stop') await stop();
  else if (options.command === 'url') say(ownerLink(runningState()));
  else if (options.command === 'capture') await capture(options);
  else if (options.command === 'status') {
    const state = readState(devDataDir());
    if (state === null || !ours(state.pid, state.identity)) say(`This checkout runs no Dev instance. Journal schema of this branch: ${BRANCH_SCHEMA}.`);
    else say(`running ${state.url}, pid ${state.pid}, data ${state.dataDir} (${state.mode}), output in ${state.log}`);
  } else throw new Refusal(`unknown command ${options.command}\n\n${USAGE}`, 2);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    () => process.exit(process.exitCode ?? 0),
    (error: unknown) => {
      const code = error instanceof Refusal ? error.code : 1;
      (code === 0 ? process.stdout : process.stderr).write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(code);
    },
  );
}
