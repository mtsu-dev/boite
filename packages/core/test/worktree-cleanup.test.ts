import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, rmdirSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import * as fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ThreadSummary } from '@boite/contracts';
import { assertAllowed } from '../src/access.ts';
import { runCli } from '../src/cli.ts';
import { realKey, restoreInterruptedCheckout } from '../src/checkout-removal.ts';
import { finishCheckoutRecovery } from '../src/checkout-recovery.ts';
import { Journal } from '../src/journal.ts';
import { WorktreeCleanup } from '../src/worktree-cleanup.ts';
import { worktreeRoot } from '../src/worktree.ts';
import { startTestCore, type TestCore } from './harness.ts';
import type { CoreClient } from '../src/client.ts';
import { rejection } from './settle.ts';

let harness: TestCore;
let client: CoreClient;
let cleanup: WorktreeCleanup;
let restoreSpawn: (() => void) | undefined;

beforeEach(async () => {
  harness = await startTestCore();
  client = await harness.connect();
  // The core's own pass waits five minutes; the test runs one with no grace.
  cleanup = new WorktreeCleanup(harness.core, { graceMs: 0, startDelayMs: 3_600_000 });
});

afterEach(async () => {
  restoreSpawn?.();
  restoreSpawn = undefined;
  await cleanup.close();
  await harness.stop();
});

const FIXTURE_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'boite test',
  GIT_AUTHOR_EMAIL: 'test@boite.invalid',
  GIT_COMMITTER_NAME: 'boite test',
  GIT_COMMITTER_EMAIL: 'test@boite.invalid',
};

function gitResult(cwd: string, args: string[], indexFile?: string) {
  const env = indexFile === undefined ? FIXTURE_GIT_ENV : { ...FIXTURE_GIT_ENV, GIT_INDEX_FILE: indexFile };
  const run = Bun.spawnSync({ cmd: ['git', ...args], cwd, env, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

function git(cwd: string, ...args: string[]): string {
  const result = gitResult(cwd, args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function repoProject(): Promise<{ id: string; path: string }> {
  const path = join(harness.dataDir, 'repo');
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(path, 'README.md'), 'hello\n');
  git(path, 'add', 'README.md');
  git(path, 'commit', '-q', '-m', 'init');
  git(path, 'remote', 'add', 'origin', 'https://github.com/example/repo.git');
  return client.call('projects.add', { path, name: 'repo' });
}

async function worktreeThread(project: { id: string }, title: string): Promise<ThreadSummary> {
  const account = (await client.call('accounts.list', {})).find((entry) => entry.providerId === 'echo');
  if (account === undefined) throw new Error('no echo account');
  return client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title, worktree: {} });
}

/** A commit only this worktree's branch has, as an agent's work before a squash merge. */
function commitWork(cwd: string): string {
  writeFileSync(join(cwd, 'work.txt'), 'done\n');
  git(cwd, 'add', 'work.txt');
  git(cwd, 'commit', '-q', '-m', 'work');
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Dates the worktree's `.git` file and its admin folder's HEAD, index and HEAD log two hours back. */
function ageGitFiles(cwd: string): void {
  const old = (Date.now() - 2 * 3_600_000) / 1000;
  const admin = git(cwd, 'rev-parse', '--absolute-git-dir');
  for (const path of [join(cwd, '.git'), join(admin, 'HEAD'), join(admin, 'index'), join(admin, 'logs', 'HEAD')]) {
    if (existsSync(path)) utimesSync(path, old, old);
  }
}

function branches(project: { path: string }): string[] {
  return git(project.path, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean);
}

async function summary(threadId: string): Promise<ThreadSummary> {
  const found = (await client.call('threads.list', { includeArchived: true })).find((thread) => thread.id === threadId);
  if (found === undefined) throw new Error(`${threadId} not listed`);
  return found;
}

/** `gh pr list` answers this merged pull request for any branch it is asked about. */
function mergedPullRequest(branch: string, sha: string, during?: () => void): { calls: () => number } {
  let calls = 0;
  const spawn = harness.core.procs.spawn.bind(harness.core.procs);
  const replacement = spyOn(harness.core.procs, 'spawn').mockImplementation((scope, command, args, options) => {
    if (command !== 'gh') return spawn(scope, command, args, options);
    calls++;
    during?.();
    const pr = { number: 12, url: 'https://github.com/example/repo/pull/12', state: 'MERGED', headRefName: branch, headRefOid: sha, headRepository: { name: 'repo' }, headRepositoryOwner: { login: 'example' }, isCrossRepository: false, mergedAt: '2026-10-15T10:00:00Z' };
    return spawn(scope, process.execPath, ['-e', `console.log(${JSON.stringify(JSON.stringify([pr]))})`], options);
  });
  restoreSpawn = () => replacement.mockRestore();
  return { calls: () => calls };
}

describe('settled worktree cleanup', () => {
  test('keeps a Done conversation checkout until its prompt finishes, even with no tracked process', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Finishing in Done');
    const sha = commitWork(thread.cwd);
    mergedPullRequest(thread.branch!, sha);
    const journal = harness.core.journal;
    journal.putThread({ ...journal.getThread(thread.id)!, archived: true, archivedAt: 1, doneAt: 1, status: 'running' });
    expect(harness.core.procs.liveCount(thread.id)).toBe(0);
    expect(await cleanup.run()).toEqual([]);
    expect(existsSync(thread.cwd)).toBe(true);
    journal.putThread({ ...journal.getThread(thread.id)!, status: 'idle' });
    expect(await cleanup.run()).toEqual([expect.objectContaining({ projectId: project.id, branch: thread.branch, reason: 'pr-merged' })]);
    expect(existsSync(thread.cwd)).toBe(false);
  });

  test('keeps a worktree whose conversation is restored while the merge proof is read', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Restored meanwhile');
    const sha = commitWork(thread.cwd);
    await client.call('threads.archive', { threadId: thread.id });
    const gh = mergedPullRequest(thread.branch!, sha, () => harness.core.journal.putThread({ ...harness.core.journal.getThread(thread.id)!, archived: false }));
    expect(await cleanup.run()).toEqual([]);
    expect(gh.calls()).toBeGreaterThan(0);
    expect(existsSync(thread.cwd)).toBe(true);
  });

  test('removes an archived thread\'s clean worktree with its branch, and the restored thread says so', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Settled');
    await client.call('threads.archive', { threadId: thread.id });

    const removed = await cleanup.run();
    expect(removed).toEqual([expect.objectContaining({ path: expect.any(String), reason: 'clean', branch: thread.branch, branchDeleted: true })]);
    expect(existsSync(thread.cwd)).toBe(false);
    if (process.platform !== 'darwin') {
      expect(readdirSync(dirname(thread.cwd)).filter(name => name.startsWith('.boite-removing-'))).toEqual([]);
      expect(await client.call('worktrees.recoveries', {})).toEqual([]);
    }
    expect(branches(project)).toEqual(['main']);
    expect((await summary(thread.id)).worktreeRemoved).toMatchObject({ path: thread.cwd, reason: 'clean', branch: thread.branch, branchDeleted: true });

    const restored = await client.call('threads.archive', { threadId: thread.id, archived: false });
    expect(restored.worktreeRemoved).toMatchObject({ path: thread.cwd, reason: 'clean' });
    expect((await rejection(client.call('turns.start', { threadId: thread.id, prompt: 'still there?' }))).reason).toMatchObject({
      rpc: { message: expect.stringContaining(thread.cwd) },
    });
  });

  test('a squash-merged head goes with its branch once the merged pull request names that exact commit', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Squashed');
    const sha = commitWork(thread.cwd);
    const branch = git(thread.cwd, 'branch', '--show-current');
    await client.call('threads.archive', { threadId: thread.id });
    const gh = mergedPullRequest(branch, sha);

    expect(await cleanup.run()).toEqual([expect.objectContaining({ reason: 'pr-merged', branch, branchDeleted: true })]);
    expect(gh.calls()).toBeGreaterThan(0);
    expect(existsSync(thread.cwd)).toBe(false);
    expect(branches(project)).toEqual(['main']);
    expect((await summary(thread.id)).worktreeRemoved).toMatchObject({ reason: 'pr-merged', pullRequest: { number: 12, url: 'https://github.com/example/repo/pull/12' } });
  });

  test('keeps an unmerged head when the merged pull request names another commit', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Moved on');
    const merged = commitWork(thread.cwd);
    writeFileSync(join(thread.cwd, 'later.txt'), 'after the merge\n');
    git(thread.cwd, 'add', 'later.txt');
    git(thread.cwd, 'commit', '-q', '-m', 'later');
    await client.call('threads.archive', { threadId: thread.id });
    mergedPullRequest(git(thread.cwd, 'branch', '--show-current'), merged);

    expect(await cleanup.run()).toEqual([]);
    expect(existsSync(thread.cwd)).toBe(true);
    expect((await summary(thread.id)).worktreeRemoved ?? null).toBeNull();
  });

  test('keeps a live thread\'s worktree, a fresh archive, a dirty one, an unproved one and a project that turned it off', async () => {
    const project = await repoProject();
    const live = await worktreeThread(project, 'Live');
    const dirty = await worktreeThread(project, 'Dirty');
    writeFileSync(join(dirty.cwd, 'notes.txt'), 'unsaved\n');
    const unproved = await worktreeThread(project, 'Unproved');
    commitWork(unproved.cwd);
    const fresh = await worktreeThread(project, 'Fresh');
    for (const thread of [dirty, unproved, fresh]) await client.call('threads.archive', { threadId: thread.id });
    // A fresh archive waits out the grace; every other one here has none.
    const graceful = new WorktreeCleanup(harness.core, { graceMs: 3_600_000, startDelayMs: 3_600_000 });
    expect(await graceful.run()).toEqual([]);
    await graceful.close();

    // No gh: an unmerged head without a proof stays.
    expect((await cleanup.run()).map((entry) => entry.path)).toEqual([expect.stringContaining(fresh.cwd.split(/[\\/]/).pop()!)]);
    for (const thread of [live, dirty, unproved]) expect(existsSync(thread.cwd)).toBe(true);

    const off = await worktreeThread(project, 'Off');
    await client.call('threads.archive', { threadId: off.id });
    const updated = await client.call('projects.setAutoRemoveWorktrees', { projectId: project.id, enabled: false });
    expect(updated.autoRemoveWorktrees).toBe(false);
    expect(await cleanup.run()).toEqual([]);
    expect(existsSync(off.cwd)).toBe(true);
  });

  test.each([false, true])('keeps ignored files in archived worktrees, written at removal: %s', async late => {
    const project = await repoProject();
    writeFileSync(join(project.path, '.gitignore'), 'notes.txt\n');
    git(project.path, 'add', '.gitignore');
    git(project.path, 'commit', '-qm', 'ignore notes');
    const thread = await worktreeThread(project, 'Ignored notes');
    const note = join(thread.cwd, 'notes.txt');
    if (!late) writeFileSync(note, 'keep me');
    if (late) {
      const spawn = harness.core.procs.spawn.bind(harness.core.procs);
      const removing = spyOn(harness.core.procs, 'spawn').mockImplementation((id, command, args, options) => {
        if (command === 'git' && args[0] === 'worktree' && (args[1] === 'move' || args[1] === 'remove') && args.at(args[1] === 'move' ? -2 : -1) === thread.cwd) {
          writeFileSync(note, 'keep me');
        }
        return spawn(id, command, args, options);
      });
      restoreSpawn = () => removing.mockRestore();
    }
    await client.call('threads.archive', { threadId: thread.id });
    expect(await cleanup.run()).toEqual([]);
    expect(readFileSync(note, 'utf8')).toBe('keep me');
    expect(branches(project)).toContain(thread.branch!);
  });

  test.skipIf(process.platform === 'win32')('keeps a tracked write through an open handle after the last status', async () => {
    const project = await repoProject();
    writeFileSync(join(project.path, 'unchanged.txt'), 'tracked content\n');
    writeFileSync(join(project.path, 'open.txt'), 'before\n');
    git(project.path, 'add', 'unchanged.txt', 'open.txt');
    git(project.path, 'commit', '-qm', 'add another file');
    const thread = await worktreeThread(project, 'Late tracked write');
    const commit = git(thread.cwd, 'rev-parse', 'HEAD');
    await client.call('threads.archive', { threadId: thread.id });
    const fd = openSync(join(thread.cwd, 'README.md'), 'a');
    const stillOpen = openSync(join(thread.cwd, 'open.txt'), 'a');
    const spawn = harness.core.procs.spawn.bind(harness.core.procs);
    let saved: string | undefined;
    const removing = spyOn(harness.core.procs, 'spawn').mockImplementation((id, command, args, options) => {
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        saved = join(dirname(args[2]!), 'saved');
        writeSync(fd, 'late edit\n');
      }
      return spawn(id, command, args, options);
    });
    restoreSpawn = () => removing.mockRestore();
    const log = spyOn(harness.core, 'log');
    try {
      expect(await cleanup.run()).toEqual([expect.objectContaining({ branch: thread.branch })]);
      expect(saved).toBeDefined();
      expect(existsSync(thread.cwd)).toBe(false);
      expect(fstatSync(fd).nlink).toBeGreaterThan(0);
      expect(readFileSync(join(saved!, 'README.md'), 'utf8')).toBe('hello\nlate edit\n');
      expect(log.mock.calls.some(([, message]) => message.includes(saved!))).toBe(true);
      // This descriptor was unchanged through both statuses and Git's removal.
      writeSync(stillOpen, 'written after cleanup returned\n');
      expect(readFileSync(join(saved!, 'open.txt'), 'utf8')).toBe('before\nwritten after cleanup returned\n');
      expect(existsSync(join(saved!, '.git'))).toBe(false);
      if (process.platform === 'linux') expect(readdirSync(saved!).sort()).toEqual(['README.md', 'open.txt']);
      expect(JSON.parse(readFileSync(join(dirname(saved!), 'recovery.json'), 'utf8'))).toMatchObject({ path: thread.cwd, commit });
    } finally {
      log.mockRestore();
      closeSync(fd);
      closeSync(stillOpen);
    }
  });

  test.skipIf(process.platform !== 'linux').each([false, true])('keeps an atomic save at compaction unlink (symlink=%s)', async symlink => {
    const project = await repoProject();
    const name = symlink ? 'link' : 'README.md';
    if (symlink) {
      symlinkSync('README.md', join(project.path, name));
      git(project.path, 'add', name);
      git(project.path, 'commit', '-qm', 'add link');
    }
    const saved = join(harness.dataDir, 'atomic-save', 'saved');
    mkdirSync(saved, { recursive: true });
    const path = join(saved, name);
    if (symlink) symlinkSync('README.md', path);
    else writeFileSync(path, 'hello\n');
    const replacement = join(dirname(saved), 'replacement');
    if (symlink) symlinkSync('late-target', replacement);
    else writeFileSync(replacement, 'late save\n');
    const unlink = fs.unlinkSync;
    let injected = false;
    const intercept = spyOn(fs, 'unlinkSync').mockImplementation(candidate => {
      if (typeof candidate === 'string' && basename(candidate) === name && !injected) {
        renameSync(replacement, path);
        injected = true;
      }
      return unlink(candidate);
    });
    try {
      await finishCheckoutRecovery(harness.core, { path: project.path, commit: git(project.path, 'rev-parse', 'HEAD'), recoveryPath: saved },
        async (args, index) => gitResult(project.path, args, index));
      expect(injected).toBe(true);
      expect(existsSync(saved)).toBe(true);
      expect(symlink ? readlinkSync(path) : readFileSync(path, 'utf8')).toBe(symlink ? 'late-target' : 'late save\n');
    } finally { intercept.mockRestore(); }
  });

  test.skipIf(process.platform !== 'linux')('compacts clean CRLF and keeps files requiring external Git filters', async () => {
    const project = await repoProject();
    writeFileSync(join(project.path, '.gitattributes'), '*.txt text eol=crlf\n*.fixture filter=recovery\n');
    git(project.path, 'config', 'filter.recovery.clean', 'tr a-z A-Z');
    git(project.path, 'config', 'filter.recovery.smudge', 'tr A-Z a-z');
    writeFileSync(join(project.path, 'doc.txt'), 'one\ntwo\n');
    writeFileSync(join(project.path, 'doc.fixture'), 'TEXT\n');
    git(project.path, 'add', '.');
    git(project.path, 'commit', '-qm', 'attributes');
    const thread = await worktreeThread(project, 'Clean conversions');
    const commit = git(thread.cwd, 'rev-parse', 'HEAD');
    expect(readFileSync(join(thread.cwd, 'doc.txt'), 'utf8')).toBe('one\r\ntwo\r\n');
    expect(readFileSync(join(thread.cwd, 'doc.fixture'), 'utf8')).toBe('text\n');
    expect(git(thread.cwd, 'status', '--porcelain')).toBe('');
    // The current repository tree must not supply the removed checkout's attributes.
    writeFileSync(join(project.path, '.gitattributes'), '*.txt -text\n*.fixture -filter\n');
    await client.call('threads.archive', { threadId: thread.id });
    expect(await cleanup.run()).toEqual([expect.objectContaining({ branch: thread.branch })]);
    const [recovery] = await client.call('worktrees.recoveries', {});
    expect(recovery).toEqual({ path: thread.cwd, commit, recoveryPath: expect.any(String) });
    expect(readdirSync(recovery!.recoveryPath)).toEqual(['doc.fixture']);
    expect(readFileSync(join(recovery!.recoveryPath, 'doc.fixture'), 'utf8')).toBe('text\n');
    expect(readdirSync(dirname(thread.cwd)).filter(name => name.startsWith('.boite-removing-'))).toEqual([basename(dirname(recovery!.recoveryPath))]);
  });

  test.skipIf(process.platform !== 'linux').each(['fixed', 'directory-dependent'])('keeps a late save that the %s Git filter maps to the original blob', async filter => {
    const project = await repoProject();
    writeFileSync(join(project.path, '.gitattributes'), '*.fixture filter=recovery\n');
    git(project.path, 'config', 'filter.recovery.clean', 'tr a-z A-Z');
    git(project.path, 'config', 'filter.recovery.smudge', filter === 'fixed' ? 'tr A-Z a-z'
      : 'case "$PWD" in */boite-recovery-git-*/checkout) cat >/dev/null; printf "TeXt\\n";; *) tr A-Z a-z;; esac');
    writeFileSync(join(project.path, 'doc.fixture'), 'TEXT\n');
    git(project.path, 'add', '.');
    git(project.path, 'commit', '-qm', 'attributes');
    const thread = await worktreeThread(project, 'Late filtered save');
    const commit = git(thread.cwd, 'rev-parse', 'HEAD');
    expect(readFileSync(join(thread.cwd, 'doc.fixture'), 'utf8')).toBe('text\n');
    await client.call('threads.archive', { threadId: thread.id });

    const spawn = harness.core.procs.spawn.bind(harness.core.procs);
    let saved: string | undefined;
    const removing = spyOn(harness.core.procs, 'spawn').mockImplementation((id, command, args, options) => {
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        saved = join(dirname(args[2]!), 'saved');
        const replacement = join(dirname(saved), 'replacement');
        writeFileSync(replacement, 'TeXt\n');
        renameSync(replacement, join(saved, 'doc.fixture'));
      }
      return spawn(id, command, args, options);
    });
    restoreSpawn = () => removing.mockRestore();

    expect(await cleanup.run()).toEqual([expect.objectContaining({ branch: thread.branch })]);
    expect(saved).toBeDefined();
    expect(existsSync(thread.cwd)).toBe(false);
    expect(await client.call('worktrees.recoveries', {})).toEqual([{ path: thread.cwd, commit, recoveryPath: saved! }]);
    expect(readFileSync(join(saved!, 'doc.fixture'), 'utf8')).toBe('TeXt\n');
    expect(readdirSync(saved!)).toEqual(['doc.fixture']);
    git(project.path, 'worktree', 'add', '--detach', thread.cwd, commit);
    expect(readFileSync(join(thread.cwd, 'doc.fixture'), 'utf8')).toBe('text\n');
  });

  test('keeps the captured edit when its public name is published again', async () => {
    const project = await repoProject();
    const saved = join(harness.dataDir, 'captured-edit', 'saved');
    mkdirSync(saved, { recursive: true });
    const path = join(saved, 'README.md');
    writeFileSync(path, 'captured edit\n');
    const rename = fs.renameSync;
    let captured: string | undefined;
    const intercept = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to);
      if (from === path && typeof to === 'string') {
        captured = to;
        writeFileSync(path, 'published again\n');
      }
    });
    try {
      await finishCheckoutRecovery(harness.core, { path: project.path, commit: git(project.path, 'rev-parse', 'HEAD'), recoveryPath: saved },
        async (args, index) => gitResult(project.path, args, index));
      expect(captured).toBeDefined();
      expect(readFileSync(captured!, 'utf8')).toBe('captured edit\n');
      expect(readFileSync(path, 'utf8')).toBe('published again\n');
    } finally { intercept.mockRestore(); }
  });

  test('detaches a recovery when a completed Git removal was interrupted', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Interrupted removal');
    const path = thread.cwd;
    const parent = dirname(path);
    const temporary = join(parent, '.boite-removing-interrupted');
    const staged = join(temporary, 'checkout');
    const saved = join(temporary, 'saved');
    const admin = await realKey(git(path, 'rev-parse', '--absolute-git-dir'));
    const commit = git(path, 'rev-parse', 'HEAD');
    mkdirSync(saved, { recursive: true });
    git(project.path, 'worktree', 'move', path, staged);
    for (const name of ['.git', 'README.md']) renameSync(join(staged, name), join(saved, name));
    rmdirSync(staged);
    git(project.path, 'worktree', 'remove', staged);
    writeFileSync(join(saved, 'notes.txt'), 'untracked recovery\n');
    const projectRow = harness.core.projects.require(project.id);
    const key = `checkout-removal:${await realKey(path)}`;
    harness.core.journal.setSetting(key, { path, staged, admin, commit });

    // Git can now reuse the old administrative directory for another checkout.
    git(project.path, 'worktree', 'add', '--detach', path);
    await restoreInterruptedCheckout(harness.core, projectRow, path, thread.branch!, async (args, index) => gitResult(project.path, args, index));
    expect(existsSync(join(saved, '.git'))).toBe(false);
    if (process.platform !== 'darwin') expect(readdirSync(saved)).toEqual(['notes.txt']);
    expect(readFileSync(join(saved, 'notes.txt'), 'utf8')).toBe('untracked recovery\n');
    const recovery = { path, commit, recoveryPath: saved };
    expect(JSON.parse(readFileSync(join(temporary, 'recovery.json'), 'utf8'))).toMatchObject(recovery);
    expect(harness.core.journal.getSetting(key)).toBeUndefined();
    const reopened = new Journal(join(harness.dataDir, 'journal.db'));
    try { expect(reopened.getSetting('checkout-recoveries')).toEqual([recovery]); }
    finally { reopened.close(); }
    let output = '';
    const cli = await runCli(['projects', 'recoveries', '--core', harness.url, '--json'], {
      cwd: project.path, env: { BOITE_TOKEN: harness.token }, out: text => { output += text; }, err: text => { throw new Error(text); },
    });
    expect(cli).toBe(0);
    expect(JSON.parse(output)).toEqual([recovery]);
    rmSync(saved, { recursive: true });
    expect(await client.call('worktrees.recoveries', {})).toEqual([]);
    expect(harness.core.journal.getSetting('checkout-recoveries') ?? []).toEqual([]);
  });

  test('inventories a completed interrupted removal after restart without compacting the saved files', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Interrupted removal');
    await client.call('threads.archive', { threadId: thread.id });
    const path = thread.cwd;
    const temporary = join(dirname(path), '.boite-removing-interrupted');
    const staged = join(temporary, 'checkout');
    const saved = join(temporary, 'saved');
    const admin = await realKey(git(path, 'rev-parse', '--absolute-git-dir'));
    const commit = git(path, 'rev-parse', 'HEAD');
    mkdirSync(saved, { recursive: true });
    git(project.path, 'worktree', 'move', path, staged);
    renameSync(join(staged, 'README.md'), join(saved, 'README.md'));
    renameSync(join(staged, '.git'), join(temporary, 'git-pointer'));
    rmdirSync(staged);
    git(project.path, 'worktree', 'remove', staged);
    writeFileSync(join(saved, 'notes.txt'), 'late save\n');
    const key = `checkout-removal:${await realKey(path)}`;
    harness.core.journal.setSetting(key, { path, staged, admin, commit });

    await cleanup.close();
    client.close();
    await harness.core.drain();
    await harness.server.stop();
    await harness.core.close();
    const next = await startTestCore({ dataDir: harness.dataDir });
    try {
      const owner = await next.connect();
      const recovery = { path, commit, recoveryPath: saved };
      expect(await Promise.all([owner.call('worktrees.recoveries', {}), owner.call('worktrees.recoveries', {})]))
        .toEqual([[recovery], [recovery]]);
      expect(await owner.call('worktrees.recoveries', {})).toEqual([recovery]);
      expect(next.core.journal.getSetting(key)).toBeUndefined();
      expect(JSON.parse(readFileSync(join(temporary, 'recovery.json'), 'utf8'))).toMatchObject(recovery);
      expect(existsSync(join(temporary, 'git-pointer'))).toBe(false);
      expect(readFileSync(join(saved, 'notes.txt'), 'utf8')).toBe('late save\n');
      expect(readFileSync(join(saved, 'README.md'), 'utf8')).toBe('hello\n');
    } finally { await next.stop(); }
  });

  test('keeps a branch that advances to another merged commit during cleanup', async () => {
    const project = await repoProject();
    const thread = await worktreeThread(project, 'Advancing branch');
    const ref = `refs/heads/${thread.branch}`;
    git(project.path, 'commit', '--allow-empty', '-qm', 'advance main');
    const head = git(project.path, 'rev-parse', 'HEAD');
    const spawn = harness.core.procs.spawn.bind(harness.core.procs);
    const deleting = spyOn(harness.core.procs, 'spawn').mockImplementation((id, command, args, options) => {
      if (command === 'git' && args[1] === '-d' && (args[0] === 'branch' && args[2] === thread.branch || args[0] === 'update-ref' && args[2] === ref)) {
        git(project.path, 'update-ref', ref, head);
      }
      return spawn(id, command, args, options);
    });
    restoreSpawn = () => deleting.mockRestore();
    await client.call('threads.archive', { threadId: thread.id });
    expect(await cleanup.run()).toEqual([expect.objectContaining({ branch: thread.branch, branchDeleted: false })]);
    expect(git(project.path, 'rev-parse', ref)).toBe(head);
  });

  test('a worktree no thread stands in goes only on a boite branch, outside a reservation, an hour after git last touched it', async () => {
    const project = await repoProject();
    const root = worktreeRoot(project.path);
    const orphan = join(root, 'orphan');
    git(project.path, 'worktree', 'add', '-q', '-b', 'boite/orphan', orphan);
    const recent = join(root, 'recent');
    git(project.path, 'worktree', 'add', '-q', '-b', 'boite/recent', recent);
    const mine = join(root, 'mine');
    git(project.path, 'worktree', 'add', '-q', '-b', 'feature/mine', mine);
    const elsewhere = join(harness.dataDir, 'elsewhere');
    git(project.path, 'worktree', 'add', '-q', '-b', 'boite/elsewhere', elsewhere);
    for (const path of [orphan, mine, elsewhere]) ageGitFiles(path);
    // Made two hours ago, but its HEAD, index and HEAD log moved just now: an agent still works in it.
    const active = join(root, 'active');
    git(project.path, 'worktree', 'add', '-q', '-b', 'boite/active', active);
    const old = (Date.now() - 2 * 3_600_000) / 1000;
    utimesSync(join(active, '.git'), old, old);

    const hourly = new WorktreeCleanup(harness.core, { graceMs: 3_600_000, startDelayMs: 3_600_000 });
    expect((await hourly.run()).map((entry) => entry.branch)).toEqual(['boite/orphan']);
    await hourly.close();
    expect(existsSync(orphan)).toBe(false);
    for (const path of [recent, mine, elsewhere, active]) expect(existsSync(path)).toBe(true);
  });

  test('a worktree no thread stands in stays while a live thread links an open pull request on its branch', async () => {
    const project = await repoProject();
    const linked = join(worktreeRoot(project.path), 'linked');
    git(project.path, 'worktree', 'add', '-q', '-b', 'boite/linked', linked);
    ageGitFiles(linked);
    // A delegated worker runs in another folder, made the worktree with git and linked its pull request.
    const account = (await client.call('accounts.list', {})).find((entry) => entry.providerId === 'echo');
    if (account === undefined) throw new Error('no echo account');
    const worker = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Worker' });
    harness.core.journal.setSetting(`linked-pull-requests:${worker.id}`, [{
      url: 'https://github.com/example/repo/pull/7', repository: 'example/repo', number: 7, title: 'work', state: 'OPEN', draft: false,
      head: 'boite/linked', base: 'main', headRepository: 'example/repo', checkedAt: Date.now(),
    }]);

    const hourly = new WorktreeCleanup(harness.core, { graceMs: 3_600_000, startDelayMs: 3_600_000 });
    expect(await hourly.run()).toEqual([]);
    expect(existsSync(linked)).toBe(true);
    await hourly.close();

    // Once the worker is archived, the abandoned worktree goes as before.
    await client.call('threads.archive', { threadId: worker.id });
    const later = new WorktreeCleanup(harness.core, { graceMs: 3_600_000, startDelayMs: 3_600_000 });
    expect((await later.run()).map((entry) => entry.branch)).toEqual(['boite/linked']);
    await later.close();
    expect(existsSync(linked)).toBe(false);
  });

  test('an open pull request claims a worktree only from a repository the project fetches', async () => {
    const project = await repoProject();
    git(project.path, 'remote', 'add', 'fork', 'git@github.com:me/repo.git');
    const account = (await client.call('accounts.list', {})).find((entry) => entry.providerId === 'echo');
    if (account === undefined) throw new Error('no echo account');
    const worker = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'Worker' });
    const link = (url: string, head: string, headRepository: string) => ({
      url, repository: url.split('/').slice(3, 5).join('/'), number: Number(url.split('/').pop()), title: 'work', state: 'OPEN', draft: false,
      head, base: 'main', headRepository, checkedAt: Date.now(),
    });
    const worktrees = Object.fromEntries(['unrelated', 'forked', 'unnamed'].map((slug) => {
      const path = join(worktreeRoot(project.path), slug);
      git(project.path, 'worktree', 'add', '-q', '-b', `boite/${slug}`, path);
      ageGitFiles(path);
      return [slug, path];
    }));
    harness.core.journal.setSetting(`linked-pull-requests:${worker.id}`, [
      // Another repository's branch of the same name claims nothing here.
      link('https://github.com/other/unrelated/pull/1', 'boite/unrelated', 'other/unrelated'),
      // A pull request from the project's fork, and one whose head repository GitHub no longer names.
      link('https://github.com/example/repo/pull/2', 'boite/forked', 'me/repo'),
      link('https://github.com/example/repo/pull/3', 'boite/unnamed', ''),
    ]);
    const hourly = new WorktreeCleanup(harness.core, { graceMs: 3_600_000, startDelayMs: 3_600_000 });
    expect((await hourly.run()).map((entry) => entry.branch)).toEqual(['boite/unrelated']);
    await hourly.close();
    expect(existsSync(worktrees.unrelated!)).toBe(false);
    expect(existsSync(worktrees.forked!)).toBe(true);
    expect(existsSync(worktrees.unnamed!)).toBe(true);
  });

  test('the project policy is on by default, owner only, and refuses anything but a boolean', async () => {
    const project = await repoProject();
    expect((await client.call('projects.list', {})).find((entry) => entry.id === project.id)?.autoRemoveWorktrees).toBe(true);
    expect((await rejection(client.call('projects.setAutoRemoveWorktrees', { projectId: project.id, enabled: 'no' as unknown as boolean }))).reason).toMatchObject({
      rpc: { data: expect.objectContaining({ field: 'enabled' }) },
    });
    expect((await client.call('projects.setAutoRemoveWorktrees', { projectId: project.id, enabled: true })).autoRemoveWorktrees).toBe(true);
    for (const principal of ['session', 'agent'] as const) {
      expect(() => assertAllowed('projects.setAutoRemoveWorktrees', { identity: { principal, threadId: 'thr_fixture', sessionId: 'fixture' } } as never, { projectId: project.id, enabled: false })).toThrow();
    }
  });
});
