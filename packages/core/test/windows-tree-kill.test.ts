import { expect, test } from 'bun:test';
import { killJobSubtree, treeKill } from '../src/platform/windows/tree-kill.ts';

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
function fakeJob(processes: Array<{ pid: number; created: bigint; parent: number | null }>, members: number[]) {
  const byHandle = new Map<number, (typeof processes)[number]>();
  const stopped: number[] = [];
  const api = {
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
      return handle;
    },
    inJob: (_job: number, handle: number) => members.includes(byHandle.get(handle)?.pid ?? -1),
    close() {},
    terminateProcess(handle: number) { stopped.push(byHandle.get(handle)!.pid); return true; },
  };
  return { api, stopped };
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
