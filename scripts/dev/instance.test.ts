import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BRANCH_SCHEMA, journalSchema, schemaState } from './dev-data.ts';
import { parseArgs } from './instance.ts';

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
  const core = args[0] === 'stop' || args[0] === 'url' ? [] : ['--no-build', '--env', 'BOITE_HOST_AGENTS=0', '--env', 'BOITE_TAILNET=0', '--env', 'BOITE_TELEMETRY_URL='];
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
