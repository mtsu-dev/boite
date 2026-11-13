import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import type { Account, MessagePart } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { claudeProjectFolder } from '../src/imports/claude.ts';
import { inspectJournal } from '../src/journal/integrity.ts';
import { claudeSessionFixture, FIXTURE_SESSION_ID } from './fixtures/claude-session.ts';
import { CODEX_FIXTURE_SESSION_ID, codexLegacySessionFixture, codexRolloutPath, codexSessionFixture } from './fixtures/codex-session.ts';
import { startTestCore, testProject } from './harness.ts';
import type { TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let harness: TestCore;

beforeEach(async () => {
  harness = await startTestCore();
});

afterEach(async () => {
  await harness.stop();
});

type Tool = Extract<MessagePart, { type: 'tool' }>;

/** An isolated Codex account whose home is empty. */
async function codexAccount(client: CoreClient): Promise<Account & { isolationDir: string }> {
  const account = await client.call('accounts.add', { providerId: 'codex', label: 'imports' });
  if (account.isolationDir === null) throw new Error('the account must be isolated');
  return account as Account & { isolationDir: string };
}

/** A rollout filed where the CLI would file it. */
function rollout(home: string, sessionId: string, body: string): string {
  const file = join(home, ...codexRolloutPath(sessionId));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  return file;
}

test('a rollout of the project folder is listed from its head, imported whole, and never twice', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const account = await codexAccount(client);
  const file = rollout(account.isolationDir, CODEX_FIXTURE_SESSION_ID, codexSessionFixture(project.path));
  // The same home holds every folder's sessions and the subagents': neither is this project's to import.
  rollout(account.isolationDir, 'other-folder', codexSessionFixture(join(project.path, 'elsewhere'), { sessionId: 'other-folder' }));
  rollout(account.isolationDir, 'sub-agent', codexSessionFixture(project.path, { sessionId: 'sub-agent', source: { subagent: { thread_spawn: { parent_thread_id: CODEX_FIXTURE_SESSION_ID } } } }));

  const listed = await client.call('imports.list', { projectId: project.id });
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({
    providerId: 'codex',
    accountId: account.id,
    accountIds: [account.id],
    sessionId: CODEX_FIXTURE_SESSION_ID,
    file,
    title: 'List the files of this folder, then say hello',
    startedAt: Date.parse('2026-09-10T08:00:01.000Z'),
    threadId: null,
  });
  expect(listed[0]!.bytes).toBeGreaterThan(0);

  const summary = await client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: CODEX_FIXTURE_SESSION_ID });
  expect(summary).toMatchObject({
    title: 'List the files of this folder, then say hello',
    titleSource: 'prompt',
    providerId: 'codex',
    // What the Codex driver hands `thread/resume` on the first new turn.
    sessionId: CODEX_FIXTURE_SESSION_ID,
    model: 'gpt-5.5-codex',
    status: 'idle',
    createdAt: Date.parse('2026-09-10T08:00:01.000Z'),
    updatedAt: Date.parse('2026-09-10T08:01:02.000Z'),
  });

  const thread = await client.call('threads.get', { threadId: summary.id });
  expect(thread.turns).toHaveLength(2);
  expect(thread.turns.every((turn) => turn.status === 'done')).toBe(true);
  expect(thread.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  // The injected context and the response_item copies never become prompts or parts.
  expect(thread.messages[0]!.parts).toEqual([{ type: 'text', text: 'List the files of this folder, then say hello' }]);
  expect(JSON.stringify(thread.messages)).not.toContain('environment_context');
  const answer = thread.messages[1]!;
  expect(answer.parts.map((part) => part.type)).toEqual(['thinking', 'tool', 'text', 'tool', 'tool', 'text']);
  expect(answer.parts[0]).toMatchObject({ type: 'thinking', text: 'A directory listing first.' });
  expect(answer.parts[1] as Tool).toMatchObject({
    toolId: 'c1', name: 'Bash', input: { command: 'ls', cwd: project.path }, output: 'README.md\npackage.json', status: 'done', exitCode: 0,
  });
  expect(answer.parts[2]).toEqual({ type: 'text', text: 'Two files.' });
  expect(answer.parts[3] as Tool).toMatchObject({
    name: 'ApplyPatch',
    status: 'done',
    input: { changes: [
      { path: 'notes.md', kind: { type: 'add' }, diff: 'hello\n' },
      { path: 'README.md', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new\n' },
    ] },
  });
  expect(answer.parts[4] as Tool).toMatchObject({ name: 'search', input: { query: 'hello' }, status: 'error' });
  expect((answer.parts[4] as Tool).output).toContain('no index');
  expect(answer.parts[5]).toEqual({ type: 'text', text: 'Hello.' });
  expect(thread.messages[3]!.parts).toEqual([{ type: 'text', text: 'Bye.' }]);
  expect(inspectJournal(harness.core.journal, { limit: 500 }).issues).toEqual([]);

  expect(await thrown(client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: CODEX_FIXTURE_SESSION_ID }))).toThrow(
    'already a thread',
  );
  const again = await client.call('imports.list', { projectId: project.id });
  expect(again.map((session) => session.threadId)).toEqual([summary.id]);
});

test('the name the Codex index gives a session wins over the prompt, its last line first', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const account = await codexAccount(client);
  rollout(account.isolationDir, CODEX_FIXTURE_SESSION_ID, codexSessionFixture(project.path));
  writeFileSync(join(account.isolationDir, 'session_index.jsonl'), [
    JSON.stringify({ id: CODEX_FIXTURE_SESSION_ID, thread_name: 'First name', updated_at: '2026-09-10T08:00:10Z' }),
    'not json',
    JSON.stringify({ id: CODEX_FIXTURE_SESSION_ID, thread_name: 'Folder listing', updated_at: '2026-09-10T08:02:00Z' }),
    '',
  ].join('\n'));

  expect((await client.call('imports.list', { projectId: project.id }))[0]!.title).toBe('Folder listing');
  const summary = await client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: CODEX_FIXTURE_SESSION_ID });
  expect(summary).toMatchObject({ title: 'Folder listing', titleSource: 'agent' });
});

test('a rollout of the older dialect imports its events, its calls, and closes the one never answered', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const account = await codexAccount(client);
  rollout(account.isolationDir, 'legacy-1', codexLegacySessionFixture(project.path, 'legacy-1'));

  const listed = await client.call('imports.list', { projectId: project.id });
  expect(listed.map((session) => [session.sessionId, session.title])).toEqual([['legacy-1', 'Count the files']]);
  const summary = await client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: 'legacy-1' });
  expect(summary).toMatchObject({ sessionId: 'legacy-1', model: 'gpt-5-codex' });
  const thread = await client.call('threads.get', { threadId: summary.id });
  expect(thread.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  const parts = thread.messages[1]!.parts;
  expect(parts.map((part) => part.type)).toEqual(['thinking', 'tool', 'tool', 'text']);
  expect(parts[1] as Tool).toMatchObject({ toolId: 'call_1', name: 'shell', input: { command: ['bash', '-lc', 'ls | wc -l'] }, status: 'done' });
  expect((parts[1] as Tool).output).toContain('2\\n');
  expect(parts[2] as Tool).toMatchObject({ toolId: 'call_2', status: 'error', output: 'no result in the transcript' });
  expect(parts[3]).toEqual({ type: 'text', text: 'Two files.' });
});

test('a rollout the parser does not understand is skipped with the file and the field on the log, once', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const account = await codexAccount(client);
  rollout(account.isolationDir, CODEX_FIXTURE_SESSION_ID, codexSessionFixture(project.path));
  const noType = rollout(account.isolationDir, 'no-type', `${JSON.stringify({ id: 'no-type', timestamp: '2025-01-01T00:00:00Z', instructions: null })}\n`);
  const noCwd = rollout(account.isolationDir, 'no-cwd', `${JSON.stringify({ timestamp: '2026-09-10T08:00:00.000Z', type: 'session_meta', payload: { id: 'no-cwd' } })}\n`);
  const garbage = rollout(account.isolationDir, 'garbage', '\u0000\u0001 not json at all\n{"type":');
  rollout(account.isolationDir, 'empty', '');

  const log = spyOn(harness.core, 'log');
  try {
    const listed = await client.call('imports.list', { projectId: project.id });
    expect(listed.map((session) => session.sessionId)).toEqual([CODEX_FIXTURE_SESSION_ID]);
    const warned = (): string[] => log.mock.calls.filter(([level, message]) => level === 'warn' && message.startsWith('import: ')).map(([, message]) => message);
    expect(warned().find((message) => message.includes(noType))).toContain('type, expected "session_meta" on line 1');
    expect(warned().find((message) => message.includes(noCwd))).toContain('payload.cwd, expected a working directory');
    expect(warned().find((message) => message.includes(garbage))).toContain('line 1, expected a JSON object');
    const count = warned().length;
    expect(count).toBe(4);

    // Unchanged files are not opened again, so the log does not repeat itself.
    await client.call('imports.list', { projectId: project.id });
    expect(warned()).toHaveLength(count);
  } finally {
    log.mockRestore();
  }

  expect(await thrown(client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: 'no-cwd' }))).toThrow('rollout payload.cwd');
});

test('an unchanged rollout is listed from memory, a changed one read again, and another folder\'s listing does not hide it', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const elsewhere = join(harness.dataDir, 'elsewhere');
  mkdirSync(elsewhere);
  const other = await client.call('projects.add', { path: elsewhere, name: 'elsewhere' });
  const account = await codexAccount(client);
  const file = rollout(account.isolationDir, CODEX_FIXTURE_SESSION_ID, codexSessionFixture(project.path, { prompt: 'First prompt' }));
  const mtime = new Date('2026-09-20T10:00:00.000Z');
  utimesSync(file, mtime, mtime);

  // The other folder's listing reads this file's first line only; this folder's then reads its prompt.
  expect(await client.call('imports.list', { projectId: other.id })).toEqual([]);
  expect((await client.call('imports.list', { projectId: project.id }))[0]!.title).toBe('First prompt');

  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('First prompt', 'Other prompt'));
  utimesSync(file, mtime, mtime);
  expect((await client.call('imports.list', { projectId: project.id }))[0]!.title).toBe('First prompt');

  utimesSync(file, mtime, new Date(mtime.getTime() + 5000));
  expect((await client.call('imports.list', { projectId: project.id }))[0]!.title).toBe('Other prompt');
});

test('refused by name: no rollout for the id, a rollout of another folder, one with no prompt', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const account = await codexAccount(client);
  rollout(account.isolationDir, 'other-folder', codexSessionFixture(join(project.path, 'elsewhere'), { sessionId: 'other-folder' }));
  rollout(account.isolationDir, 'no-prompt', codexSessionFixture(project.path, { sessionId: 'no-prompt' }).split('\n').slice(0, 2).join('\n'));

  expect(await thrown(client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: 'nope' }))).toThrow('no rollout for session nope under');
  expect(await thrown(client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: '../escape' }))).toThrow('letters, digits, dashes and underscores');
  expect(await thrown(client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: 'other-folder' }))).toThrow('transcript cwd: expected');
  expect(await thrown(client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: 'no-prompt' }))).toThrow('no prompt to import');
  expect(await client.call('imports.list', { projectId: project.id })).toEqual([]);
});

test('Claude and Codex sessions of one folder are listed together, each under its own provider', async () => {
  const client = await harness.connect();
  const project = await testProject(harness, client);
  const codex = await codexAccount(client);
  const claude = await client.call('accounts.add', { providerId: 'claude', label: 'imports' });
  const folder = join(claude.isolationDir!, 'projects', claudeProjectFolder(project.path));
  mkdirSync(folder, { recursive: true });
  const transcript = join(folder, `${FIXTURE_SESSION_ID}.jsonl`);
  writeFileSync(transcript, claudeSessionFixture(project.path));
  const older = new Date('2026-09-20T10:00:00.000Z');
  utimesSync(transcript, older, older);
  const file = rollout(codex.isolationDir, CODEX_FIXTURE_SESSION_ID, codexSessionFixture(project.path));
  utimesSync(file, older, new Date(older.getTime() + 60_000));

  const listed = await client.call('imports.list', { projectId: project.id });
  expect(listed.map((session) => [session.providerId, session.accountId, session.sessionId])).toEqual([
    ['codex', codex.id, CODEX_FIXTURE_SESSION_ID],
    ['claude', claude.id, FIXTURE_SESSION_ID],
  ]);
});
