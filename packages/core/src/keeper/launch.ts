/*
 * Starts the keeper of a data directory so it outlives the core that starts it.
 *
 * Under a systemd user service whose main process is this core, the keeper
 * gets a transient unit of its own: the core unit's `KillMode` sends SIGKILL to
 * everything left in its cgroup when it stops, and a process that only left
 * the core's session would still be in it. The new unit carries the core
 * unit's memory and CPU limits, so what the keeper starts runs under the same
 * caps it ran under in the core's unit. Anywhere else the keeper starts in a
 * session of its own and its output goes to `<dataDir>/logs/keeper.log`.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The program and arguments that run the keeper from this very core. From the
 * sources, Bun and `keeper/entry.ts`; from the bundle, Bun and `dist/main.js`
 * with `--keeper`; from the compiled binary, the binary itself with
 * `--keeper`, which `compiled-main.ts` sends to the keeper before it loads
 * the core.
 */
export function keeperCommand(dataDir: string, socketPath: string): string[] {
  const near = (path: string): string | null => {
    const file = fileURLToPath(new URL(path, import.meta.url));
    return existsSync(file) ? file : null;
  };
  const tail = ['--data-dir', dataDir, '--socket', socketPath];
  const sources = near('./entry.ts');
  if (sources !== null) return [process.execPath, sources, ...tail];
  // In the bundle this module is `dist/main.js` itself.
  const bundle = near('./main.js');
  return [process.execPath, ...(bundle === null ? [] : [bundle]), '--keeper', ...tail];
}

/** The systemd user unit whose main process is this core, or null. */
export async function ownUserUnit(): Promise<string | null> {
  if (process.platform !== 'linux' || !process.env['INVOCATION_ID']) return null;
  let cgroup: string;
  try { cgroup = readFileSync('/proc/self/cgroup', 'utf8'); } catch { return null; }
  const path = /^0::(\/.*)$/m.exec(cgroup)?.[1] ?? '';
  const unit = path.split('/').pop() ?? '';
  if (!/^[A-Za-z0-9_.@-]+\.service$/.test(unit)) return null;
  const pid = await systemctl(['show', unit, '--property=MainPID', '--value']);
  return pid !== null && Number(pid) === process.pid ? unit : null;
}

async function systemctl(args: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn({ cmd: ['systemctl', '--user', ...args], stdout: 'pipe', stderr: 'ignore' });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? out.trim() : null;
  } catch { return null; }
}

/** `MemoryHigh`, `MemoryMax` and `CPUWeight` of the unit, as `systemd-run --property` arguments. Unset ones are left out. */
export function unitLimits(show: string): string[] {
  const out: string[] = [];
  for (const line of show.split('\n')) {
    const match = /^(MemoryHigh|MemoryMax|CPUWeight)=(\d+)$/.exec(line.trim());
    if (match) out.push(`--property=${match[1]}=${match[2]}`);
  }
  return out;
}

export function keeperUnitName(socketPath: string): string {
  return basename(socketPath).replace(/\.sock$/, '').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^keeper-/, 'boite-keeper-');
}

export async function launchKeeper(dataDir: string, socketPath: string): Promise<void> {
  const command = keeperCommand(dataDir, socketPath);
  const unit = await ownUserUnit();
  if (unit !== null) {
    const limits = unitLimits(await systemctl(['show', unit, '--property=MemoryHigh', '--property=MemoryMax', '--property=CPUWeight']) ?? '');
    const child = Bun.spawn({
      cmd: ['systemd-run', '--user', `--unit=${keeperUnitName(socketPath)}`, '--collect', '--quiet', ...limits,
        // What the keeper starts finds its programs on the core's PATH.
        '--setenv=PATH', '--setenv=HOME', '--setenv=LANG', '--', ...command],
      stdout: 'ignore', stderr: 'pipe',
    });
    const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (code === 0) return;
    // A unit of that name still running holds the socket's lock: connecting finds it.
    if (/already (loaded|exists)/i.test(error)) return;
    throw new Error(`systemd-run could not start the keeper: ${error.trim() || `exit ${code}`}`);
  }
  const logs = join(dataDir, 'logs');
  mkdirSync(logs, { recursive: true });
  const log = openSync(join(logs, 'keeper.log'), 'a', 0o600);
  try {
    const child = Bun.spawn({ cmd: command, stdin: 'ignore', stdout: log, stderr: log, detached: true, env: process.env });
    child.unref();
  } finally { closeSync(log); }
}
