import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processTreeFixture } from './lib/process-tree-fixture.ts';
import { rejection } from '../../packages/core/test/settle.ts';
import { selectProcessTree, type TreeProcess, windowsProcessTree } from './lib/process-tree.ts';

test('a recycled parent PID and unreadable creation times cannot invent descendants', () => {
  const row = (pid: number, parent: number): TreeProcess => ({ ProcessId: pid, ParentProcessId: parent, Name: 'bun.exe', CommandLine: null });
  // The runner's original parent exited. Its retained PPID is now the fixture's
  // root PID, making a cycle that a walk using only PID/PPID accepts.
  const all = [row(400, 300), row(100, 200), row(200, 100), row(300, 200), row(500, 200), row(600, 500), row(700, 300), row(800, 100)];
  // Real FILETIMEs exceed Number's exact range: adjacent ticks must stay distinct.
  const tick = 133_000_000_000_000_000n;
  const times = new Map<number, bigint | null>([[100, tick + 1n], [200, tick + 2n], [300, tick + 3n], [400, tick + 3n], [500, null], [600, tick + 4n], [700, tick + 2n], [800, tick + 4n]]);
  const reads: number[] = [];
  const createdAt = (pid: number) => { reads.push(pid); return times.get(pid) ?? null; };
  expect(selectProcessTree(all, 200, createdAt).map(entry => entry.ProcessId)).toEqual([400, 200, 300]);
  expect(new Set(reads).size).toBe(reads.length);
  // The live fixture launcher is known to be outside the tree, even when the
  // snapshot's stale parent PID and the creation times allow a link back to it.
  times.set(100, tick + 2n);
  expect(selectProcessTree(all, 200, createdAt, 100).map(entry => entry.ProcessId)).toEqual([400, 200, 300]);
  // An unreadable root still appears, but cannot establish any child links.
  times.set(200, null);
  expect(selectProcessTree(all, 200, pid => times.get(pid) ?? null)).toEqual([all[2]!]);
  expect(selectProcessTree(all, 999, pid => times.get(pid) ?? null)).toEqual([]);
});

// A shell's diagnosis lists WebView2's processes under it with their `--type`.
// The PowerShell and WMI listing it replaces gave nothing within 10 s on a
// loaded runner; this one reads the same in this process.
test.skipIf(process.platform !== 'win32')('the process tree lists every descendant with its command line, in well under a second', async () => {
  const marker = `tree-${process.pid}-${Date.now()}`;
  const fixture = processTreeFixture(marker);
  const parent = fixture.parent;
  try {
    const descendants = await fixture.ready();
    const started = performance.now();
    const tree = await windowsProcessTree(parent.pid);
    const took = performance.now() - started;
    // Console helpers can appear at either level; every ancestry must reach the root.
    const parents = new Map(tree.map(entry => [entry.ProcessId, entry.ParentProcessId]));
    expect(tree.every(entry => {
      let pid = entry.ProcessId;
      const visited = new Set<number>();
      while (pid !== parent.pid) {
        if (visited.has(pid) || !parents.has(pid)) return false;
        visited.add(pid);
        pid = parents.get(pid)!;
      }
      return true;
    }), JSON.stringify(tree, null, 2)).toBe(true);
    expect(tree.some(entry => entry.ProcessId === process.pid)).toBe(false);
    const child = tree.find(entry => entry.ProcessId === parent.pid)!;
    const below = tree.find(entry => entry.ProcessId === descendants[0])!;
    const leaf = tree.find(entry => entry.ProcessId === descendants[1])!;
    expect(child.Name.toLowerCase()).toBe('bun.exe');
    expect(child.CommandLine).toContain(`${marker}-child`);
    expect(below).toMatchObject({ ParentProcessId: parent.pid, Name: child.Name });
    expect(below.CommandLine).toContain(`${marker}-grandchild`);
    expect(leaf).toMatchObject({ ParentProcessId: below.ProcessId, Name: child.Name });
    expect(leaf.CommandLine).toContain(`${marker}-great-grandchild`);
    expect(took).toBeLessThan(1000);
    expect(await windowsProcessTree(2 ** 31)).toEqual([]);
  } finally {
    await fixture.close();
  }
}, 20_000);

// import('bun:ffi') yields before opening the native library. Revoking the
// attempt during that suspension must work even on Linux, without kernel32.
test('a process-tree observation revoked while FFI loads cancels before native access', async () => {
  let authorized = true;
  const sampling = windowsProcessTree(process.pid, () => authorized);
  authorized = false;
  const failure = await rejection(sampling);
  expect(failure.reason).toMatchObject({ code: 'ABORT_ERR' });
});

// The spawn journal is independent of PID forwarding: a silent stdout must
// neither hang readiness nor leave processes the caller never heard about.
test.each(['ready', 'timeout', 'cancel'] as const)('fixture readiness and owned cleanup (%s)', async mode => {
  const directory = mkdtempSync(join(tmpdir(), 'boite-process-tree-'));
  const journal = join(directory, 'spawned.txt');
  const fixture = processTreeFixture(`cleanup-${process.pid}-${Date.now()}`, mode === 'ready', journal);
  const controller = new AbortController();
  const ready = fixture.ready(controller.signal).then(() => 'ready', (error: unknown) => String(error));
  let pids: number[] = [];
  let supervisor: ReturnType<typeof setTimeout> | undefined;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const deadline = Date.now() + 5_000;
    do {
      pids = readFileSync(journal, 'utf8').trim().split('\n').map(Number);
      if (pids.length === 3) break;
      await Bun.sleep(10);
    } while (Date.now() < deadline);
    expect(pids).toHaveLength(3);
    expect(pids.every(pid => Number.isSafeInteger(pid) && pid > 0 && alive(pid))).toBe(true);
    if (mode === 'cancel') controller.abort(new Error('fixture startup cancelled by test'));
    // A regression must fail and still reach its finally if readiness never settles.
    const outcome = await Promise.race([ready, new Promise<string>(resolve => { supervisor = setTimeout(() => resolve('startup never settled'), 6_000); })]);
    await fixture.close();
    const remaining = pids.filter(alive);
    expect({ outcome: mode === 'ready' ? outcome : /timed out|cancelled/.test(outcome), remaining }).toEqual({ outcome: mode === 'ready' ? 'ready' : true, remaining: [] });
  } finally {
    clearTimeout(supervisor);
    await fixture.close();
    // Only PIDs captured at their spawn in this fixture's private journal.
    pids = readFileSync(journal, 'utf8').trim().split('\n').map(Number);
    for (const pid of pids.toReversed()) if (alive(pid)) try { process.kill(pid); } catch {}
    await ready;
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
