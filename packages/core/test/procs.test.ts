import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { DEFAULT_DELEGATION_CONFIG } from '@boite/contracts';
import { echoThread, startTestCore, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';
import { Bus } from '../src/bus.ts';
import { ProcRegistry } from '../src/procs.ts';
import { createPosixPlatform } from '../src/platform/posix.ts';
import type { ProcessPlatform } from '../src/platform/types.ts';
import { Journal } from '../src/journal.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LONG_CHILD = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'exec sleep 30';
/** POSIX tracks direct children only, so explicitly replace the fixture shell. */
const TREE_SIZE = process.platform === 'win32' ? 2 : 1;

let harness: TestCore;

/** Signal 0 checks that a pid exists without touching it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Running and not a zombie: an orphan's exit is reaped by whoever adopted it, maybe not at once. */
function isAlive(pid: number): boolean {
  if (!isRunning(pid)) return false;
  try { return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return process.platform !== 'linux'; }
}

beforeEach(async () => {
  harness = await startTestCore();
});

afterEach(async () => {
  await harness.stop();
});

describe('procs', () => {
  test.each([false, true])('close releases the platform after protection failure and retains release errors=%s', async releaseFails => {
    const protectionError = new Error('protection close failed'), releaseError = new Error('platform release failed');
    let releases = 0;
    const platform: ProcessPlatform = {...createPosixPlatform('linux', null), release: async () => {releases++; if (releaseFails) throw releaseError;}};
    const registry = new ProcRegistry(harness.core.journal, new Bus(), platform);
    const close = spyOn(registry.protection, 'close').mockRejectedValue(protectionError);
    try {
      const closing = registry.close(); expect(registry.close()).toBe(closing);
      const error = await closing.catch(error => error);
      expect(releases).toBe(1);
      if (releaseFails) {expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([protectionError, releaseError]);}
      else expect(error).toBe(protectionError);
    } finally {close.mockRestore();}
  });
  test('disown forgets the pids it lets go of, so a kept process leaves no entry behind', async () => {
    const registry = new ProcRegistry(harness.core.journal, new Bus(), createPosixPlatform('linux', null));
    const child = registry.spawn('disowned', process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { agentRoot: false });
    try {
      const unassigned = (registry as unknown as { unassigned: Set<number> }).unassigned;
      expect(unassigned.has(child.record.pid)).toBe(true);
      registry.disown('disowned');
      expect(unassigned.has(child.record.pid)).toBe(false);
    } finally {
      process.kill(child.record.pid, 'SIGKILL');
      await child.exited;
      await registry.close();
    }
  });
  test('a managed stop hands its root to the tree backend only while that root has not exited', async () => {
    // On Windows the backend is taskkill /T /PID: a root that exited may have given its pid to a stranger.
    const handed: number[] = [];
    const platform: ProcessPlatform = { ...createPosixPlatform('linux', null), terminateUnassigned: (pid) => { handed.push(pid); } };
    const registry = new ProcRegistry(harness.core.journal, new Bus(), platform);
    try {
      const ended = registry.spawn('stop-identity', process.execPath, ['-e', '0'], { agentRoot: false });
      await ended.exited;
      await ended.stop();
      const piped = registry.spawnPiped('stop-identity', process.execPath, ['-e', '0'], { agentRoot: false });
      await piped.exited;
      await piped.stop();
      const child = registry.spawnChild('stop-identity', process.execPath, ['-e', '0'], { agentRoot: false });
      await new Promise((resolve) => child.once('exit', resolve));
      await registry.stopChild(child);
      expect(handed).toEqual([]);
      const running = registry.spawn('stop-identity', process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { agentRoot: false });
      await running.stop();
      expect(handed).toEqual([running.proc.pid]);
      // A thread stop's fallback, between the exit the spawner saw and the registry's own exit callback.
      const exiting = registry.spawnChild('tree-identity', process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { agentRoot: false });
      const live = registry.spawn('tree-identity', process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { agentRoot: false });
      Object.assign(exiting, { exitCode: 0 });
      registry.killTree('tree-identity');
      expect(handed).toEqual([running.proc.pid, live.proc.pid]);
      await live.exited;
    } finally { await registry.close(); }
  });
  test('a managed stop of an assigned root never calls the unassigned tree fallback', async () => {
    const fallback = spyOn({ stop() {} }, 'stop');
    const registry = new ProcRegistry(harness.core.journal, new Bus(), {
      ...createPosixPlatform('linux', null), attach: () => true, terminateUnassigned: fallback,
    });
    try {
      const child = registry.spawn('assigned-stop', process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
      await child.stop();
      expect(fallback).not.toHaveBeenCalled();
    } finally { await registry.close(); }
  });
  test.skipIf(process.platform !== 'win32')('a managed stop ends only its native job subtree without taskkill', async () => {
    const registry = harness.core.procs;
    const fallback = spyOn(registry.platform, 'terminateUnassigned');
    const threadId = 'native-subtree-stop';
    const sibling = registry.spawn(threadId, process.execPath, ['-e', 'await Bun.sleep(30000)']);
    const root = registry.spawnPiped(threadId, process.execPath, ['-e', `
      await Bun.stdin.text();
      const tool = Bun.spawn([process.execPath, '-e', 'await Bun.sleep(30000)'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true });
      console.log(tool.pid);
      await tool.exited;
    `]);
    try {
      root.proc.stdin.end();
      const reader = root.proc.stdout.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const tool = Number(new TextDecoder().decode(value).trim());
      expect(tool).toBeGreaterThan(0);
      expect(isRunning(tool)).toBe(true);
      await root.stop();
      await waitFor(() => !isRunning(tool), 2000);
      expect(sibling.proc.exitCode).toBeNull();
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      fallback.mockRestore();
      await registry.stopAndWait(threadId);
    }
  }, 15_000);
  test.skipIf(process.platform !== 'win32')('spawnChild keeps native exit usage after the node exit callback', async () => {
    const threadId = 'native-child-usage';
    const child = harness.core.procs.spawnChild(threadId, process.execPath, ['-e', 'setTimeout(() => {}, 250)'], {
      cwd: harness.dataDir,
    });
    await new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
    await waitFor(() => harness.core.procs.liveCount(threadId) === 0);
    const record = harness.core.journal.listProcesses(threadId, 10).find(record => record.pid === child.pid);
    expect(record).toBeDefined();
    expect(record?.cpuMs).not.toBeNull();
    expect(record?.peakMemoryBytes).toBeGreaterThan(0);
    expect(record?.ioBytes).not.toBeNull();
  });
  test('killTree kills the child a turn spawned', async () => {
    const client = await harness.connect();
    const { threadId } = await echoThread(harness, client);
    await client.call('threads.subscribe', { threadId });

    const started = client.next('process.started', (record) => record.threadId === threadId, 10000);
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);

    await client.call('turns.start', { threadId, prompt: `[spawn:${LONG_CHILD}]` });
    const child = await started;
    const exited = client.next('process.exited', (record) => record.pid === child.pid, 15000);
    expect(child.pid).toBeGreaterThan(0);
    expect(child.commandLine).toContain(LONG_CHILD);
    expect(child.exitedAt).toBeNull();

    // On Windows the Job Object also reports the shell's own ping child.
    await waitFor(() => harness.core.procs.liveCount(threadId) === TREE_SIZE, 5000);

    const resources = await client.call('resources.list', {});
    const mine = resources.find((entry) => entry.threadId === threadId);
    expect(mine?.live).toHaveLength(TREE_SIZE);

    const killed = await client.call('resources.killTree', { threadId });
    expect(killed.killed).toBe(TREE_SIZE);

    const gone = await exited;
    expect(gone.pid).toBe(child.pid);
    expect(gone.exitedAt).not.toBeNull();
    await waitFor(() => harness.core.procs.liveCount(threadId) === 0, 5000);

    await finished;
    const trace = await client.call('trace.get', { threadId });
    expect(trace).toHaveLength(TREE_SIZE);
    expect(trace[0]?.exitedAt).not.toBeNull();
  }, 30000);

  test('a thread with nothing running keeps its pid history, and a new process cancels the forgetting', async () => {
    const threadId = 'forget-when-idle';
    // The three maps the load tick walks. Without the timer they held every
    // thread the core ever ran, and the plugin store mints an id per call.
    const registry = harness.core.procs as unknown as {
      known: Map<string, Map<number, unknown>>;
      forgetTimers: Map<string, ReturnType<typeof setTimeout>>;
    };
    const first = harness.core.procs.spawnChild(threadId, process.execPath, ['-e', ''], { cwd: harness.dataDir });
    const pid = first.pid ?? 0;
    expect(pid).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => { first.once('exit', () => resolve()); first.once('error', reject); });
    await waitFor(() => harness.core.procs.liveCount(threadId) === 0, 5000);

    // Captured identities reject delayed events after exit. The idle timer
    // bounds that retained history on each platform.
    expect(registry.known.has(threadId)).toBe(true);
    expect(registry.known.get(threadId)?.has(pid)).toBe(true);
    expect(registry.forgetTimers.has(threadId)).toBe(true);

    const second = harness.core.procs.spawnChild(threadId, process.execPath, ['-e', ''], { cwd: harness.dataDir });
    expect(registry.forgetTimers.has(threadId)).toBe(false);
    await new Promise<void>((resolve, reject) => { second.once('exit', () => resolve()); second.once('error', reject); });
    await waitFor(() => harness.core.procs.liveCount(threadId) === 0, 5000);
    expect(registry.forgetTimers.has(threadId)).toBe(true);
  }, 15000);

  test.skipIf(process.platform === 'win32')('off Windows killTree reaches what the child started', async () => {
    const threadId = 'posix-group';
    // The shell prints the pid of its background sleep, then waits on it.
    const spawned = harness.core.procs.spawn(threadId, 'sh', ['-c', 'sleep 30 & echo $!; wait']);
    const reader = spawned.proc.stdout.getReader();
    const { value } = await reader.read();
    const grandchild = Number(new TextDecoder().decode(value).trim());
    expect(grandchild).toBeGreaterThan(0);

    expect(harness.core.procs.killTree(threadId)).toBe(1);
    await spawned.exited;
    await waitFor(() => !isRunning(grandchild), 5000);
  }, 15000);

  test.skipIf(process.platform === 'win32')('off Windows a core that dies takes its agents\' groups with it, and the next core closes their rows', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'boite-crash-'));
    const src = join(import.meta.dir, '..', 'src');
    // A core killed with SIGKILL runs nothing on its way out.
    const crashed = Bun.spawn({
      cmd: [process.execPath, '-e', `
        const { Journal } = await import(${JSON.stringify(join(src, 'journal.ts'))});
        const { Bus } = await import(${JSON.stringify(join(src, 'bus.ts'))});
        const { ProcRegistry } = await import(${JSON.stringify(join(src, 'procs.ts'))});
        const procs = new ProcRegistry(new Journal(${JSON.stringify(join(dataDir, 'journal.db'))}), new Bus());
        const agent = procs.spawn('crashed', 'sh', ['-c', 'sleep 60 & echo $!; wait']);
        const reader = agent.proc.stdout.getReader();
        const tool = new TextDecoder().decode((await reader.read()).value).trim();
        // A leader that exits leaves its tool in the group: the group, not the leader, ends with the core.
        const gone = procs.spawn('leader-gone', 'sh', ['-c', 'sleep 61 & echo $!']);
        const left = new TextDecoder().decode((await gone.proc.stdout.getReader().read()).value).trim();
        await gone.exited;
        if (procs.liveCount('leader-gone') !== 0) throw new Error('the leader exit was not recorded');
        console.log(JSON.stringify({ agent: agent.record.pid, tool: Number(tool), left: Number(left) }));
        process.kill(process.pid, 'SIGKILL');`],
      stdout: 'pipe', stderr: 'inherit',
    });
    const pids = JSON.parse((await new Response(crashed.stdout).text()).trim()) as { agent: number; tool: number; left: number };
    await crashed.exited;
    expect(crashed.signalCode).toBe('SIGKILL');
    try {
      await waitFor(() => !isAlive(pids.agent) && !isAlive(pids.tool) && !isAlive(pids.left), 5000);
      const before = new Journal(join(dataDir, 'journal.db'));
      expect(before.listProcesses('crashed', 10).map(row => row.exitedAt)).toEqual([null]);
      before.close();
      const next = await startTestCore({ dataDir });
      try {
        const [row] = next.core.journal.listProcesses('crashed', 10);
        expect(row?.pid).toBe(pids.agent);
        expect(row?.exitedAt).not.toBeNull();
        expect(row?.exitCode).toBeNull();
      } finally { await next.stop(); }
    } finally {
      for (const pid of [pids.agent, pids.tool, pids.left]) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone, as it should be */ } }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 20000);

  test.skipIf(process.platform === 'win32')('off Windows a core that dies while it registers a spawn still takes that group with it', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'boite-crash-'));
    const src = join(import.meta.dir, '..', 'src');
    const pidFile = join(dataDir, 'pid');
    const crashed = Bun.spawn({
      cmd: [process.execPath, '-e', `
        const { writeFileSync } = await import('node:fs');
        const { Journal } = await import(${JSON.stringify(join(src, 'journal.ts'))});
        const { Bus } = await import(${JSON.stringify(join(src, 'bus.ts'))});
        const { ProcRegistry } = await import(${JSON.stringify(join(src, 'procs.ts'))});
        const { registryPlatform } = await import(${JSON.stringify(join(src, 'platform', 'index.ts'))});
        // The first native read of a new pid is where registration starts: the core dies there.
        const platform = { ...registryPlatform(), startedAt: (pid) => { writeFileSync(${JSON.stringify(pidFile)}, String(pid)); process.kill(process.pid, 'SIGKILL'); return null; } };
        const procs = new ProcRegistry(new Journal(${JSON.stringify(join(dataDir, 'journal.db'))}), new Bus(), platform);
        procs.spawn('crashed', 'sleep', ['60']);`],
      stdout: 'ignore', stderr: 'inherit',
    });
    await crashed.exited;
    expect(crashed.signalCode).toBe('SIGKILL');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    try {
      expect(pid).toBeGreaterThan(0);
      await waitFor(() => !isAlive(pid), 5000);
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone, as it should be */ }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 20000);

  test('a child that never starts is not traced, and two on one thread leave no row open', async () => {
    const threadId = 'never-started';
    const errors: string[] = [];
    for (const name of ['agent-a', 'agent-b']) {
      const child = harness.core.procs.spawnChild(threadId, join(harness.dataDir, 'missing', name), []);
      child.once('error', error => errors.push((error as NodeJS.ErrnoException).code ?? 'error'));
    }
    await waitFor(() => errors.length === 2, 5000);
    expect(errors).toEqual(['ENOENT', 'ENOENT']);
    expect(harness.core.procs.liveCount(threadId)).toBe(0);
    expect(harness.core.journal.listProcesses(threadId, 10)).toEqual([]);
  });

  test.skipIf(process.platform === 'win32')('off Windows a child that ignores SIGTERM still lets its thread stop', async () => {
    const threadId = 'posix-stubborn';
    const spawned = harness.core.procs.spawn(threadId, 'sh', ['-c', 'trap "" TERM; echo ready; while :; do sleep 1; done']);
    await spawned.proc.stdout.getReader().read();
    const started = Date.now();
    await harness.core.procs.stopAndWait(threadId);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 15000);

  test.skipIf(process.platform !== 'linux')('a thread stop escalates for a descendant that left the process group', async () => {
    const threadId = 'posix-detached-tool';
    const root = harness.core.procs.spawn(threadId, 'sh', ['-c', 'setsid sh -c \'trap "" TERM; echo $$; exec sleep 30\' & wait']);
    const reader = root.proc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    const tool = Number(new TextDecoder().decode(value).trim());
    expect(tool).toBeGreaterThan(0);
    try {
      expect(isAlive(tool)).toBe(true);
      await harness.core.procs.stopAndWait(threadId);
      await waitFor(() => !isAlive(tool), 500);
    } finally {
      if (isAlive(tool)) process.kill(tool, 'SIGKILL');
    }
  });

  test('an archive stops the turn and the processes of the thread and its sub-threads, and leaves other threads alone', async () => {
    const client = await harness.connect();
    const { threadId } = await echoThread(harness, client, 'archived while working');
    const { threadId: keptId } = await echoThread(harness, client, 'keeps working');
    const output: Promise<unknown>[] = [];
    const start = (id: string) => {
      const child = harness.core.procs.spawn(id, process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
      output.push(new Response(child.proc.stdout).text(), new Response(child.proc.stderr).text());
      return child;
    };
    const parent = harness.core.threads.require(threadId);
    await client.call('delegation.configure', { threadId, config: { ...DEFAULT_DELEGATION_CONFIG, enabled: true, profiles: [{ id: 'worker', name: 'Worker', providerId: parent.providerId, accountId: parent.accountId, model: parent.model!, effort: null }] } });
    const child = await client.call('delegation.spawn', { threadId, profileId: 'worker', task: 'long running '.repeat(500), requestId: 'archive-child' });
    const own = start(threadId);
    const sub = start(child.thread.id);
    const kept = start(keptId);
    const turn = await client.call('turns.start', { threadId, prompt: 'long running '.repeat(500) });
    try {
      await client.call('threads.archive', { threadId });
      await Promise.all([own.exited, sub.exited]);
      await waitFor(() => harness.core.procs.liveCount(threadId) === 0 && harness.core.procs.liveCount(child.thread.id) === 0, 5000);
      expect(harness.core.journal.getTurn(turn.id)?.status).toBe('stopped');
      expect(harness.core.scheduler.state()).toEqual({ running: [], queued: [] });
      expect(kept.proc.exitCode).toBeNull();
      expect(harness.core.procs.liveCount(keptId)).toBeGreaterThan(0);
    } finally {
      await Promise.all([threadId, child.thread.id, keptId].map(id => harness.core.procs.stopAndWait(id)));
      await Promise.all(output);
    }
  }, 20000);

  test('resources.list carries only the threads running something now, archived or not', async () => {
    const client = await harness.connect();
    const running = await echoThread(harness, client, 'runs a process');
    const done = await echoThread(harness, client, 'ran one, now done');
    await echoThread(harness, client, 'never ran one');
    // Windows may also report native descendants. The retained trace must match
    // all starts observed for this thread, including its explicitly spawned root.
    const started = new Set<number>();
    const off = harness.core.bus.onAny((name, payload) => {
      if (name === 'process.started' && (payload as { threadId: string }).threadId === done.threadId) {
        started.add((payload as { pid: number }).pid);
      }
    });
    const quick = process.platform === 'win32' ? ['cmd', ['/c', 'exit 0']] as const : ['true', []] as const;
    const completed = harness.core.procs.spawn(done.threadId, quick[0], [...quick[1]]);
    await completed.exited;
    await waitFor(() => harness.core.procs.liveCount(done.threadId) === 0, 5000);
    const long = process.platform === 'win32' ? ['cmd', ['/c', 'ping -n 30 127.0.0.1 > nul']] as const : ['sleep', ['30']] as const;
    // An archive ends what the thread ran; what starts under it afterwards is still listed.
    await client.call('threads.archive', { threadId: running.threadId, archived: true });
    harness.core.procs.spawn(running.threadId, long[0], [...long[1]]);
    await waitFor(() => harness.core.procs.liveCount(running.threadId) > 0, 5000);

    try {
      const resources = await client.call('resources.list', {});
      expect(resources.map((entry) => entry.threadId)).toEqual([running.threadId]);
      const [mine] = resources;
      expect(mine?.title).toBe('runs a process');
      expect(mine?.live.length).toBeGreaterThan(0);
      expect(mine?.live.every((record) => record.exitedAt === null)).toBe(true);
      expect(mine?.load.processes).toBe(mine?.live.length);
    } finally {
      await harness.core.procs.stopAndWait(running.threadId);
    }
    // The trace still has what exited.
    const trace = await client.call('trace.get', { threadId: done.threadId });
    off();
    expect(trace.map(record => record.pid).sort()).toEqual([...started].sort());
    expect(trace.filter(record => record.pid === completed.record.pid)).toHaveLength(1);
    expect(trace.find(record => record.pid === completed.record.pid)?.exitedAt).toBeNumber();
    // Windows can also report a console child; every recorded process must be finished.
    expect(trace.every(record => record.exitedAt !== null)).toBe(true);
    expect(await client.call('resources.list', {})).toEqual([]);
  }, 20000);

  test('the trace capability says what it can promise on this OS', async () => {
    const client = await harness.connect();
    if (process.platform === 'win32') {
      expect(client.core.trace.mode).toBe('events');
      expect(client.core.trace.note).toContain('Job Object');
      return;
    }
    expect(client.core.trace.mode).toBe('poll');
    expect(client.core.trace.note).toContain('Windows-only');
  });

  test('a full disk skips trace rows and keeps the core alive', async () => {
    // A Unity build filled C: and the job's next grandchild threw SQLITE_FULL out of its callback, which stopped the core (#596).
    let job: Parameters<ProcessPlatform['retain']>[0] | undefined;
    // The pids are made up: nothing here may kill one.
    const platform: ProcessPlatform = { ...createPosixPlatform('linux', null), retain: (jobs) => { job = jobs; },
      terminate: () => false, terminateProcess: () => false, terminateUnassigned: async () => undefined };
    const bus = new Bus();
    const warnings: string[] = [];
    bus.onAny((name, payload) => {
      const log = payload as { event?: string; message: string };
      if (name === 'core.log' && log.event === 'trace.disk-full') warnings.push(log.message);
    });
    const procs = new ProcRegistry(harness.core.journal, bus, platform, { forgetDelayMs: 5 });
    const journal = harness.core.journal;
    const db = journal.db;
    const prune = journal.pruneProcesses;
    const pages = (db.query('PRAGMA page_count').get() as { page_count: number }).page_count;
    try {
      db.exec(`PRAGMA max_page_count = ${pages}`);
      const info = (n: number) => ({ exe: 'il2cpp.exe', commandLine: `il2cpp ${'x'.repeat(8_000)} ${n}`, parentPid: 1, startedAt: Date.now() + n });
      for (let n = 0; n < 20; n += 1) expect(() => job!.started('disk-full', 50_000 + n, info(n))).not.toThrow();
      expect(() => job!.exited('disk-full', 50_000, { exitCode: 0, cpuMs: null, peakMemoryBytes: null, ioBytes: null })).not.toThrow();
      expect(procs.liveCount('disk-full')).toBe(19);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('disk is full');

      // Room again: the next process is traced.
      db.exec('PRAGMA max_page_count = 1073741823');
      job!.started('disk-full', 60_000, info(100));
      expect(journal.listProcesses('disk-full', 50).map(record => record.pid)).toContain(60_000);

      // The cleanup once the thread goes idle deletes rows, which still needs room in the WAL.
      let pruned = 0;
      journal.pruneProcesses = () => { pruned += 1; throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' }); };
      for (const pid of [...Array.from({ length: 19 }, (_, n) => 50_001 + n), 60_000]) job!.exited('disk-full', pid, { exitCode: 0, cpuMs: null, peakMemoryBytes: null, ioBytes: null });
      await waitFor(() => pruned > 0, 2_000);
      await Bun.sleep(20);
      expect(procs.liveCount('disk-full')).toBe(0);
    } finally {
      journal.pruneProcesses = prune;
      db.exec('PRAGMA max_page_count = 1073741823');
      await procs.close();
    }
  });

  test.skipIf(process.platform === 'win32')('a fallback tree kill runs before the child is stopped, and shutdown waits for it', async () => {
    // Windows' taskkill fallback, for a pid outside the job: async, so the core is not held while it starts.
    const fallback = Promise.withResolvers<void>();
    const asked: number[] = [];
    const platform: ProcessPlatform = { ...createPosixPlatform('linux', null), terminate: () => false, terminateUnassigned(pid) {
      asked.push(pid);
      return fallback.promise;
    } };
    const procs = new ProcRegistry(harness.core.journal, new Bus(), platform);
    try {
      const { proc } = procs.spawn('fallback-kill', 'sleep', ['30']);
      let stopped = false;
      const all = procs.killAll().then(() => { stopped = true; });
      expect(asked).toEqual([proc.pid]);
      await Bun.sleep(50);
      // taskkill /T walks the tree from the root: the root's own kill waits for it.
      expect(isRunning(proc.pid)).toBe(true);
      expect(stopped).toBe(false);
      fallback.resolve();
      await all;
      expect(await proc.exited).not.toBe(0);
    } finally {
      await procs.close();
    }
  });
});
