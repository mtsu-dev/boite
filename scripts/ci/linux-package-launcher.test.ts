import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { debEntry, expectedMachine, modeString, parseReadelf, squashEntry, staticProblems } from './linux-package-launcher.ts';

const script = resolve(import.meta.dir, 'linux-package-launcher.ts');
const own = expectedMachine('', process.arch);
const tools = process.platform === 'linux' && ['cc', 'readelf', 'dpkg-deb'].every(tool => Bun.which(tool) !== null);
const squashTools = tools && Bun.which('mksquashfs') !== null && Bun.which('unsquashfs') !== null;

/** A minimal 64-bit little-endian ELF header for `machine`, type and entry left at zero, one program header of `type`. */
function fakeElf(machine: number, type: number): Uint8Array {
  const bytes = new Uint8Array(64 + 56);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(18, machine, true);
  view.setBigUint64(32, 64n, true);
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 1, true);
  view.setUint32(64, type, true);
  return bytes;
}

let dir = '';
/** The launcher as build-launcher.ts makes it, another static program, and a shared library without PT_INTERP. */
const files = { launcher: '', other: '', shared: '', fake: '', foreign: '' };

beforeAll(() => {
  if (!tools) return;
  dir = mkdtempSync(join(tmpdir(), 'boite-package-launcher-'));
  const cc = (args: string[]) => {
    const done = Bun.spawnSync(['cc', ...args], { stdout: 'pipe', stderr: 'pipe' });
    if (done.exitCode !== 0) throw new Error(done.stderr.toString());
  };
  files.launcher = join(dir, 'built-launch');
  const built = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../packages/core/bin/build-launcher.ts'), `--outfile=${files.launcher}`], { stdout: 'pipe', stderr: 'pipe' });
  if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  writeFileSync(join(dir, 'other.c'), 'int main(void) { return 0; }\n');
  files.other = join(dir, 'other');
  cc(['-static', '-O2', '-o', files.other, join(dir, 'other.c')]);
  writeFileSync(join(dir, 'shared.c'), 'int boite_shared(void) { return 1; }\n');
  files.shared = join(dir, 'shared.so');
  cc(['-shared', '-fPIC', '-o', files.shared, join(dir, 'shared.c')]);
  files.fake = join(dir, 'fake');
  writeFileSync(files.fake, fakeElf(own === 'aarch64' ? 183 : 62, 1));
  files.foreign = join(dir, 'foreign');
  writeFileSync(files.foreign, fakeElf(own === 'aarch64' ? 62 : 183, 1));
});
afterAll(() => { if (dir !== '') rmSync(dir, { recursive: true, force: true }); });

const readelf = (file: string) => parseReadelf(Bun.spawnSync(['readelf', '-h', '-l', '-d', '-W', file], { stdout: 'pipe', stderr: 'pipe' }).stdout.toString());
const cli = (args: string[], env: Record<string, string> = {}) =>
  Bun.spawnSync([process.execPath, script, ...args], { env: { ...process.env, BOITE_TARGET: '', ...env }, stdout: 'pipe', stderr: 'pipe' });

test('the listings give the launcher entry, and only it', () => {
  const deb = [
    'drwxr-xr-x root/root         0 2026-11-21 10:00 ./usr/bin/',
    '-rwxr-xr-x root/root    905672 2026-11-21 10:00 ./usr/bin/boite-launch',
    '-rw-r--r-- root/root        12 2026-11-21 10:00 ./usr/bin/boite-launch.txt',
  ].join('\n');
  expect(debEntry(deb, 'usr/bin/boite-launch')).toEqual({ mode: '-rwxr-xr-x', size: 905672 });
  expect(debEntry(deb, 'usr/bin/boite-core')).toBeNull();
  const squash = '-rwxr-xr-x root/root            657160 2026-11-21 10:00 squashfs-root/usr/bin/boite-launch';
  expect(squashEntry(squash, 'usr/bin/boite-launch')).toBe('-rwxr-xr-x');
  expect(squashEntry(squash, 'usr/bin/boite-shell')).toBeNull();
});

test('the mode string shows setuid, setgid and sticky bits as ls does', () => {
  expect(modeString(0o100755)).toBe('-rwxr-xr-x');
  expect(modeString(0o104755)).toBe('-rwsr-xr-x');
  expect(modeString(0o102755)).toBe('-rwxr-sr-x');
  expect(modeString(0o101755)).toBe('-rwxr-xr-t');
  expect(modeString(0o104644)).toBe('-rwSr--r--');
  expect(modeString(0o040755)).toBe('?rwxr-xr-x');
});

test('the expected machine follows the cross target, then the runner', () => {
  expect(expectedMachine('aarch64-unknown-linux-gnu', 'x64')).toBe('aarch64');
  expect(expectedMachine('', 'x64')).toBe('x86_64');
  expect(expectedMachine('', 'arm64')).toBe('aarch64');
});

test.skipIf(!tools)('readelf passes the built launcher only, not a shared library without an interpreter or a bare header', () => {
  expect(staticProblems(readelf(files.launcher), own)).toEqual([]);
  expect(staticProblems(readelf(files.other), own)).toEqual([]);
  const shared = readelf(files.shared);
  expect(shared.interpreter).toBe(false);
  expect(staticProblems(shared, own)).toEqual(expect.arrayContaining(['type DYN, not EXEC (a static executable)', 'has a dynamic section']));
  const fake = staticProblems(readelf(files.fake), own);
  expect(fake).toContain('no entry point');
  expect(fake.some(problem => problem.startsWith('type '))).toBe(true);
  expect(staticProblems(readelf(files.foreign), own).some(problem => problem.startsWith('built for '))).toBe(true);
});

test.skipIf(!tools)('a package passes with the built launcher at 0755, and fails on any other file or mode', () => {
  const deb = (name: string, file: string, mode: number) => {
    const root = join(dir, `deb-${name}`);
    mkdirSync(join(root, 'DEBIAN'), { recursive: true });
    mkdirSync(join(root, 'usr', 'bin'), { recursive: true });
    writeFileSync(join(root, 'DEBIAN', 'control'), `Package: t${name}\nVersion: 1\nArchitecture: all\nMaintainer: t <t@example.invalid>\nDescription: t\n`);
    copyFileSync(file, join(root, 'usr', 'bin', 'boite-launch'));
    chmodSync(join(root, 'usr', 'bin', 'boite-launch'), mode);
    const out = join(dir, `${name}.deb`);
    const built = Bun.spawnSync(['dpkg-deb', '--root-owner-group', '--build', root, out], { stdout: 'pipe', stderr: 'pipe' });
    if (built.exitCode !== 0) throw new Error(built.stderr.toString());
    return out;
  };
  const good = cli(['deb', deb('good', files.launcher, 0o755), files.launcher]);
  expect(good.stderr.toString()).toBe('');
  expect(good.exitCode).toBe(0);
  expect(good.stdout.toString()).toContain('-rwxr-xr-x');
  const refused: Array<[string, string, number, string]> = [
    ['mode', files.launcher, 0o644, 'mode -rw-r--r--, not -rwxr-xr-x (755)'],
    ['setuid', files.launcher, 0o4755, 'mode -rwsr-xr-x, not -rwxr-xr-x (755)'],
    ['setgid', files.launcher, 0o2755, 'mode -rwxr-sr-x, not -rwxr-xr-x (755)'],
    ['sticky', files.launcher, 0o1755, 'mode -rwxr-xr-t, not -rwxr-xr-x (755)'],
    ['shared', files.shared, 0o755, 'type DYN, not EXEC'],
    ['fake', files.fake, 0o755, 'no entry point'],
    ['foreign', files.foreign, 0o755, `this package is ${own}`],
    ['other', files.other, 0o755, "not the built launcher's"],
  ];
  for (const [name, file, mode, reason] of refused) {
    const result = cli(['deb', deb(name, file, mode), files.launcher]);
    expect({ name, exit: result.exitCode }).toEqual({ name, exit: 1 });
    expect(result.stderr.toString()).toContain(reason);
  }
});

test.skipIf(!tools)('an installed or extracted tree refuses any mode but 0755, special bits included', () => {
  const tree = (mode: number, file = files.launcher) => {
    const root = join(dir, `tree-${mode.toString(8)}-${file === files.launcher ? 'built' : 'other'}`);
    mkdirSync(join(root, 'usr', 'bin'), { recursive: true });
    copyFileSync(file, join(root, 'usr', 'bin', 'boite-launch'));
    chmodSync(join(root, 'usr', 'bin', 'boite-launch'), mode);
    return cli(['root', root, files.launcher]);
  };
  expect(tree(0o755).exitCode).toBe(0);
  for (const mode of [0o4755, 0o2755, 0o1755, 0o775, 0o700]) {
    const refused = tree(mode);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.toString()).toContain(`mode ${mode.toString(8).padStart(4, '0')}, not 0755`);
  }
  expect(tree(0o755, files.other).stderr.toString()).toContain("not the built launcher's");
});

test.skipIf(!squashTools)('an AppImage is read in its squashfs, which unsquashfs must be there to read', () => {
  // An AppImage is a runtime that answers --appimage-offset, then a squashfs at that offset.
  const image = (name: string, mode: number) => {
    const root = join(dir, `squash-${name}`);
    mkdirSync(join(root, 'usr', 'bin'), { recursive: true });
    copyFileSync(files.launcher, join(root, 'usr', 'bin', 'boite-launch'));
    chmodSync(join(root, 'usr', 'bin', 'boite-launch'), mode);
    const squash = join(dir, `${name}.squashfs`);
    const made = Bun.spawnSync(['mksquashfs', root, squash, '-quiet', '-noappend', '-all-root'], { stdout: 'pipe', stderr: 'pipe' });
    if (made.exitCode !== 0) throw new Error(made.stderr.toString());
    const runtime = new TextEncoder().encode('#!/bin/sh\necho 4096\nexit 0\n'.padEnd(4096, '\n'));
    const file = join(dir, `${name}.AppImage`);
    writeFileSync(file, Buffer.concat([runtime, readFileSync(squash)]));
    chmodSync(file, 0o755);
    // The extracted tree stays right, so only the squashfs read can refuse it.
    const extracted = join(dir, `extracted-${name}`);
    mkdirSync(join(extracted, 'usr', 'bin'), { recursive: true });
    copyFileSync(files.launcher, join(extracted, 'usr', 'bin', 'boite-launch'));
    chmodSync(join(extracted, 'usr', 'bin', 'boite-launch'), 0o755);
    return [file, extracted, files.launcher];
  };
  const good = cli(['appimage', ...image('good', 0o755)]);
  expect(good.stderr.toString()).toBe('');
  expect(good.exitCode).toBe(0);
  expect(good.stdout.toString()).toContain('squashfs usr/bin/boite-launch: -rwxr-xr-x');
  const setuid = cli(['appimage', ...image('setuid', 0o4755)]);
  expect(setuid.exitCode).toBe(1);
  expect(setuid.stderr.toString()).toContain('squashfs usr/bin/boite-launch: mode -rwsr-xr-x, not -rwxr-xr-x (755)');
  // Without unsquashfs on PATH the check fails rather than trust the extracted tree alone.
  const bin = join(dir, 'bin-without-unsquashfs');
  mkdirSync(bin);
  for (const tool of ['sh', 'readelf', 'tar', 'dpkg-deb']) symlinkSync(Bun.which(tool)!, join(bin, tool));
  const missing = cli(['appimage', ...image('missing', 0o755)], { PATH: bin });
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr.toString()).toContain('unsquashfs is missing (squashfs-tools)');
});
