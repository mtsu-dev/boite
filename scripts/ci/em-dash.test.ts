import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { emDashes } from './em-dash.ts';

test('em dashes are located by line and column, escapes and binary files pass', () => {
  expect(emDashes(Buffer.from('é\nab\u2014c \u2014\n\u2014'))).toEqual(['2:3', '2:6', '3:1']);
  expect(emDashes(Buffer.from('"Done \\u2014" and – en dash'))).toEqual([]);
  expect(emDashes(Buffer.concat([Buffer.from([0x89, 0, 1]), Buffer.from('\u2014')]))).toEqual([]);
});

test('the CLI fails on a tracked file only', () => {
  const root = mkdtempSync(join(tmpdir(), 'boite-em-dash-'));
  const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: root });
  const run = () => Bun.spawnSync([process.execPath, resolve(import.meta.dir, 'em-dash.ts')], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  try {
    git('init', '-q');
    writeFileSync(join(root, 'clean.md'), 'Ready: go\n');
    writeFileSync(join(root, 'untracked.md'), 'Ready \u2014 go\n');
    git('add', 'clean.md');
    expect(run().exitCode).toBe(0);
    writeFileSync(join(root, 'doc.md'), 'Title\nReady \u2014 go\n');
    git('add', 'doc.md');
    const failed = run();
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr.toString()).toContain('doc.md:2:7: no-em-dash');
    expect(failed.stderr.toString()).not.toContain('untracked.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
