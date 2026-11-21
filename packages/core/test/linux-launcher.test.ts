import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_LAUNCHER, buildLauncher } from '../bin/build-launcher.ts';
import { NativeTie, kernelSignalsGroups, launcherCandidates } from '../src/platform/linux-launcher.ts';

const linux = process.platform === 'linux';
// The native tie needs Linux 6.9; an older kernel is the watcher's case, refused in the first test's gate.
const native = linux && kernelSignalsGroups(release());
const shape = (error: unknown) => {
  const e = error as { constructor: { name: string }; message: string; code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown };
  return { cls: e.constructor.name, message: e.message, code: e.code, errno: e.errno, syscall: e.syscall, path: e.path };
};
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const thrown = (run: () => unknown): unknown => { try { run(); } catch (error) { return error; } throw new Error('no throw'); };

describe.skipIf(!native)('the Linux launcher', () => {
  let dir = '';
  beforeAll(() => { buildLauncher(); dir = mkdtempSync(join(tmpdir(), 'boite-launch-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test('the source tree build is where the core looks, and the kernel gate reads releases', () => {
    expect(launcherCandidates('/opt/boite/boite-core')[0]).toBe('/opt/boite/boite-launch');
    expect(launcherCandidates()).toContain(DEV_LAUNCHER);
    expect(new NativeTie().ready()).toBeNull();
    expect(kernelSignalsGroups('6.9.0-1-amd64')).toBe(true);
    expect(kernelSignalsGroups('7.3.1-x')).toBe(true);
    expect(kernelSignalsGroups('6.8.12')).toBe(false);
    expect(new NativeTie([join(dir, 'none')]).ready()).toContain('no boite-launch');
    expect(new NativeTie(launcherCandidates(), '6.1.0').ready()).toContain('6.9 or later');
  });

  test('a failed launch throws what Bun.spawn throws', () => {
    const tie = new NativeTie();
    writeFileSync(join(dir, 'noexec'), 'garbage\x00\x01binary'); chmodSync(join(dir, 'noexec'), 0o755);
    writeFileSync(join(dir, 'noperm'), '#!/bin/sh\n'); chmodSync(join(dir, 'noperm'), 0o644);
    for (const cmd of [join(dir, 'missing'), 'no-such-command-1168', join(dir, 'noexec'), join(dir, 'noperm')]) {
      const direct = thrown(() => Bun.spawn({ cmd: [cmd], stdio: ['ignore', 'ignore', 'ignore'] }));
      const launched = thrown(() => tie.spawn({ cmd: [cmd], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }));
      expect(shape(launched)).toEqual(shape(direct));
    }
  });

  test('argv, env, cwd, pipes and the session match a direct detached spawn', async () => {
    const script = `tr '\\0' '|' < /proc/$$/cmdline; echo; env | sort; pwd; for f in /proc/$$/fd/*; do n=\${f##*/}; l=$(readlink $f | sed 's/\\[[0-9]*\\]//'); echo "fd $n $l"; done; s=$(cat /proc/$$/stat); s=\${s##*) }; set -- $s; echo "pgid-is-self $([ $3 = $$ ] && echo yes) sid-is-self $([ $4 = $$ ] && echo yes)"`;
    const cmd = ['/bin/sh', '-c', script, 'arg zero', '', 'two words', '--x=*'];
    const env = { A: 'x y', EMPTY: '', PATH: '/usr/bin:/bin' };
    const stdio = ['ignore', 'pipe', 'pipe', 'pipe'] as Array<'ignore' | 'pipe'>;
    const run = async (proc: Bun.Subprocess) => { const out = await new Response(proc.stdout as ReadableStream).text(); await proc.exited; return out; };
    const direct = await run(Bun.spawn({ cmd, env, cwd: dir, stdio: stdio as never, detached: true }));
    const launched = await run(new NativeTie().spawn({ cmd, env, cwd: dir, stdio })!);
    expect(direct).toContain('pgid-is-self yes sid-is-self yes');
    expect(launched).toBe(direct);
  });

  test('a bare name is looked up as Bun does: unset, empty and relative PATH', async () => {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin', 'onlyhere'), '#!/bin/sh\necho here\n'); chmodSync(join(dir, 'bin', 'onlyhere'), 0o755);
    const tie = new NativeTie();
    const outcome = async (start: () => Bun.Subprocess | null) => {
      try { const proc = start()!; const out = await new Response(proc.stdout as ReadableStream).text(); return { exit: await proc.exited, out }; } catch (error) { return shape(error); }
    };
    for (const [cmd, env] of [['true', {}], ['true', { PATH: '' }], ['onlyhere', { PATH: 'bin' }], ['onlyhere', {}], ['onlyhere', { PATH: '' }]] as Array<[string, Record<string, string>]>) {
      const direct = await outcome(() => Bun.spawn({ cmd: [cmd], env, cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], detached: true }));
      const launched = await outcome(() => tie.spawn({ cmd: [cmd], env, cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }));
      expect({ cmd, env, launched }).toEqual({ cmd, env, launched: direct });
    }
  });

  test('the registry claims the group it launched once; the same number again is an earlier group, over', async () => {
    const tie = new NativeTie();
    const proc = tie.spawn({ cmd: ['sleep', '30'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] })!;
    try {
      expect(tie.claim(proc.pid)).toBe(true);
      expect(tie.holds(proc.pid)).toBe(true);
      // Another route's spawn that got this number back: the watcher takes it, the stale entry goes.
      expect(tie.claim(proc.pid)).toBe(false);
      expect(tie.holds(proc.pid)).toBe(false);
      expect(tie.claim(process.pid)).toBe(false);
    } finally { proc.kill('SIGKILL'); await proc.exited; }
  });

  test('a guard that died fails the launch closed, and a new guard takes it and every group held', async () => {
    const tie = new NativeTie();
    expect(tie.ready()).toBeNull();
    const lost: Array<[number, boolean]> = [];
    tie.onLost = (groups) => lost.push(...groups);
    const started: Bun.Subprocess[] = [];
    try {
      started.push(tie.spawn({ cmd: ['sleep', '30'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] })!);
      const guard = tie.guardPid!;
      process.kill(guard, 'SIGKILL');
      // In the same turn, before the core sees its exit: the launch fails before the agent runs, then runs with a new guard.
      started.push(tie.spawn({ cmd: ['sleep', '31'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] })!);
      const next = tie.guardPid!;
      expect(next).not.toBe(guard);
      // The dead guard's exit, seen now, must not replace or close the new one.
      await Bun.sleep(300);
      expect(tie.guardPid).toBe(next);
      expect(isAlive(next)).toBe(true);
      expect(started.map(proc => tie.holds(proc.pid))).toEqual([true, true]);
      expect(lost).toEqual([]);
    } finally {
      for (const proc of started) proc.kill('SIGKILL');
      await Promise.all(started.map(proc => proc.exited));
    }
  });

  /** A launcher at `name` that runs the real one after `prelude`, so a test can change how it runs without a hook in the code. */
  const wrapped = (name: string, prelude: string) => {
    const path = join(dir, name, 'boite-launch');
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(path, `#!/bin/sh\n${prelude}\nexec ${JSON.stringify(DEV_LAUNCHER)} "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  };

  test('a group the guard has no room for is refused before the agent runs', () => {
    // The guard keeps stdin, stdout and stderr: six descriptors leave room for three groups.
    const tie = new NativeTie([wrapped('tight', 'case $1 in guard) ulimit -n 6 ;; esac')]);
    expect(tie.ready()).toBeNull();
    const marker = (i: number) => join(dir, `ran-${i}`);
    const started: Bun.Subprocess[] = [];
    let refused: unknown = null;
    for (let i = 0; i < 4 && refused === null; i++) {
      try { started.push(tie.spawn({ cmd: ['sh', '-c', `: > ${marker(i)}; exec sleep 30`], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] })!); } catch (error) { refused = error; }
    }
    try {
      expect(started.length).toBe(3);
      expect((refused as { code?: unknown } | null)?.code).toBe('EMFILE');
      expect(existsSync(marker(3))).toBe(false);
    } finally { for (const proc of started) proc.kill('SIGKILL'); }
  });

  test('a launcher that ends before it reports never passes for a started agent', () => {
    const tie = new NativeTie([wrapped('silent', 'case $1 in launch) [ "$7" = probe ] || exit 0 ;; esac')]);
    expect(tie.ready()).toBeNull();
    const error = thrown(() => tie.spawn({ cmd: ['sleep', '30'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }));
    expect((error as { code?: unknown }).code).toBe('ELAUNCH');
  });

  /** Runs `body` in a core of its own that then dies by SIGKILL; what it printed, as JSON. */
  const crash = async (body: string, prefix: string[] = []): Promise<Record<string, number | string | boolean | null>> => {
    const core = Bun.spawn({
      cmd: [...prefix, process.execPath, '-e', `
        const src = ${JSON.stringify(join(import.meta.dir, '..', 'src'))};
        const { NativeTie } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'platform', 'linux-launcher.ts'))});
        const out = {};
        const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        const gone = async (pid) => { while (alive(pid)) await Bun.sleep(20); };
        ${body}
        console.log(JSON.stringify(out));
        process.kill(process.pid, 'SIGKILL');`],
      stdout: 'pipe', stderr: 'inherit',
    });
    const text = await new Response(core.stdout).text();
    await core.exited;
    expect(core.signalCode).toBe('SIGKILL');
    return JSON.parse(text.trim()) as Record<string, number | string | boolean | null>;
  };
  const settle = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(50); };

  test('groups held when a guard died end with the core, a leader that exited included', async () => {
    const out = await crash(`
      const tie = new NativeTie();
      const lead = tie.spawn({ cmd: ['sh', '-c', 'sleep 61 & echo $!'], env: { ...process.env }, stdio: ['ignore', 'pipe', 'ignore'] });
      out.tool = Number(new TextDecoder().decode((await lead.stdout.getReader().read()).value).trim());
      await lead.exited;
      tie.leaderExited(lead.pid);
      out.agent = tie.spawn({ cmd: ['sleep', '62'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }).pid;
      const guard = Number(Bun.spawnSync(['pgrep', '-P', String(process.pid), '-f', 'boite-launch guard']).stdout.toString().trim().split('\\n')[0]);
      process.kill(guard, 'SIGKILL');
      out.after = tie.spawn({ cmd: ['sleep', '63'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }).pid;
      // The old guard's exit is seen before the core dies.
      await gone(guard);
      await Bun.sleep(100);`);
    const pids = [out.tool, out.agent, out.after] as number[];
    try {
      await settle(() => pids.every(pid => !isAlive(pid)));
      expect(pids.filter(isAlive)).toEqual([]);
    } finally { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  }, 20000);

  test('a released group is never ended by a guard that could not take the drop', async () => {
    const out = await crash(`
      const { dlopen, FFIType: T, ptr } = await import('bun:ffi');
      const { readdirSync, readlinkSync } = await import('node:fs');
      const sockets = () => new Set(readdirSync('/proc/self/fd').filter(fd => { try { return readlinkSync('/proc/self/fd/' + fd).startsWith('socket:'); } catch { return false; } }));
      const before = sockets();
      const tie = new NativeTie();
      tie.ready();
      const [sock] = [...sockets()].filter(fd => !before.has(fd)).map(Number);
      const kept = tie.spawn({ cmd: ['sleep', '64'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      const released = tie.spawn({ cmd: ['sleep', '65'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      out.kept = kept.pid; out.released = released.pid;
      out.guard = Number(Bun.spawnSync(['pgrep', '-P', String(process.pid), '-f', 'boite-launch guard']).stdout.toString().trim().split('\\n')[0]);
      // A guard that reads nothing: its queue fills with drops of a tag no group has.
      process.kill(out.guard, 'SIGSTOP');
      const libc = dlopen('libc.so.6', { send: { args: [T.i32, T.ptr, T.u64, T.i32], returns: T.i64 } }).symbols;
      const junk = new Uint32Array([0xffffffff]);
      while (Number(libc.send(sock, ptr(junk), 4, 0x40 | 0x4000)) >= 0) {}
      tie.release(released.pid);`);
    try {
      // A guard left stopped would act once it runs again.
      try { process.kill(out.guard as number, 'SIGCONT'); } catch { /* replaced and gone */ }
      await settle(() => !isAlive(out.kept as number));
      expect(isAlive(out.kept as number)).toBe(false);
      await Bun.sleep(2500); // past the guard's grace
      expect(isAlive(out.released as number)).toBe(true);
    } finally { for (const pid of [out.kept, out.released] as number[]) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  }, 20000);
  test('the exit of a guard already replaced never closes its successor', async () => {
    // The old guard dies and the next launch replaces it in the same turn, before its exit is seen; the socket of
    // the new guard may get the old one's descriptor number. Only then does the loop run that exit.
    const out = await crash(`
      const { readFileSync } = await import('node:fs');
      const tie = new NativeTie();
      const first = tie.spawn({ cmd: ['sleep', '66'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      const guard = Number(Bun.spawnSync(['pgrep', '-P', String(process.pid), '-f', 'boite-launch guard']).stdout.toString().trim().split('\\n')[0]);
      process.kill(guard, 'SIGKILL');
      // Dead without a turn of the loop: Bun has not reaped it, so its exit has not been seen.
      while (!/\\) Z /.test(readFileSync('/proc/' + guard + '/stat', 'utf8'))) {}
      const second = tie.spawn({ cmd: ['sleep', '67'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      await Bun.sleep(500);
      out.first = first.pid; out.second = second.pid; out.secondAlive = alive(second.pid);`);
    const pids = [out.first, out.second] as number[];
    try {
      expect(out.secondAlive).toBe(true);
      await settle(() => pids.every(pid => !isAlive(pid)));
      expect(pids.filter(isAlive)).toEqual([]);
    } finally { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  }, 20000);

  // A pid namespace of its own, where writing ns_last_pid hands a chosen number to the next process.
  const pidNamespace = Bun.spawnSync(['unshare', '-Urpf', 'true'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  test.skipIf(!pidNamespace)('a number another route gets back from an earlier launched group is tied by the watcher', async () => {
    const dirIn = mkdtempSync(join(tmpdir(), 'boite-reuse-'));
    const pidFile = join(dirIn, 'pid');
    const core = `
      const { writeFileSync } = await import('node:fs');
      const { createPosixPlatform } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'platform', 'posix.ts'))});
      const platform = createPosixPlatform('linux', null);
      if (platform.readyGroups() !== null || platform.readyLaunch() !== null) throw new Error('no tie');
      // A launched group, registered, whose leader exited and whose group emptied: the sweep has not run yet.
      const gone = platform.spawnTied({ cmd: ['/bin/sh', '-c', 'exit 0'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      platform.tieGroup(gone.pid);
      await gone.exited;
      platform.untieGroup(gone.pid, true);
      // The same number, now for a process another route starts (a terminal, spawnChild): the registry ties it.
      writeFileSync('/proc/sys/kernel/ns_last_pid', String(gone.pid - 1));
      const next = Bun.spawn({ cmd: ['sleep', '68'], stdio: ['ignore', 'ignore', 'ignore'], detached: true });
      if (next.pid !== gone.pid) throw new Error('the number did not come back: ' + gone.pid + ' then ' + next.pid);
      platform.tieGroup(next.pid);
      writeFileSync(${JSON.stringify(pidFile)}, String(next.pid));
      process.kill(process.pid, 'SIGKILL');`;
    // The namespace's first process outlives the core long enough to look, past the watcher's grace, then ends it all.
    const shell = `"$0" -e "$1"; sleep 3; read pid < "$2"; if kill -0 "$pid" 2>/dev/null; then echo alive; else echo ended; fi`;
    try {
      const run = Bun.spawn({ cmd: ['unshare', '-Urpf', 'sh', '-c', shell, process.execPath, core, pidFile], stdout: 'pipe', stderr: 'inherit' });
      const text = (await new Response(run.stdout).text()).trim();
      await run.exited;
      expect(text).toBe('ended');
    } finally { rmSync(dirIn, { recursive: true, force: true }); }
  }, 20000);

  /** A seccomp filter that fails one syscall with EPERM, as a container's can on a kernel that has it. */
  const deny = (syscall: number) => {
    const path = join(dir, 'deny-syscall');
    if (!existsSync(path)) {
      const built = Bun.spawnSync(['cc', '-O2', '-o', path, join(import.meta.dir, 'fixtures', 'deny-syscall.c')], { stderr: 'pipe' });
      if (built.exitCode !== 0) throw new Error(built.stderr.toString());
    }
    return [path, String(syscall)];
  };

  for (const [syscall, name] of [[434, 'pidfd_open'], [424, 'pidfd_send_signal']] as const) {
    test(`a recent kernel that refuses ${name} leaves groups to the watcher, said once, still tied`, async () => {
      const out = await crash(`
        const { Journal } = await import(src + '/journal.ts');
        const { Bus } = await import(src + '/bus.ts');
        const { ProcRegistry } = await import(src + '/procs.ts');
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const bus = new Bus();
        const late = [];
        bus.onAny((name, event) => { if (name === 'core.log' && event.event === 'groups.late') late.push(event.message); });
        const procs = new ProcRegistry(new Journal(mkdtempSync(tmpdir() + '/boite-deny-') + '/journal.db'), bus);
        const agent = procs.spawn('denied', 'sleep', ['69']);
        procs.spawn('denied', 'true', []);
        out.agent = agent.record.pid; out.reason = procs.platform.readyLaunch(); out.late = late.length;`, deny(syscall));
      try {
        expect(String(out.reason)).toContain(syscall === 434 ? 'EPERM' : 'errno 1');
        expect(out.late).toBe(1);
        await settle(() => !isAlive(out.agent as number));
        expect(isAlive(out.agent as number)).toBe(false);
      } finally { try { process.kill(out.agent as number, 'SIGKILL'); } catch { /* gone */ } }
    }, 20000);
  }
});
