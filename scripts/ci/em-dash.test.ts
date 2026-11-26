import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('the CLI names each em dash in a tracked text file, whatever its working-tree encoding', () => {
  const root = mkdtempSync(join(tmpdir(), 'boite-em-dash-'));
  const git = (...args: string[]) => expect(Bun.spawnSync(['git', '-c', 'core.autocrlf=false', ...args], { cwd: root }).exitCode).toBe(0);
  const run = () => Bun.spawnSync([process.execPath, resolve(import.meta.dir, 'em-dash.ts')], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  try {
    git('init', '-q');
    writeFileSync(join(root, 'clean.md'), 'Ready: go, "Done \\u2014" and \u2013 en dash\n');
    writeFileSync(join(root, 'image.bin'), Buffer.concat([Buffer.from([0x89, 0, 1]), Buffer.from('\u2014')]));
    writeFileSync(join(root, 'untracked.md'), 'Ready \u2014 go\n');
    git('add', 'clean.md', 'image.bin');
    expect(run().exitCode).toBe(0);
    writeFileSync(join(root, 'doc.md'), 'Title\nReady \u2014 go \u2014\n');
    // Columns count bytes, as git grep does. Git stores this file as UTF-8 and checks it out as UTF-16LE with a BOM.
    writeFileSync(join(root, '.gitattributes'), '*.ps1 working-tree-encoding=UTF-16LE-BOM\n');
    writeFileSync(join(root, 'run.ps1'), Buffer.from('\ufeffWrite-Host "a \u2014 b"\n', 'utf16le'));
    git('add', '.gitattributes', 'doc.md', 'run.ps1');
    const failed = run();
    const errors = failed.stderr.toString();
    expect(failed.exitCode).toBe(1);
    expect(errors).toContain('doc.md:2:7: no-em-dash');
    expect(errors).toContain('doc.md:2:16: no-em-dash');
    expect(errors).toContain('run.ps1:1:');
    for (const file of ['clean.md', 'image.bin', 'untracked.md']) expect(errors).not.toContain(file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
