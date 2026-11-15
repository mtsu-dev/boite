/**
 * What ADEMark's macOS instruments read, from Linux: memory and CPU of a
 * process tree out of `/proc`, a cold page cache without root, and the text a
 * terminal program drew.
 */
import { closeSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dlopen, FFIType } from 'bun:ffi';

/** The characters ADEMark types to see when an app takes keys (TESTS.md 1.3). */
export const PROBE = 'ademarkqz';

/** Host time in milliseconds, the same clock a page reads with `performance.timeOrigin + performance.now()`. */
export function now(): number {
  return performance.timeOrigin + performance.now();
}

function statFields(pid: number): string[] | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command can hold spaces and parentheses: the fields start after its last ')'.
    return text.slice(text.lastIndexOf(')') + 2).split(' ');
  } catch {
    return null;
  }
}

/** Every live process whose parent chain leads to one of `roots`, the roots included. */
export function tree(roots: readonly number[]): number[] {
  const parents = new Map<number, number>();
  for (const entry of readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    const fields = statFields(pid);
    if (fields !== null) parents.set(pid, Number(fields[1]));
  }
  const found = new Set<number>(roots.filter((pid) => parents.has(pid)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, parent] of parents) {
      if (!found.has(pid) && found.has(parent)) {
        found.add(pid);
        grew = true;
      }
    }
  }
  return [...found];
}

export function parentOf(pid: number): number {
  const fields = statFields(pid);
  return fields === null ? -1 : Number(fields[1]);
}

export function commandOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch {
    return '';
  }
}

/**
 * Proportional set size in bytes: private pages plus each shared page divided
 * by the processes that map it. It adds up across a tree without counting a
 * shared library twice, which is what macOS `phys_footprint` is used for.
 */
export function pss(pid: number): number {
  try {
    const match = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    return match === null ? 0 : Number(match[1]) * 1024;
  } catch {
    return 0;
  }
}

/** User plus system CPU time in milliseconds. Linux counts in ticks of 10 ms. */
export function cpuMs(pid: number): number {
  const fields = statFields(pid);
  return fields === null ? 0 : (Number(fields[11]) + Number(fields[12])) * 10;
}

export interface Groups {
  /** The app's own processes. */
  app: number[];
  /** One root per agent; its children count with it. */
  agents: number[];
}

export interface Sample {
  at: number;
  appBytes: number;
  agentBytes: number;
  agentCount: number;
  /** Cumulative CPU of the app's processes alive at this tick. */
  appCpuMs: number;
  agentCpuMs: number;
}

export function sampleOnce(groups: Groups): Sample {
  const agentPids = tree(groups.agents);
  const agentSet = new Set(agentPids);
  const appPids = groups.app.filter((pid) => !agentSet.has(pid));
  let appBytes = 0;
  let appCpuMs = 0;
  for (const pid of appPids) {
    appBytes += pss(pid);
    appCpuMs += cpuMs(pid);
  }
  let agentBytes = 0;
  let agentCpuMs = 0;
  for (const pid of agentPids) {
    agentBytes += pss(pid);
    agentCpuMs += cpuMs(pid);
  }
  return { at: now(), appBytes, agentBytes, agentCount: groups.agents.filter((pid) => agentSet.has(pid)).length, appCpuMs, agentCpuMs };
}

/** Samples at 4 Hz for `seconds`, asking for the process groups at every tick: agents come and go. */
export async function sampleFor(seconds: number, groups: () => Groups): Promise<Sample[]> {
  const samples: Sample[] = [];
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    samples.push(sampleOnce(groups()));
    await Bun.sleep(250);
  }
  return samples;
}

/** CPU of one group over the window, in percent of one core. A process that left takes its time with it. */
export function cpuPercent(samples: readonly Sample[], group: 'app' | 'agents' = 'app'): number {
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined || last.at === first.at) return 0;
  const used = group === 'app' ? last.appCpuMs - first.appCpuMs : last.agentCpuMs - first.agentCpuMs;
  return (Math.max(0, used) / (last.at - first.at)) * 100;
}

function walk(path: string, out: string[]): void {
  let info;
  try {
    info = statSync(path);
  } catch {
    return;
  }
  if (info.isFile()) out.push(path);
  else if (info.isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry), out);
}

/**
 * Asks the kernel to drop these files from the page cache, the part of `sudo
 * purge` an unprivileged run can do. Pages another process still maps stay, so
 * a binary some other session runs is never cold: name a private copy.
 */
export function evict(paths: readonly string[]): number {
  Bun.spawnSync(['sync']);
  const libc = dlopen('libc.so.6', { posix_fadvise: { args: [FFIType.i32, FFIType.i64, FFIType.i64, FFIType.i32], returns: FFIType.i32 } });
  const files: string[] = [];
  for (const path of paths) walk(path, files);
  let dropped = 0;
  for (const file of files) {
    let fd: number;
    try {
      fd = openSync(file, 'r');
    } catch {
      continue;
    }
    // 4 is POSIX_FADV_DONTNEED; a length of 0 means to the end of the file.
    if (libc.symbols.posix_fadvise(fd, 0n, 0n, 4) === 0) dropped += 1;
    closeSync(fd);
  }
  libc.close();
  return dropped;
}

/** A terminal's bytes without colours, cursor moves and titles. */
export function plain(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are the subject.
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>()][0-9A-Za-z]?/g, '');
}

/** How many probe characters `text` ends with: what a composer holds once it takes keys. */
export function probeRun(text: string): number {
  let run = 0;
  while (run < text.length && PROBE.includes(text[text.length - 1 - run] as string)) run += 1;
  return run;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1))] as number;
}

/** Waits for `test` to hold, polling: returns false at the deadline instead of throwing. */
export async function until(test: () => boolean | Promise<boolean>, timeoutMs: number, everyMs = 20): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (await test()) return true;
    await Bun.sleep(everyMs);
  }
  return false;
}
