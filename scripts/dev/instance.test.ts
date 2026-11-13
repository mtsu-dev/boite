import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BRANCH_SCHEMA, journalSchema, lockHolder, schemaState } from './dev-data.ts';
import { parseArgs, statePath } from './instance.ts';

const ROOT = resolve(import.meta.dir, '..', '..');
const SCRIPT = join(import.meta.dir, 'instance.ts');
const MAIN = join(ROOT, 'packages', 'core', 'src', 'main.ts');
const TIMEOUT = 120_000;

/** A home of its own: the real Dev data of the machine running the tests is never resolved. */
function sandbox(): { env: Record<string, string>; devDir: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'boite-dev-instance-test-'));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !name.startsWith('BOITE_')) env[name] = value;
  Object.assign(env, { HOME: home, USERPROFILE: home, XDG_DATA_HOME: join(home, 'data'), LOCALAPPDATA: join(home, 'data'), BOITE_HOST_AGENTS: '0', BOITE_TAILNET: '0', BOITE_TELEMETRY_URL: '' });
  const devDir = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'boite2-dev') : join(home, 'data', 'boite2-dev');
  return { env, devDir, home };
}

const boxes: ReturnType<typeof sandbox>[] = [];
const spawned: Bun.Subprocess[] = [];

async function instance(box: ReturnType<typeof sandbox>, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  // The core's own variables travel through --env: the script drops every inherited BOITE_* one.
  const core = ['stop', 'url', 'cli', 'status'].includes(args[0] ?? '') ? [] : ['--no-build', '--env', 'BOITE_HOST_AGENTS=0', '--env', 'BOITE_TAILNET=0', '--env', 'BOITE_TELEMETRY_URL='];
  const proc = Bun.spawn([process.execPath, SCRIPT, ...args, ...core], { env: box.env, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

function fresh(): ReturnType<typeof sandbox> {
  const box = sandbox();
  boxes.push(box);
  return box;
}

const stampSchema = (devDir: string, version: number): void => {
  const db = new Database(join(devDir, 'journal.db'));
  db.run(`PRAGMA user_version = ${version}`);
  db.close();
};

const temporaryDir = (out: string): string => /^data\s+(\S+)/m.exec(out)?.[1] ?? '';

afterEach(async () => {
  for (const box of boxes.splice(0)) {
    await instance(box, 'stop');
    rmSync(statePath(box.devDir).replace(/\.json$/, '.log'), { force: true });
    rmSync(box.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  // Only the processes this file spawned.
  for (const proc of spawned.splice(0)) {
    proc.kill();
    await proc.exited;
  }
}, TIMEOUT);

describe('bun run dev:instance', () => {
  test('a first run says the Dev data starts empty, the next one reuses it', async () => {
    const box = fresh();
    const first = await instance(box);
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(first.out).toContain(`No Dev data yet: ${box.devDir} has no journal`);
    expect(first.out).toContain('The owner sets it up once');
    expect(first.out).toMatch(/^boite-core ready http:\/\/127\.0\.0\.1:\d+$/m);
    expect(first.out).toContain('every turn spends real quota');

    // The owner link comes from `url` alone; what start prints carries no token.
    const token = (JSON.parse(readFileSync(join(box.devDir, 'core.json'), 'utf8')) as { token: string }).token;
    expect(first.out).not.toContain(token);
    const link = await instance(box, 'url');
    expect(link.out.trim()).toBe(`${/ready (\S+)/.exec(first.out)![1]}/?token=${token}`);

    const again = await instance(box);
    expect(again.code).toBe(3);
    expect(again.err).toContain('This checkout already runs a Dev instance');

    const stopped = await instance(box, 'stop');
    expect(stopped.out).toContain(`the Dev data ${box.devDir} is kept`);
    expect(journalSchema(box.devDir)).toBe(BRANCH_SCHEMA);

    const second = await instance(box, '--echo');
    expect(second.code).toBe(0);
    expect(second.out).not.toContain('No Dev data yet');
    expect(second.out).toContain(`journal schema ${BRANCH_SCHEMA}, reused as it is`);
    expect(second.out).toContain('BOITE_ECHO=1 is set');
  }, TIMEOUT);

  test('cli reaches this checkout\'s Dev core, whatever Boite thread the caller runs in', async () => {
    const box = fresh();
    const started = await instance(box);
    expect(started.out).toContain('cli     bun run dev:instance cli projects');
    // What a Boite thread hands its commands: with these, the plain `boite` shim talks to the caller's own core.
    const real = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => { reached += 1; return new Response('the real core', { status: 500 }); } });
    let reached = 0;
    box.env.BOITE_CORE_URL = `http://127.0.0.1:${real.port}`;
    box.env.BOITE_AGENT_TOKEN = 'not-this-core';
    box.env.BOITE_THREAD_ID = 'thr_elsewhere';
    try {
      const folder = join(box.home, 'some-project');
      mkdirSync(folder);
      const added = await instance(box, 'cli', 'projects', 'add', folder, '--name', 'only-in-dev');
      expect(added.err).toBe('');
      expect(added.code).toBe(0);
      const listed = await instance(box, 'cli', 'projects', '--json');
      expect(listed.code).toBe(0);
      expect(listed.out).toContain('only-in-dev');
      expect(reached).toBe(0);
      // The exit code is the CLI's own.
      expect((await instance(box, 'cli', '--nope')).code).not.toBe(0);
    } finally {
      await real.stop(true);
    }
  }, TIMEOUT);

  test('the core opens the directory that was checked, whatever --env names', async () => {
    const box = fresh();
    const stable = join(box.devDir, '..', 'boite2');
    for (const pair of [`BOITE_DATA_DIR=${stable}`, `XDG_DATA_HOME=${join(box.home, 'elsewhere')}`, `HOME=${join(box.home, 'elsewhere')}`, `LOCALAPPDATA=${join(box.home, 'elsewhere')}`]) {
      const refused = await instance(box, '--env', pair);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain(`--env ${pair.split('=')[0]} would choose the data directory`);
    }
    expect(existsSync(stable)).toBe(false);
    expect(existsSync(join(box.home, 'elsewhere'))).toBe(false);
    // An inherited one is dropped, and the core is told its directory outright.
    box.env.BOITE_DATA_DIR = stable;
    const started = await instance(box);
    expect(started.code).toBe(0);
    expect(existsSync(join(box.devDir, 'journal.db'))).toBe(true);
    expect(existsSync(stable)).toBe(false);
    expect(() => parseArgs(['--shell', '--copy'])).toThrow('--shell always opens the real Dev data');
  }, TIMEOUT);

  test('a state whose pids now belong to other processes is stale: nothing is signalled', async () => {
    const box = fresh();
    await instance(box);
    const file = statePath(box.devDir);
    const state = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    await instance(box, 'stop');
    // The core crashed, its core.json stayed, and its pid and the shell's went to two unrelated processes.
    const reused = [0, 1].map(() => Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true }));
    spawned.push(...reused);
    const core = JSON.parse(readFileSync(join(box.devDir, 'core.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(box.devDir, 'core.json'), JSON.stringify({ ...core, pid: reused[0]!.pid }));
    writeFileSync(file, JSON.stringify({ ...state, pid: reused[0]!.pid, shellPid: reused[1]!.pid, shellIdentity: state.identity }));

    const status = await instance(box, 'status');
    expect(status.out).toContain('runs no Dev instance');
    const stopped = await instance(box, 'stop');
    expect(stopped.code).toBe(0);
    expect(stopped.out).toContain('no longer the processes this checkout started');
    expect(reused.map(proc => proc.exitCode)).toEqual([null, null]);
    expect(existsSync(file)).toBe(false);
    // And a start is not held back by it.
    expect((await instance(box)).code).toBe(0);
  }, TIMEOUT);

  test('the whole cycle works where the platform gives no start time (macOS): ps names the run', async () => {
    if (process.platform === 'win32') return;
    const box = fresh();
    // What macOS answers: no start key and no start time from the platform.
    box.env.BOITE_DEV_INSTANCE_IDENTITY = 'ps';
    const started = await instance(box);
    expect(started.code).toBe(0);
    const state = JSON.parse(readFileSync(statePath(box.devDir), 'utf8')) as { pid: number; identity: string };
    const lstart = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(state.pid)], { env: { ...box.env, LC_ALL: 'C' } }).stdout.toString().trim();
    expect(lstart).not.toBe('');
    expect(state.identity).toBe(`ps:${lstart}`);
    expect((await instance(box, 'status')).out).toContain(`running ${/ready (\S+)/.exec(started.out)![1]}`);
    expect((await instance(box, 'cli', 'projects')).code).toBe(0);
    expect((await instance(box, 'url')).code).toBe(0);
    expect((await instance(box)).code).toBe(3);
    const stopped = await instance(box, 'stop');
    expect(stopped.code).toBe(0);
    expect(stopped.out).toContain(`stopped `);
    expect(lockHolder(box.devDir)).toBeNull();
  }, TIMEOUT);

  test('a start whose process cannot be identified is stopped at once, never announced as ready', async () => {
    const box = fresh();
    box.env.BOITE_DEV_INSTANCE_IDENTITY = 'none';
    const started = await instance(box);
    expect(started.code).toBe(1);
    expect(started.out).not.toContain('boite-core ready');
    expect(started.err).toContain('gave no start time for the core it just started');
    expect(started.err).toContain('was stopped');
    expect(existsSync(statePath(box.devDir))).toBe(false);
    expect(lockHolder(box.devDir)).toBeNull();
  }, TIMEOUT);

  test('Dev data held by another core is named, left alone, and still open to --copy', async () => {
    const box = fresh();
    // What the Boite Dev app runs: a core on the dev channel, started by someone else.
    const holder = Bun.spawn([process.execPath, MAIN, '--channel', 'dev', '--port', '0'], { env: box.env, stdout: 'pipe', stderr: 'ignore', windowsHide: true });
    spawned.push(holder);
    const reader = holder.stdout.getReader();
    for (let text = ''; !text.includes('boite-core ready');) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`the holder exited: ${text}`);
      text += new TextDecoder().decode(chunk.value);
    }
    reader.releaseLock();

    const refused = await instance(box);
    expect(refused.code).toBe(3);
    expect(refused.err).toContain(`The Dev data ${box.devDir} is in use`);
    expect(refused.err).toContain(`pid ${holder.pid}`);
    expect(refused.err).toContain('the holder was left alone');
    expect(refused.err).toContain('bun run dev:instance --copy');
    expect(holder.exitCode).toBeNull();

    const copy = await instance(box, '--copy');
    expect(copy.err).toBe('');
    expect(copy.out).toContain('a copy of the Dev data, removed at stop');
    const directory = temporaryDir(copy.out);
    expect(directory).not.toBe(box.devDir);
    expect(journalSchema(directory)).toBe(BRANCH_SCHEMA);
    await instance(box, 'stop');
    expect(existsSync(directory)).toBe(false);
    expect(holder.exitCode).toBeNull();
  }, TIMEOUT);

  test('a branch whose journal schema is newer than the Dev data needs --copy or --migrate', async () => {
    const box = fresh();
    await instance(box);
    await instance(box, 'stop');
    stampSchema(box.devDir, BRANCH_SCHEMA - 1);
    expect(schemaState(box.devDir)).toEqual({ kind: 'older', found: BRANCH_SCHEMA - 1, branch: BRANCH_SCHEMA });

    const refused = await instance(box);
    expect(refused.code).toBe(4);
    expect(refused.err).toContain(`This branch's journal schema (${BRANCH_SCHEMA}) is newer than the Dev data's (${BRANCH_SCHEMA - 1})`);
    expect(refused.err).toContain('migrates the Dev data for good');
    expect(refused.err).toContain('may then refuse to open it');
    expect(refused.err).toContain('--copy');
    expect(refused.err).toContain('--migrate');
    expect(journalSchema(box.devDir)).toBe(BRANCH_SCHEMA - 1);

    const copy = await instance(box, '--copy');
    expect(copy.code).toBe(0);
    const directory = temporaryDir(copy.out);
    // The copy is migrated, the Dev data is not.
    expect(journalSchema(directory)).toBe(BRANCH_SCHEMA);
    expect(journalSchema(box.devDir)).toBe(BRANCH_SCHEMA - 1);
    await instance(box, 'stop');
    expect(existsSync(directory)).toBe(false);

    const migrated = await instance(box, '--migrate');
    expect(migrated.code).toBe(0);
    expect(migrated.out).toContain(`goes from journal schema ${BRANCH_SCHEMA - 1} to ${BRANCH_SCHEMA}, for good`);
    await instance(box, 'stop');
    expect(journalSchema(box.devDir)).toBe(BRANCH_SCHEMA);
  }, TIMEOUT);

  test('Dev data newer than the branch is refused, and --scratch runs on empty temporary data', async () => {
    const box = fresh();
    await instance(box);
    await instance(box, 'stop');
    stampSchema(box.devDir, BRANCH_SCHEMA + 1);

    for (const args of [[], ['--copy'], ['--migrate']]) {
      const refused = await instance(box, ...args);
      expect(refused.code).toBe(4);
      expect(refused.err).toContain(`has journal schema ${BRANCH_SCHEMA + 1}, and this branch reads up to ${BRANCH_SCHEMA}`);
      expect(refused.err).toContain('--scratch');
    }

    const scratch = await instance(box, '--scratch');
    expect(scratch.code).toBe(0);
    expect(scratch.out).toContain('empty temporary data, removed at stop');
    expect(scratch.out).not.toContain('real quota');
    const directory = temporaryDir(scratch.out);
    await instance(box, 'stop');
    expect(existsSync(directory)).toBe(false);
    expect(journalSchema(box.devDir)).toBe(BRANCH_SCHEMA + 1);
  }, TIMEOUT);

  test('--copy with nothing to copy and contradictory modes are refused before anything starts', async () => {
    const box = fresh();
    const empty = await instance(box, '--copy');
    expect(empty.code).toBe(2);
    expect(empty.err).toContain(`--copy needs Dev data to copy, and ${box.devDir} has no journal`);
    expect(existsSync(box.devDir)).toBe(false);
    expect(() => parseArgs(['--copy', '--migrate'])).toThrow('exclude each other');
    expect(() => parseArgs(['--nope'])).toThrow('unknown option --nope');
  }, TIMEOUT);
});
