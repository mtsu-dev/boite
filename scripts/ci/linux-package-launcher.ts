#!/usr/bin/env bun
/**
 * The Linux group launcher as a desktop package ships it: present at
 * usr/bin/boite-launch, mode 0755 exactly, byte for byte the launcher this
 * job built (packages/core/bin/build-launcher.ts, `cc -static`), and that
 * file a static executable for the package's architecture as readelf reads
 * it: type EXEC, a non-zero entry point, no interpreter, no dynamic section.
 *
 *   linux-package-launcher.ts deb <file.deb> <built launcher>
 *   linux-package-launcher.ts appimage <file.AppImage> <extracted squashfs-root> <built launcher>
 *   linux-package-launcher.ts root <dir> <built launcher>          (an installed tree, such as /)
 *
 * The AppImage's squashfs entry is read with unsquashfs, required, and the
 * extracted tree is checked as well. The architecture is the one this runner
 * builds for: BOITE_TARGET's triple, or the runner's own.
 */
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LAUNCHER = 'usr/bin/boite-launch';
/** readelf's Machine line for each architecture a package is built for. */
const MACHINES: Record<string, string> = { x86_64: 'Advanced Micro Devices X86-64', aarch64: 'AArch64' };

export interface ElfFacts { type: string; machine: string; entry: bigint; interpreter: boolean; dynamic: boolean; needed: string[] }

/** What `readelf -h -l -d -W` says of one file. */
export function parseReadelf(text: string): ElfFacts {
  const field = (name: string) => new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  const entry = field('Entry point address');
  return {
    type: field('Type').split(/\s+/)[0] ?? '',
    machine: field('Machine'),
    entry: /^0x[0-9a-f]+$/i.test(entry) ? BigInt(entry) : 0n,
    interpreter: /^\s*INTERP\s/m.test(text),
    // A PT_DYNAMIC header, or a dynamic section readelf lists.
    dynamic: /^\s*DYNAMIC\s/m.test(text) || /^Dynamic section at offset/m.test(text),
    needed: [...text.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map(m => m[1]!),
  };
}

/** Why `facts` is not a static executable for `machine`, each reason once. */
export function staticProblems(facts: ElfFacts, machine: string): string[] {
  const problems: string[] = [];
  if (facts.type !== 'EXEC') problems.push(`type ${facts.type || 'unknown'}, not EXEC (a static executable)`);
  if (facts.machine !== (MACHINES[machine] ?? machine)) problems.push(`built for ${facts.machine || 'no machine'}, this package is ${machine}`);
  if (facts.entry === 0n) problems.push('no entry point');
  if (facts.interpreter) problems.push('asks for an interpreter');
  if (facts.dynamic) problems.push('has a dynamic section');
  if (facts.needed.length > 0) problems.push(`needs ${facts.needed.join(', ')}`);
  return problems;
}

/**
 * The mode, size and member name `dpkg-deb -c` lists for `path`, or null when
 * the package has no such entry. dpkg-deb --build stores `./usr/...`; the
 * Tauri bundler stores `usr/...`.
 */
export function debEntry(listing: string, path: string): { mode: string; size: number; name: string } | null {
  for (const line of listing.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const name = fields.at(-1);
    if (fields.length >= 6 && (name === `./${path}` || name === path)) return { mode: fields[0]!, size: Number(fields[2]), name: name! };
  }
  return null;
}

/** The mode `unsquashfs -ll` lists for `path`, or null. */
export function squashEntry(listing: string, path: string): string | null {
  for (const line of listing.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 6 && fields.at(-1) === `squashfs-root/${path}`) return fields[0]!;
  }
  return null;
}

export function expectedMachine(target = process.env.BOITE_TARGET ?? '', arch = process.arch): string {
  const triple = target.trim();
  if (triple !== '') return triple.split('-')[0]!;
  return arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch;
}

/** The mode as `ls -l` writes it, setuid, setgid and sticky bits included: `-rwxr-xr-x` for a regular file of mode 0755 only. */
export function modeString(mode: number): string {
  const bits = 'rwxrwxrwx'.split('').map((c, i) => (mode & (0o400 >> i)) !== 0 ? c : '-');
  for (const [index, flag, set] of [[2, 0o4000, 's'], [5, 0o2000, 's'], [8, 0o1000, 't']] as const) {
    if ((mode & flag) !== 0) bits[index] = bits[index] === 'x' ? set : set.toUpperCase();
  }
  return ((mode & 0o170000) === 0o100000 ? '-' : '?') + bits.join('');
}

/** A command's output as bytes; a failure carries the tool's own words instead of an empty or cut read. */
function bytesOf(cmd: string[], stdin?: Uint8Array): Uint8Array {
  const done = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', ...(stdin ? { stdin } : {}) });
  if (done.exitCode !== 0) throw new Error(`${cmd.join(' ')}: exit ${done.exitCode}: ${done.stderr.toString().trim()}`);
  return new Uint8Array(done.stdout);
}

const run = (cmd: string[]): string => Buffer.from(bytesOf(cmd)).toString();

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/** readelf's facts of `bytes`, read from a file of their own. */
function readelf(bytes: Uint8Array): ElfFacts {
  const dir = mkdtempSync(join(tmpdir(), 'boite-launch-elf-'));
  try {
    const file = join(dir, 'boite-launch');
    writeFileSync(file, bytes);
    const done = Bun.spawnSync(['readelf', '-h', '-l', '-d', '-W', file], { stdout: 'pipe', stderr: 'pipe' });
    if (done.exitCode !== 0) throw new Error(`readelf: ${done.stderr.toString().trim() || `exit ${done.exitCode}`}`);
    return parseReadelf(done.stdout.toString());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** One launcher as some route ships it: its mode, its format, and that it is the built one. */
function check(where: string, mode: string, bytes: Uint8Array, built: Uint8Array, problems: string[]): string {
  if (mode !== '-rwxr-xr-x') problems.push(`${where}: mode ${mode}, not -rwxr-xr-x (755)`);
  const machine = expectedMachine();
  let facts: ElfFacts;
  try { facts = readelf(bytes); } catch (error) { problems.push(`${where}: ${(error as Error).message}`); return `${where}: unreadable`; }
  for (const problem of staticProblems(facts, machine)) problems.push(`${where}: ${problem}`);
  const digest = sha256(bytes), want = sha256(built);
  if (digest !== want) problems.push(`${where}: sha256 ${digest}, not the built launcher's ${want}`);
  return `${where}: ${mode} ${bytes.length} bytes, ${facts.type} ${facts.machine}, entry 0x${facts.entry.toString(16)}, sha256 ${digest}`;
}

function fromTree(root: string, where: string, built: Uint8Array, problems: string[]): string {
  const path = join(root, LAUNCHER);
  let mode: number;
  try {
    mode = lstatSync(path).mode;
  } catch {
    problems.push(`${where}: no ${LAUNCHER}`);
    return `${where}: missing`;
  }
  // The string check refuses a setuid, setgid or sticky bit too; the number says so outright.
  if ((mode & 0o7777) !== 0o755) problems.push(`${where}: mode ${(mode & 0o7777).toString(8).padStart(4, '0')}, not 0755`);
  return check(where, modeString(mode), readFileSync(path), built, problems);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const kind = args[0], builtPath = args.at(-1);
  const usage = () => {
    console.error('usage: linux-package-launcher.ts deb <file.deb> <built> | appimage <file.AppImage> <squashfs-root> <built> | root <dir> <built>');
    process.exit(2);
  };
  if (!((kind === 'deb' || kind === 'root') && args.length === 3) && !(kind === 'appimage' && args.length === 4)) usage();
  const problems: string[] = [];
  const lines: string[] = [];
  const built = new Uint8Array(readFileSync(builtPath!));
  // The reference itself must be what build-launcher.ts makes; its own mode is the build's, not the package's.
  const reference = readelf(built);
  for (const problem of staticProblems(reference, expectedMachine())) problems.push(`built ${builtPath}: ${problem}`);
  lines.push(`built ${builtPath}: ${built.length} bytes, ${reference.type} ${reference.machine}, entry 0x${reference.entry.toString(16)}, sha256 ${sha256(built)}`);
  const file = args[1]!;
  if (kind === 'deb') {
    const listing = run(['dpkg-deb', '-c', file]);
    const entry = debEntry(listing, LAUNCHER);
    if (entry === null) {
      const near = listing.split('\n').filter(line => line.includes('boite')).map(line => line.trim());
      problems.push(`${file}: no ${LAUNCHER} (its boite entries: ${near.length > 0 ? near.join(' | ') : 'none'})`);
    } else {
      const bytes = bytesOf(['tar', '-xOf', '-', entry.name], bytesOf(['dpkg-deb', '--fsys-tarfile', file]));
      if (bytes.length !== entry.size) problems.push(`${file}: extracted ${bytes.length} bytes, listed ${entry.size}`);
      lines.push(check(`${file} ${entry.name}`, entry.mode, bytes, built, problems));
    }
  } else if (kind === 'appimage') {
    // The squashfs entry itself, then the tree the AppImage extracted.
    if (!Bun.which('unsquashfs')) problems.push(`${file}: unsquashfs is missing (squashfs-tools), the squashfs entry cannot be read`);
    else {
      const offset = run([file, '--appimage-offset']).trim();
      const mode = squashEntry(run(['unsquashfs', '-ll', '-o', offset, file, LAUNCHER]), LAUNCHER);
      if (mode === null) problems.push(`${file}: squashfs has no ${LAUNCHER}`);
      else lines.push(check(`${file} squashfs ${LAUNCHER}`, mode, bytesOf(['unsquashfs', '-o', offset, '-cat', file, LAUNCHER]), built, problems));
    }
    lines.push(fromTree(args[2]!, `${args[2]}/${LAUNCHER}`, built, problems));
  } else {
    lines.push(fromTree(file, join(file, LAUNCHER), built, problems));
  }
  for (const line of lines) console.log(line);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
}
