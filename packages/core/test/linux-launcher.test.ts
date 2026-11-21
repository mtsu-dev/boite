import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_LAUNCHER, buildLauncher } from '../bin/build-launcher.ts';
import { NativeTie, kernelSignalsGroups, launcherCandidates } from '../src/platform/linux-launcher.ts';

const linux = process.platform === 'linux';
if (linux) buildLauncher();
/** Why this machine cannot tie groups natively (an old kernel, a syscall filter, no launcher), or null: the native scenarios need null. */
const capability = linux ? new NativeTie().ready() : 'not Linux';
const shape = (error: unknown) => {
  const e = error as { constructor: { name: string }; message: string; code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown };
  return { cls: e.constructor.name, message: e.message, code: e.code, errno: e.errno, syscall: e.syscall, path: e.path };
};
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const thrown = (run: () => unknown): unknown => { try { run(); } catch (error) { return error; } throw new Error('no throw'); };
const settle = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(50); };
const quietKill = (pid: unknown) => { if (typeof pid === 'number' && pid > 1) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } };

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'boite-launch-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/** A launcher at `name` that runs the real one after `prelude`, so a test can change how it runs without a hook in the code. */
const wrapped = (name: string, prelude: string) => {
  const path = join(dir, name, 'boite-launch');
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${prelude}\nexec ${JSON.stringify(DEV_LAUNCHER)} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
};

/**
 * Runs `body` in a core of its own that then dies by SIGKILL; what it printed, as JSON. With `bound`, a core
 * that has not printed by then is killed and `hung` set: the case where a wait never ends.
 */
const crash = async (body: string, prefix: string[] = [], bound = 0): Promise<Record<string, number | string | boolean | null>> => {
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
  const text = new Response(core.stdout).text();
  const hung = bound > 0 && await Promise.race([text.then(() => false), Bun.sleep(bound).then(() => true)]);
  if (hung) core.kill('SIGKILL');
  await core.exited;
  expect(core.signalCode).toBe('SIGKILL');
  return hung ? { hung: true } : JSON.parse((await text).trim()) as Record<string, number | string | boolean | null>;
};

/** A seccomp filter that fails one syscall with EPERM (`424:nonzero`: only for a real signal), as a container's can. */
const deny = (rule: string) => {
  const path = join(dir, 'deny-syscall');
  if (!existsSync(path)) {
    const built = Bun.spawnSync(['cc', '-O2', '-o', path, join(import.meta.dir, 'fixtures', 'deny-syscall.c')], { stderr: 'pipe' });
    if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  }
  return [path, rule];
};


/** In a core fixture, capture its new guard socket and fill the queue of a guard we stopped. */
const fillGuardQueue = `
  const { dlopen, FFIType: T, ptr } = await import('bun:ffi');
  const { readdirSync, readlinkSync } = await import('node:fs');
  const sockets = () => readdirSync('/proc/self/fd').filter(fd => {
    try { return readlinkSync('/proc/self/fd/' + fd).startsWith('socket:'); } catch { return false; }
  });
  const before = new Set(sockets());
  const libc = dlopen('libc.so.6', { send: { args: [T.i32, T.ptr, T.u64, T.i32], returns: T.i64 } }).symbols;
  const fill = () => {
    const [sock] = sockets().filter(fd => !before.has(fd)).map(Number);
    if (sock === undefined) throw new Error('guard socket was not captured');
    const junk = new Uint32Array([0xffffffff]);
    while (Number(libc.send(sock, ptr(junk), 4, 0x40 | 0x4000)) >= 0) {}
  };`;
describe('the launcher gates', () => {
  test('the core looks next to itself, then in the source tree build, and the kernel gate reads releases', () => {
    expect(launcherCandidates('/opt/boite/boite-core')[0]).toBe('/opt/boite/boite-launch');
    expect(launcherCandidates()).toContain(DEV_LAUNCHER);
    expect(kernelSignalsGroups('6.9.0-1-amd64')).toBe(true);
    expect(kernelSignalsGroups('7.3.1-x')).toBe(true);
    expect(kernelSignalsGroups('6.8.12')).toBe(false);
    expect(kernelSignalsGroups('5.15.0-91-generic')).toBe(false);
  });

  test.skipIf(!linux)('a missing launcher or an old kernel is refused with its reason', () => {
    expect(new NativeTie([join(dir, 'none')], '6.9.0').ready()).toContain('no boite-launch');
    expect(new NativeTie(launcherCandidates(), '6.1.0').ready()).toContain('6.9 or later');
  });

  // Whatever this kernel allows: a refusal anywhere on the path leaves groups to the watcher, said once, still ended with the core.
  for (const [rule, name, reason] of [['434', 'pidfd_open', 'EPERM'], ['424', 'pidfd_send_signal', 'errno 1'], ['424:nonzero', 'pidfd_send_signal for any real signal (signal 0 passes)', 'signal 15']] as const) {
    test.skipIf(!linux)(`a kernel or filter that refuses ${name} leaves groups to the watcher, said once, still tied`, async () => {
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
        out.agent = agent.record.pid; out.reason = procs.platform.readyLaunch(); out.late = late.length;`, deny(rule));
      try {
        expect(out.reason).not.toBeNull();
        // On a machine that ties natively, the refusal is this filter's; elsewhere the machine's own.
        if (capability === null) expect(String(out.reason)).toContain(reason);
        expect(out.late).toBe(1);
        await settle(() => !isAlive(out.agent as number));
        expect(isAlive(out.agent as number)).toBe(false);
      } finally { quietKill(out.agent); }
    }, 20000);
  }
});

describe.skipIf(capability !== null)('the Linux launcher', () => {
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
    const troubles: string[] = [];
    tie.onTrouble((message) => troubles.push(message));
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
      expect(started.map(proc => tie.guarded(proc.pid))).toEqual([true, true]);
      expect(troubles).toEqual([]);
    } finally {
      for (const proc of started) proc.kill('SIGKILL');
      await Promise.all(started.map(proc => proc.exited));
    }
  });


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

  test('groups held when a guard died end with the core, a leader that exited included', async () => {
    const out = await crash(`
      const tie = new NativeTie();
      const lead = tie.spawn({ cmd: ['sh', '-c', 'sleep 61 & echo $!'], env: { ...process.env }, stdio: ['ignore', 'pipe', 'ignore'] });
      out.tool = Number(new TextDecoder().decode((await lead.stdout.getReader().read()).value).trim());
      await lead.exited;
      tie.leaderExited(lead.pid);
      out.agent = tie.spawn({ cmd: ['sleep', '62'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }).pid;
      const guard = tie.guardPid;
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
      out.guard = tie.guardPid;
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
      const guard = tie.guardPid;
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

  // A pid namespace of its own, where writing ns_last_pid hands a chosen number to the next process. Where one is
  // refused, the reason is in the skipped test's name.
  const unshared = Bun.spawnSync(['unshare', '-Urpf', 'true'], { stdout: 'ignore', stderr: 'pipe' });
  const noNamespace = unshared.exitCode === 0 ? '' : ` (skipped: unshare -Urpf refused: ${unshared.stderr.toString().trim() || `exit ${unshared.exitCode}`})`;
  test.skipIf(noNamespace !== '')(`a number another route gets back from an earlier launched group is tied by the watcher${noNamespace}`, async () => {
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

  test.skipIf(noNamespace !== '')(`a number given back while its stale drop replaces the guard stays tied by the new guard${noNamespace}`, async () => {
    // The launch of the reused number ends with its stale group's drop. That drop finds the guard unable to take it
    // (stopped, its queue full of junk from a helper the wrapper leaves in the group), so a new guard replaces it:
    // the new group must be among those it takes.
    const wrapper = wrapped('stall', `case $1 in launch) if [ -n "$BOITE_TEST_STALL" ]; then g=$3; ( while [ ! -e "$BOITE_TEST_STALL" ]; do sleep 0.02; done; kill -STOP "$BOITE_TEST_GUARD"; timeout 0.3 sh -c 'while :; do printf x; done' >&"$g" ) & fi ;; esac`);
    const dirIn = mkdtempSync(join(tmpdir(), 'boite-reuse-'));
    const pidFile = join(dirIn, 'pid');
    const stall = join(dirIn, 'ran');
    const core = `
      const { writeFileSync } = await import('node:fs');
      const { NativeTie } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'platform', 'linux-launcher.ts'))});
      const tie = new NativeTie([${JSON.stringify(wrapper)}]);
      if (tie.ready() !== null) throw new Error('no tie: ' + tie.ready());
      const gone = tie.spawn({ cmd: ['/bin/sh', '-c', 'exit 0'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      await gone.exited;
      writeFileSync('/proc/sys/kernel/ns_last_pid', String(gone.pid - 1));
      const next = tie.spawn({ cmd: ['/bin/sh', '-c', ': > ${stall}; exec sleep 85'], env: { ...process.env, BOITE_TEST_STALL: ${JSON.stringify(stall)}, BOITE_TEST_GUARD: String(tie.guardPid) }, stdio: ['ignore', 'ignore', 'ignore'] });
      if (next.pid !== gone.pid) throw new Error('the number did not come back: ' + gone.pid + ' then ' + next.pid);
      writeFileSync(${JSON.stringify(pidFile)}, String(next.pid));
      process.kill(process.pid, 'SIGKILL');`;
    const shell = `"$0" -e "$1"; sleep 3; read pid < "$2"; if kill -0 "$pid" 2>/dev/null; then echo alive; else echo ended; fi`;
    try {
      const run = Bun.spawn({ cmd: ['unshare', '-Urpf', 'sh', '-c', shell, process.execPath, core, pidFile], stdout: 'pipe', stderr: 'inherit' });
      const text = (await new Response(run.stdout).text()).trim();
      await run.exited;
      expect(text).toBe('ended');
    } finally { rmSync(dirIn, { recursive: true, force: true }); }
  }, 20000);

  test('a group the new guard refuses stays held by its pidfd, is said, and is taken back without a spawn', async () => {
    // The first guard has room for three groups, its successor for two (stdin, stdout, stderr and the groups).
    const shrink = join(dir, 'shrink-now');
    const wrapper = wrapped('shrink', `case $1 in guard) if [ -e ${JSON.stringify(shrink)} ]; then ulimit -n 5; else ulimit -n 6; fi ;; esac`);
    const out = await crash(`
      const { writeFileSync } = await import('node:fs');
      const tie = new NativeTie([${JSON.stringify(wrapper)}], undefined, 100);
      const troubles = [];
      tie.onTrouble?.((message) => troubles.push(message));
      if (tie.ready() !== null) throw new Error('no tie: ' + tie.ready());
      const agents = [0, 1, 2].map((i) => tie.spawn({ cmd: ['sleep', String(90 + i)], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }));
      writeFileSync(${JSON.stringify(shrink)}, '');
      const guard = tie.guardPid;
      process.kill(guard, 'SIGKILL');
      await gone(guard);
      await Bun.sleep(50);
      out.held = agents.filter((proc) => tie.holds(proc.pid)).length;
      out.troubles = troubles.length;
      // One group ends and is let go of: room for the refused one, offered again with no spawn.
      const [ended, ...rest] = agents;
      ended.kill('SIGKILL');
      await ended.exited;
      tie.release(ended.pid);
      await Bun.sleep(400);
      out.a = rest[0].pid; out.b = rest[1].pid;`);
    try {
      // Both remaining groups end with the core: the refused one was taken back by the new guard.
      await settle(() => !isAlive(out.a as number) && !isAlive(out.b as number));
      expect([isAlive(out.a as number), isAlive(out.b as number)]).toEqual([false, false]);
      expect(out.held).toBe(3);
      expect(out.troubles).toBe(1);
    } finally { quietKill(out.a); quietKill(out.b); rmSync(shrink, { force: true }); }
  }, 20000);

  test('a drop no guard can take keeps the group held by the old guard and says so to the caller', async () => {
    // The guard is stopped with a full queue, and the core has no descriptor left for a new guard's socket.
    const out = await crash(`
      const { dlopen, FFIType: T, ptr } = await import('bun:ffi');
      const { closeSync, openSync, readdirSync, readlinkSync } = await import('node:fs');
      const sockets = () => new Set(readdirSync('/proc/self/fd').filter(fd => { try { return readlinkSync('/proc/self/fd/' + fd).startsWith('socket:'); } catch { return false; } }));
      const before = sockets();
      const tie = new NativeTie();
      tie.ready();
      const [sock] = [...sockets()].filter(fd => !before.has(fd)).map(Number);
      const kept = tie.spawn({ cmd: ['sleep', '82'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      const released = tie.spawn({ cmd: ['sleep', '83'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      out.kept = kept.pid; out.released = released.pid; out.guard = tie.guardPid;
      process.kill(out.guard, 'SIGSTOP');
      const libc = dlopen('libc.so.6', { send: { args: [T.i32, T.ptr, T.u64, T.i32], returns: T.i64 } }).symbols;
      const junk = new Uint32Array([0xffffffff]);
      while (Number(libc.send(sock, ptr(junk), 4, 0x40 | 0x4000)) >= 0) {}
      const fill = [];
      try { for (;;) fill.push(openSync('/dev/null', 'r')); } catch { /* the limit */ }
      out.result = tie.release(released.pid) ?? null;
      for (const fd of fill) closeSync(fd);
      out.held = tie.holds(released.pid);
      process.kill(out.guard, 'SIGCONT');
      await Bun.sleep(2600); // past the grace of a guard whose input closed
      out.releasedAlive = alive(released.pid); out.keptAlive = alive(kept.pid);`, ['sh', '-c', 'ulimit -n 256; exec "$@"', 'sh']);
    try {
      expect({ released: out.releasedAlive, kept: out.keptAlive }).toEqual({ released: true, kept: true });
      expect(out.result).toBe(false);
      expect(out.held).toBe(true);
      // Still held, by the old guard too: both end with the core.
      await settle(() => !isAlive(out.kept as number) && !isAlive(out.released as number));
      expect([isAlive(out.kept as number), isAlive(out.released as number)]).toEqual([false, false]);
    } finally { quietKill(out.kept); quietKill(out.released); quietKill(out.guard); }
  }, 20000);

  test('a failed handoff after a partial readmission leaves subsequent drops with the old guard', async () => {
    const switchGuard = join(dir, 'partial-next');
    const nextPid = join(dir, 'partial-next-pid');
    // Reply to the first readmission, then stop before the second. The old guard still owns both.
    const stopAfterAck = `import { dlopen, FFIType as T, ptr } from 'bun:ffi';
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(nextPid)}, String(process.pid));
      const libc = dlopen('libc.so.6', {
        recv: { args: [T.i32, T.ptr, T.u64, T.i32], returns: T.i64 },
        send: { args: [T.i32, T.ptr, T.u64, T.i32], returns: T.i64 },
      }).symbols;
      const answer = new Uint32Array(2);
      if (Number(libc.recv(0, ptr(answer), 4, 0)) !== 4) process.exit(2);
      if (Number(libc.send(0, ptr(answer), 8, 0)) !== 8) process.exit(3);
      process.kill(process.pid, 'SIGSTOP');`;
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
    const wrapper = wrapped('partial', `if [ "$1" = guard ] && [ -e ${quote(switchGuard)} ]; then exec ${quote(process.execPath)} -e ${quote(stopAfterAck)}; fi`);
    const pids = join(dir, 'partial-pids');
    const out = await crash(`
      ${fillGuardQueue}
      const { writeFileSync } = await import('node:fs');
      const tie = new NativeTie([${JSON.stringify(wrapper)}]);
      if (tie.ready() !== null) throw new Error(tie.ready());
      const spawn = (cmd, ...args) => tie.spawn({ cmd: [cmd, ...args], env: {}, stdio: ['ignore', 'ignore', 'ignore'] });
      const [first, second, rejected] = [93, 94, 95].map(seconds => spawn('/bin/sleep', String(seconds)));
      const old = tie.guardPid;
      writeFileSync(${JSON.stringify(pids)}, JSON.stringify([first.pid, second.pid, rejected.pid, old]));
      writeFileSync(${JSON.stringify(switchGuard)}, '');
      process.kill(old, 'SIGSTOP');
      fill();
      out.failedDrop = tie.release(rejected.pid);
      out.keptOld = tie.guardPid === old;
      process.kill(old, 'SIGCONT');
      await spawn('/bin/true').exited;
      out.releasedFirst = tie.release(first.pid);`, [], 6000);
    const [first, second, rejected, old] = JSON.parse(readFileSync(pids, 'utf8')) as number[];
    try {
      expect(out.hung).toBeUndefined();
      expect(out.failedDrop).toBe(false);
      expect(out.keptOld).toBe(true);
      expect(out.releasedFirst).toBe(true);
      await settle(() => !isAlive(second!) && !isAlive(rejected!));
      expect([isAlive(first!), isAlive(second!), isAlive(rejected!)]).toEqual([true, false, false]);
    } finally {
      for (const pid of [first, second, rejected, old]) quietKill(pid);
      if (existsSync(nextPid)) quietKill(Number(readFileSync(nextPid, 'utf8')));
    }
  }, 20000);

  test.each([false, true])('a capability probe exits without a numeric kill (signals refused=%s)', async (blocked) => {
    const probePid = join(dir, 'probe-pid');
    const wrapper = wrapped('probe-lifetime', `if [ "$1" = probe ]; then printf '%s' "$$" > ${JSON.stringify(probePid)}; fi`);
    rmSync(probePid, { force: true });
    const out = await crash(`
      const { existsSync, readFileSync } = await import('node:fs');
      const tie = new NativeTie([${JSON.stringify(wrapper)}]);
      const kill = process.kill;
      let numericKills = 0;
      process.kill = () => { numericKills++; return true; };
      try { out.reason = tie.ready(); } finally { process.kill = kill; }
      out.numericKills = numericKills;
      const file = ${JSON.stringify(probePid)};
      for (let i = 0; i < 50 && !existsSync(file); i++) await Bun.sleep(20);
      if (existsSync(file)) {
        out.probe = Number(readFileSync(file, 'utf8'));
        for (let i = 0; i < 50 && alive(out.probe); i++) await Bun.sleep(20);
        out.probeAlive = alive(out.probe);
      }`, blocked ? deny('424:nonzero') : [], 6000);
    try {
      expect(out.hung).toBeUndefined();
      if (blocked) {
        expect(String(out.reason)).toContain('signal 15');
        expect(out.probeAlive).toBe(false);
      } else expect(out.reason).toBeNull();
      expect(out.numericKills).toBe(0);
    } finally { quietKill(out.probe); }
  }, 20000);

  test('a stopped guard with a full queue does not block readmission', async () => {
    const shrink = join(dir, 'recover-shrink');
    const pids = join(dir, 'recover-pids');
    const wrapper = wrapped('recover', `if [ "$1" = guard ] && [ -e ${JSON.stringify(shrink)} ]; then ulimit -n 4; fi`);
    const out = await crash(`
      ${fillGuardQueue}
      const { writeFileSync, rmSync } = await import('node:fs');
      const tie = new NativeTie([${JSON.stringify(wrapper)}], undefined, 100);
      if (tie.ready() !== null) throw new Error(tie.ready());
      const agents = [96, 97].map(seconds => tie.spawn({ cmd: ['/bin/sleep', String(seconds)], env: {}, stdio: ['ignore', 'ignore', 'ignore'] }).pid);
      const cleanup = ${JSON.stringify(pids)};
      const initial = tie.guardPid;
      writeFileSync(cleanup, JSON.stringify([...agents, initial]));
      writeFileSync(${JSON.stringify(shrink)}, '');
      let stoppedGuard;
      tie.onTrouble(message => {
        if (stoppedGuard !== undefined || !message.includes('the new guard refused')) return;
        stoppedGuard = tie.guardPid;
        writeFileSync(cleanup, JSON.stringify([...agents, initial, stoppedGuard]));
        rmSync(${JSON.stringify(shrink)});
        process.kill(stoppedGuard, 'SIGSTOP');
        fill();
      });
      process.kill(initial, 'SIGKILL');
      await Bun.sleep(700);
      out.restored = stoppedGuard !== undefined && tie.guardPid !== stoppedGuard && agents.every(pid => tie.guarded(pid));`, [], 5000);
    const captured = JSON.parse(readFileSync(pids, 'utf8')) as number[];
    try {
      expect(out.hung).toBeUndefined();
      expect(out.restored).toBe(true);
      const agents = captured.slice(0, 2);
      await settle(() => agents.every(pid => !isAlive(pid)));
      expect(agents.map(isAlive)).toEqual([false, false]);
    } finally { for (const pid of captured) quietKill(pid); }
  }, 20000);

  test('the launcher runs nothing before the core says it holds the pidfd', async () => {
    // The launcher's own sockets, read by no core: it has the guard's answer and sent its pidfd, and must wait.
    const { dlopen, FFIType: T } = await import('bun:ffi');
    const libc = dlopen('libc.so.6', { socketpair: { args: [T.i32, T.i32, T.i32, T.ptr], returns: T.i32 }, close: { args: [T.i32], returns: T.i32 } }).symbols;
    const pair = () => { const fds = new Int32Array(2); if (libc.socketpair(1, 5 | 0o2000000, 0, fds) !== 0) throw new Error('socketpair'); return [fds[0]!, fds[1]!] as const; };
    const [statusCore, statusLaunch] = pair();
    const [guardCore, guardEnd] = pair();
    const guard = Bun.spawn({ cmd: [DEV_LAUNCHER, 'guard'], stdio: [guardEnd, 'ignore', 'ignore'], detached: true });
    const marker = join(dir, 'ran-unconfirmed');
    const launch = Bun.spawn({ cmd: [DEV_LAUNCHER, 'launch', '3', '4', '7', '/bin/sh', 'sh', '-c', `: > ${marker}; exec sleep 84`], stdio: ['ignore', 'ignore', 'ignore', statusLaunch, guardCore], detached: true });
    libc.close(statusLaunch); libc.close(guardEnd);
    try {
      await Bun.sleep(500);
      expect(existsSync(marker)).toBe(false);
      libc.close(statusCore); // the core's end gone without its word
      expect(await launch.exited).toBe(127);
      expect(existsSync(marker)).toBe(false);
    } finally {
      launch.kill('SIGKILL');
      guard.kill('SIGKILL');
      libc.close(guardCore);
    }
  });

  test('a guard that only signal 0 fails for still ends a group that ignores SIGTERM', async () => {
    const [denyPath] = deny('424:zero');
    const wrapper = wrapped('blind', `case $1 in guard) exec ${JSON.stringify(denyPath)} 424:zero ${JSON.stringify(DEV_LAUNCHER)} guard ;; esac`);
    const out = await crash(`
      const tie = new NativeTie([${JSON.stringify(wrapper)}]);
      if (tie.ready() !== null) throw new Error('no tie: ' + tie.ready());
      out.agent = tie.spawn({ cmd: ['/bin/sh', '-c', 'trap "" TERM; exec sleep 86'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] }).pid;`);
    try {
      await settle(() => !isAlive(out.agent as number));
      expect(isAlive(out.agent as number)).toBe(false);
    } finally { quietKill(out.agent); }
  }, 20000);

  test('a stopped guard holds neither a launch nor the loop: a new guard takes over and both groups stay tied', async () => {
    const pids = join(dir, 'stopped-pids');
    const out = await crash(`
      const { writeFileSync } = await import('node:fs');
      const tie = new NativeTie();
      if (tie.ready() !== null) throw new Error('no tie');
      const first = tie.spawn({ cmd: ['sleep', '87'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      const guard = tie.guardPid;
      writeFileSync(${JSON.stringify(pids)}, JSON.stringify([first.pid, guard]));
      process.kill(guard, 'SIGSTOP');
      const second = tie.spawn({ cmd: ['sleep', '88'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] });
      out.first = first.pid; out.second = second.pid; out.replaced = tie.guardPid !== guard;`, [], 8000);
    const [first, guard] = JSON.parse(readFileSync(pids, 'utf8')) as number[];
    try {
      expect(out.hung).toBeUndefined();
      expect(out.replaced).toBe(true);
      await settle(() => !isAlive(first!) && !isAlive(out.second as number));
      expect([isAlive(first!), isAlive(out.second as number)]).toEqual([false, false]);
    } finally { quietKill(first); quietKill(out.second); quietKill(guard); }
  }, 20000);
});
