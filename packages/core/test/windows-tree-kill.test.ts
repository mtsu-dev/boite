import { expect, test } from 'bun:test';
import { killJobSubtree, MAX_EARLY_DESCENDANTS, treeKill } from '../src/platform/windows/tree-kill.ts';

test('the tree kill holds the root from the call until taskkill ended, while the root exits meanwhile', async () => {
  const steps: string[] = [];
  let finish!: () => void;
  const ran = treeKill(41, pid => {
    steps.push(`hold ${pid}`);
    return () => steps.push('release');
  }, pid => {
    steps.push(`taskkill ${pid}`);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  // Held before the call returns: the caller's liveness check and the hold share one tick.
  expect(steps).toEqual(['hold 41', 'taskkill 41']);
  // The root exits and its spawner closes its own handle while taskkill has not opened the pid yet.
  await Bun.sleep(0);
  expect(steps).toEqual(['hold 41', 'taskkill 41']);
  finish();
  await ran;
  expect(steps).toEqual(['hold 41', 'taskkill 41', 'release']);
});

test('a root the hold cannot open gets no taskkill, and a taskkill that fails still releases', async () => {
  const runs: number[] = [];
  expect(treeKill(42, () => null, pid => { runs.push(pid); return Promise.resolve(); })).toBeUndefined();
  expect(runs).toEqual([]);

  let released = 0;
  expect(treeKill(43, () => () => released++, () => { throw new Error('no taskkill'); })).toBeUndefined();
  expect(released).toBe(1);
  await treeKill(44, () => () => released++, () => Promise.reject(new Error('taskkill crashed')));
  expect(released).toBe(2);
});

/** A job of fake processes: pid, creation FILETIME and the parent pid Windows keeps. */
function fakeJob(processes: Array<{ pid: number; created: bigint; parent: number | null }>, members: number[],
  listed?: Array<{ pid: number; parent: number }> | 'fails' | 'short') {
  const byHandle = new Map<number, (typeof processes)[number]>();
  const stopped: number[] = [];
  const opened: number[] = [];
  const closed: number[] = [];
  let cursor = 0;
  let error = 0;
  const entry = (out: Uint8Array) => {
    // A short read names 600 under 100, then fails before the end of the list.
    const rows = Array.isArray(listed) ? listed : listed === 'short' ? [{ pid: 600, parent: 100 }, { pid: 100, parent: 1 }] : [];
    if (listed === 'short' && cursor === 1) { error = 5; return false; }
    if (cursor >= rows.length) { error = 18; return false; }
    const view = new DataView(out.buffer);
    view.setUint32(8, rows[cursor]!.pid, true);
    view.setUint32(32, rows[cursor]!.parent, true);
    cursor += 1;
    return true;
  };
  const snapshotApi = listed === undefined ? {} : {
    snapshot: () => { if (listed === 'fails') return 0; cursor = 0; opened.push(9999); return 9999; },
    firstProcess: (_snapshot: number, out: Uint8Array) => entry(out),
    nextProcess: (_snapshot: number, out: Uint8Array) => entry(out),
    lastError: () => error,
  };
  const api = {
    ...snapshotApi,
    hasNt: true,
    imageName: () => false, readMemory: () => false, exitCode: () => false, ioCounters: () => false, memoryInfo: () => false,
    basicInfo(handle: number, out: Uint8Array) {
      const proc = byHandle.get(handle);
      if (!proc) return false;
      new DataView(out.buffer).setBigUint64(40, BigInt(proc.parent ?? 0), true);
      return true;
    },
    processTimes(handle: number, out: Uint8Array) {
      const proc = byHandle.get(handle);
      if (!proc) return false;
      new DataView(out.buffer).setBigUint64(0, proc.created, true);
      return true;
    },
    queryJobInfo(_job: number, _klass: number, buffer: Uint8Array) {
      const view = new DataView(buffer.buffer);
      view.setUint32(0, members.length, true);
      view.setUint32(4, members.length, true);
      members.forEach((pid, index) => view.setBigUint64(8 + index * 8, BigInt(pid), true));
      return true;
    },
    openProcess(_access: number, pid: number) {
      const proc = processes.find(candidate => candidate.pid === pid);
      if (!proc) return 0;
      const handle = 1000 + byHandle.size;
      byHandle.set(handle, proc);
      opened.push(handle);
      return handle;
    },
    inJob: (_job: number, handle: number) => members.includes(byHandle.get(handle)?.pid ?? -1),
    close(handle: number) { closed.push(handle); },
    terminateProcess(handle: number) { stopped.push(byHandle.get(handle)!.pid); return true; },
  };
  return { api, stopped, opened, closed, pidOf: (handle: number) => byHandle.get(handle)?.pid };
}

const EPOCH = 116_444_736_000_000_000n;

test('a subtree stop reaches a grandchild whose recorded parent left the job, and spares its sibling and a reused pid', () => {
  // 100 -> 200 -> 300, with 400 a sibling under the core. 200 exited; 500 took a
  // pid the registry recorded under 100 but is a later process of someone else.
  const processes = [
    { pid: 100, created: EPOCH + 10n, parent: 1 },
    { pid: 300, created: EPOCH + 30n, parent: 200 },
    { pid: 400, created: EPOCH + 40n, parent: 1 },
    { pid: 500, created: EPOCH + 90n, parent: 7 },
  ];
  const { api, stopped } = fakeJob(processes, [100, 300, 400, 500]);
  const lineage = { root: `${EPOCH + 10n}`, descendants: new Set([`300:${EPOCH + 30n}`, `500:${EPOCH + 50n}`]) };
  killJobSubtree(api, 1, 100, lineage);
  expect(stopped).toEqual([300, 100]);
});

test('a subtree stop refuses a root whose live incarnation is not the recorded one', () => {
  const { api, stopped } = fakeJob([{ pid: 100, created: EPOCH + 99n, parent: 1 }], [100]);
  killJobSubtree(api, 1, 100, { root: `${EPOCH + 10n}`, descendants: new Set() });
  expect(stopped).toEqual([]);
});

test('without a recorded lineage the subtree stop keeps the live parent edges only', () => {
  const processes = [
    { pid: 100, created: EPOCH + 10n, parent: 1 },
    { pid: 200, created: EPOCH + 20n, parent: 100 },
    { pid: 300, created: EPOCH + 30n, parent: 200 },
    { pid: 400, created: EPOCH + 40n, parent: 1 },
  ];
  const { api, stopped } = fakeJob(processes, [100, 200, 300, 400]);
  killJobSubtree(api, 1, 100);
  expect(stopped).toEqual([300, 200, 100]);
});

test('a subtree stop reaches a child the root started before it joined the job, verified through its own handle', () => {
  // 600 was started by 100 before 100 was assigned: Windows does not move it into the job.
  const processes = [
    { pid: 100, created: EPOCH + 10n, parent: 1 },
    { pid: 600, created: EPOCH + 11n, parent: 100 },
    { pid: 601, created: EPOCH + 12n, parent: 600 },
  ];
  const { api, stopped, opened, closed } = fakeJob(processes, [100], [{ pid: 1, parent: 0 }, { pid: 100, parent: 1 }, { pid: 600, parent: 100 }, { pid: 601, parent: 600 }]);
  killJobSubtree(api, 1, 100);
  expect(stopped).toEqual([601, 600, 100]);
  expect([...closed].sort()).toEqual([...opened].sort());
});

test('an early descendant is refused when its handle disagrees with the snapshot, it predates its parent, or another scope owns it', () => {
  const processes = [
    { pid: 100, created: EPOCH + 10n, parent: 1 },
    { pid: 400, created: EPOCH + 40n, parent: 1 },
    // Listed under 100, but its handle names another creator: the snapshot was stale.
    { pid: 700, created: EPOCH + 70n, parent: 5 },
    // Created by an earlier holder of pid 100, before this root existed.
    { pid: 800, created: EPOCH + 5n, parent: 100 },
    // A separately registered agent's process, in its own thread job.
    { pid: 900, created: EPOCH + 90n, parent: 100 },
    { pid: 901, created: EPOCH + 91n, parent: 900 },
  ];
  const listed = [{ pid: 100, parent: 1 }, { pid: 400, parent: 1 }, { pid: 700, parent: 100 }, { pid: 800, parent: 100 }, { pid: 900, parent: 100 }, { pid: 901, parent: 900 }];
  const { api, stopped, opened, closed, pidOf } = fakeJob(processes, [100, 400], listed);
  killJobSubtree(api, 1, 100, undefined, handle => pidOf(handle) === 900);
  expect(stopped).toEqual([100]);
  expect([...closed].sort()).toEqual([...opened].sort());
});

test.each(['fails', 'short'] as const)('a snapshot that %s authorizes no process outside the job', (listed) => {
  const processes = [
    { pid: 100, created: EPOCH + 10n, parent: 1 },
    { pid: 600, created: EPOCH + 11n, parent: 100 },
  ];
  const { api, stopped, opened, closed } = fakeJob(processes, [100], listed);
  killJobSubtree(api, 1, 100);
  expect(stopped).toEqual([100]);
  expect([...closed].sort()).toEqual([...opened].sort());
});

test('rejected early candidates count toward the discovery open limit, and every handle opened is closed', () => {
  // 300 processes listed under the root whose handles name another creator, then one real child.
  const strangers = Array.from({ length: 300 }, (_, index) => ({ pid: 2000 + index, created: EPOCH + 50n, parent: 5 }));
  const processes = [{ pid: 100, created: EPOCH + 10n, parent: 1 }, ...strangers, { pid: 600, created: EPOCH + 60n, parent: 100 }];
  const listed = [{ pid: 100, parent: 1 }, ...strangers.map(({ pid }) => ({ pid, parent: 100 })), { pid: 600, parent: 100 }];
  const { api, stopped, opened, closed } = fakeJob(processes, [100], listed);
  killJobSubtree(api, 1, 100);
  // One handle for the root and the snapshot's own, then at most the limit for discovery.
  expect(opened.length - 2).toBe(MAX_EARLY_DESCENDANTS);
  expect(stopped).toEqual([100]);
  expect([...closed].sort()).toEqual([...opened].sort());
});
