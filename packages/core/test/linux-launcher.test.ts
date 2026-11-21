import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_LAUNCHER, buildLauncher } from '../bin/build-launcher.ts';
import { NativeTie, kernelSignalsGroups, launcherCandidates } from '../src/platform/linux-launcher.ts';

const linux = process.platform === 'linux';
const shape = (error: unknown) => {
  const e = error as { constructor: { name: string }; message: string; code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown };
  return { cls: e.constructor.name, message: e.message, code: e.code, errno: e.errno, syscall: e.syscall, path: e.path };
};
const thrown = (run: () => unknown): unknown => { try { run(); } catch (error) { return error; } throw new Error('no throw'); };

describe.skipIf(!linux)('the Linux launcher', () => {
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

  test('a guard that died fails the launch closed, and the next guard takes it', async () => {
    const tie = new NativeTie();
    expect(tie.ready()).toBeNull();
    const lost: Array<[number, boolean]> = [];
    tie.onLost = (groups) => lost.push(...groups);
    const first = tie.spawn({ cmd: ['sleep', '30'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] })!;
    expect(tie.holds(first.pid)).toBe(true);
    // The guard runs in a session of its own; its pid is the one session leader running `boite-launch guard`.
    const guards = Bun.spawnSync(['pgrep', '-f', '-P', String(process.pid), 'boite-launch guard']).stdout.toString().trim().split('\n').map(Number).filter(pid => pid > 1);
    expect(guards.length).toBeGreaterThan(0);
    for (const pid of guards) process.kill(pid, 'SIGKILL');
    // Before the core sees it go: the launcher's send fails with EPIPE, before the agent runs.
    const second = tie.spawn({ cmd: ['sleep', '31'], env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'] })!;
    expect(tie.holds(second.pid)).toBe(true);
    expect(lost).toEqual([[first.pid, true]]);
    first.kill('SIGKILL'); second.kill('SIGKILL');
    await Promise.all([first.exited, second.exited]);
  });
});
