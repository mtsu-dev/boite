import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellBuildMarker, shellProvenanceProblem } from './shell-artifact.ts';

test('copying an old shell does not make it a build of the current UI, target or channel', () => {
  const root = mkdtempSync(join(tmpdir(), 'boite-shell-artifact-'));
  try {
    const ui = join(root, 'packages', 'ui');
    mkdirSync(ui, { recursive: true });
    const source = join(ui, 'index.html');
    const original = join(root, 'original.exe');
    const copy = join(root, 'copy.exe');
    const target = 'x86_64-pc-windows-msvc';
    writeFileSync(source, 'first');
    const marker = shellBuildMarker(root, target, 'nightly');
    writeFileSync(original, `executable\0${marker}\0`);
    copyFileSync(original, copy);
    expect(shellProvenanceProblem(copy, root, target, ['nightly'])).toBeNull();
    expect(shellProvenanceProblem(copy, root, target, ['stable'])).toContain('provenance');
    expect(shellProvenanceProblem(copy, root, 'aarch64-apple-darwin', ['nightly'])).toContain('provenance');
    writeFileSync(source, 'second');
    copyFileSync(original, copy);
    expect(shellProvenanceProblem(copy, root, target, ['nightly'])).toContain('provenance');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
