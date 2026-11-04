import { spawn } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
const { join } = posix;
const KEPT_RELEASES = 2;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface ManagedUpdatePlan {
  id: string; root: string; dataDir: string; version: string; previousVersion: string;
  channel: 'stable' | 'nightly'; originalPid: number;
}
interface ManagedUpdateHooks<Prepared> {
  validate(): void;
  beforeActivate?(): void;
  find(channel: 'stable' | 'nightly'): Promise<{ version: string; url: string; signature: string }>;
  prepare(offer: { version: string; url: string; signature: string }): Promise<Prepared>;
  activate(prepared: Prepared): Promise<void>;
}

/** No service action happens until a signed release is prepared and the core admits the exact operation. */
export async function runManagedUpdate<Prepared extends { staging: string }>(directory: string, plan: ManagedUpdatePlan, hooks: ManagedUpdateHooks<Prepared>, pollMs = 250, timeoutMs = 20 * 60_000): Promise<'cancelled' | 'installed'> {
  const cancelled = () => existsSync(join(directory, 'cancelled')) || !existsSync(directory);
  let prepared: Prepared | null = null;
  try {
    if (cancelled()) return 'cancelled';
    hooks.validate();
    const offer = await hooks.find(plan.channel);
    if (offer.version !== plan.version) throw new Error(`Android offered version changed: expected ${plan.version}, got ${offer.version}; check again`);
    if (cancelled()) return 'cancelled';
    prepared = await hooks.prepare(offer);
    if (cancelled()) return 'cancelled';
    hooks.validate();
    writeFileSync(join(directory, 'ready'), plan.id, { mode: 0o600 });
    const deadline = Date.now() + timeoutMs;
    while (!cancelled()) {
      if (existsSync(join(directory, 'admitted'))) {
        if (readFileSync(join(directory, 'admitted'), 'utf8') !== plan.id) throw new Error('Android update admission must match its operation id');
        if (cancelled()) return 'cancelled';
        hooks.beforeActivate?.();
        await hooks.activate(prepared);
        return 'installed';
      }
      if (Date.now() >= deadline) throw new Error('Android update admission timed out; the server was left running');
      await sleep(pollMs);
    }
    return 'cancelled';
  } catch (error) {
    if (cancelled()) return 'cancelled';
    throw error;
  } finally {
    if (prepared && existsSync(prepared.staging)) rmSync(prepared.staging, { recursive: true, force: true });
  }
}


export function readManagedPlan(file: string, root: string, dataDir: string): ManagedUpdatePlan {
  const plan = JSON.parse(readFileSync(file, 'utf8')) as ManagedUpdatePlan;
  if (!/^[a-f0-9-]{36}$/.test(plan.id) || file !== join(root, `.boite-update-${plan.id}`, 'plan.json')) throw new Error('Android update plan must be in its private operation directory');
  if (plan.root !== root || plan.dataDir !== dataDir) throw new Error('Android update plan root and dataDir must match this controller');
  const version = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
  if (!version.test(plan.version) || !version.test(plan.previousVersion) || !['stable', 'nightly'].includes(plan.channel) || !Number.isSafeInteger(plan.originalPid) || plan.originalPid < 1) throw new Error('Android update plan must name valid versions, channel and originalPid');
  return plan;
}
interface ManagedController<Prepared> extends Omit<ManagedUpdateHooks<Prepared>, 'validate'> {
  root: string; dataDir: string; releases: string;
  log(text: string): void;
  snapshot(): { version: string | undefined; channel: string; corePid: number | null };
}
export async function managedWorker<Prepared extends { staging: string }>(file: string, controller: ManagedController<Prepared>): Promise<void> {
  const plan = readManagedPlan(file, controller.root, controller.dataDir);
  const directory = posix.dirname(file);
  const validate = () => {
    const state = controller.snapshot();
    if (state.version !== plan.previousVersion) throw new Error('Android update previousVersion must match the installed release');
    if (state.channel !== plan.channel) throw new Error('Android update channel changed; check again');
    if (state.corePid !== plan.originalPid) throw new Error('Android update originalPid must match the running supervised core');
  };
  const beforeActivate = () => {
    const state = controller.snapshot();
    if (state.version !== plan.previousVersion || state.channel !== plan.channel) throw new Error('Android update installation or channel changed before admission; check again');
  };
  try {
    const result = await runManagedUpdate(directory, plan, { ...controller, validate, beforeActivate });
    if (result === 'installed') writeFileSync(join(controller.dataDir, 'server-update-result.json'), JSON.stringify({ error: null }), { mode: 0o600 });
    rmSync(directory, { recursive: true, force: true });
    controller.log(`managed update ${result}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (existsSync(directory)) writeFileSync(join(directory, 'error'), message, { mode: 0o600 });
    writeFileSync(join(controller.dataDir, 'server-update-result.json'), JSON.stringify({ error: message }), { mode: 0o600 });
    throw error;
  } finally {
    rmSync(join(controller.releases, `.staging-${process.pid}`), { recursive: true, force: true });
  }
}

export async function launchManagedWorker(file: string, root: string, home: string, release: string): Promise<void> {
  readManagedPlan(file, root, join(root, 'data'));
  const directory = posix.dirname(file);
  const controller = join(directory, 'controller.ts');
  const source = process.argv[1]!;
  copyFileSync(source, controller);
  const module = join(posix.dirname(source), 'managed-update.ts');
  copyFileSync(existsSync(module) ? module : join(release, 'managed-update.ts'), join(directory, 'managed-update.ts'));
  const log = openSync(join(directory, 'worker.log'), 'a', 0o600);
  try {
    const child = spawn(realpathSync(process.execPath), [controller, 'managed-update-worker', file], {
      cwd: home, detached: true, stdio: ['ignore', log, log], env: { ...process.env, BOITE_SERVER_HOME: root },
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    process.stdout.write(`${JSON.stringify({ ok: true, pid: child.pid })}\n`);
  } finally { closeSync(log); }
}

/** Keeps the current release and the one before it, for `rollback`. */
export function pruneReleases(keep: string[], PATHS: { releases: string; runtime: string }, readRelease: (dir: string) => { bun: { version: string } }): void {
  const entries = readdirSync(PATHS.releases, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  // What an interrupted update left behind.
  for (const entry of entries) {
    if (entry.name.startsWith('.staging-') || entry.name.includes('.replaced-')) rmSync(join(PATHS.releases, entry.name), { recursive: true, force: true });
  }
  const older = entries
    .filter((entry) => /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.name) && !keep.includes(join(PATHS.releases, entry.name)))
    .map((entry) => entry.name)
    .sort((a, b) => Bun.semver.order(b, a));
  for (const name of older.slice(Math.max(0, KEPT_RELEASES - keep.length))) rmSync(join(PATHS.releases, name), { recursive: true, force: true });
  const kept = new Set([...keep, ...older.slice(0, Math.max(0, KEPT_RELEASES - keep.length)).map((name) => join(PATHS.releases, name))]);
  const used = [...kept].map((dir) => { try { return `bun-${readRelease(dir).bun.version}`; } catch { return ''; } });
  for (const entry of readdirSync(PATHS.runtime, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('bun-') && !used.includes(entry.name)) {
      rmSync(join(PATHS.runtime, entry.name), { recursive: true, force: true });
    }
  }
}

