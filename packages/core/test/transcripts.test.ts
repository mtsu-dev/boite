import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { accessRefusal, TRANSCRIPT_PRESETS, transcriptPolicy } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { claudeProjectFolder } from '../src/imports/claude.ts';
import { FAILED_OUTPUT_CAP, OUTPUT_CAP, sha256, type TranscriptRecord } from '../src/transcripts/records.ts';
import { scanSessions } from '../src/transcripts/locate.ts';
import { compactSession, readArchive } from '../src/transcripts/session.ts';
import { TranscriptStore } from '../src/transcripts/store.ts';
import { claudeSessionFixture, FIXTURE_SESSION_ID } from './fixtures/claude-session.ts';
import { startTestCore, testProject } from './harness.ts';
import { rejection } from './settle.ts';
import type { TestCore } from './harness.ts';

const DAY = 86_400_000;
/** A real 1x1 PNG: the blob store reads its header. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let scratch: string;
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'boite-transcripts-')); });
afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

async function records(path: string): Promise<TranscriptRecord[]> {
  const out: TranscriptRecord[] = [];
  await readArchive(path, entry => { out.push(entry); });
  return out;
}

const jsonl = (lines: unknown[]): string => `${lines.map(line => JSON.stringify(line)).join('\n')}\n`;

test('a Claude session keeps every message, reasoning, tool input and error, and shrinks only outputs, copies and images', async () => {
  const input = { command: `printf '${'x'.repeat(100_000)}'` };
  const long = `${'ok line\n'.repeat(20_000)}error: disk quota exceeded on /dev/sda1\n${'ok line\n'.repeat(20_000)}the end`;
  const failed = `${'trace\n'.repeat(4000)}fatal: boom`;
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } };
  const base = { sessionId: 's1', cwd: '/work', version: '2.1.0', gitBranch: 'main' };
  const file = join(scratch, 's1.jsonl');
  writeFileSync(file, jsonl([
    { ...base, type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-09-10T08:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Look at this capture' }, image] } },
    { ...base, type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-10T08:00:02.000Z', message: { id: 'm1', model: 'claude-test', usage: { input_tokens: 12, output_tokens: 34 }, content: [{ type: 'thinking', thinking: 'The disk first.', signature: 'S'.repeat(500) }] } },
    { ...base, type: 'assistant', uuid: 'a2', parentUuid: 'a1', timestamp: '2026-09-10T08:00:03.000Z', message: { id: 'm1', model: 'claude-test', usage: { input_tokens: 12, output_tokens: 34 }, content: [{ type: 'text', text: 'I will check the disk.' }, { type: 'tool_use', id: 't1', name: 'Bash', input }] } },
    { ...base, type: 'user', uuid: 'u2', parentUuid: 'a2', timestamp: '2026-09-10T08:00:04.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: long }] }, toolUseResult: { stdout: long, interrupted: false } },
    { ...base, type: 'assistant', uuid: 'a3', parentUuid: 'u2', timestamp: '2026-09-10T08:00:05.000Z', message: { id: 'm2', model: 'claude-test', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/work/a.png' } }] } },
    { ...base, type: 'user', uuid: 'u3', parentUuid: 'a3', timestamp: '2026-09-10T08:00:06.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: failed }] }, toolUseResult: `Error: ${failed}` },
    // The same picture again, and the wire copy of a message the stream already holds.
    { ...base, type: 'user', uuid: 'u4', parentUuid: 'u3', timestamp: '2026-09-10T08:00:07.000Z', message: { role: 'user', content: [image] } },
    { type: 'api-request-blob', sessionId: 's1', message: { role: 'user', content: [{ type: 'text', text: 'Look at this capture' }] } },
  ]));
  const out = join(scratch, 'archive', 's1.jsonl.zst');
  const blobs = join(scratch, 'blobs');
  const result = await compactSession({ source: 'claude', files: [file], out, blobs, keepBlobs: true });
  const stream = await records(out);

  expect(stream.filter(entry => entry.k === 'user').map(entry => entry.text ?? null)).toEqual(['Look at this capture', null, null]);
  expect(stream.find(entry => entry.k === 'reasoning')).toMatchObject({ text: 'The disk first.', t: '2026-09-10T08:00:02.000Z' });
  expect(stream.find(entry => entry.k === 'assistant')?.text).toBe('I will check the disk.');
  // A tool input is never cut, whatever its size.
  expect(stream.find(entry => entry.k === 'call' && entry.call === 't1')?.input).toEqual(input);
  // A long output keeps its head, its tail and the error line of its middle, with what the original was.
  const cut = stream.find(entry => entry.k === 'result' && entry.call === 't1')!.out as { head: string; tail: string; errors: string[]; bytes: number; sha256: string };
  expect(cut.head.startsWith('ok line\n')).toBe(true);
  expect(cut.tail.endsWith('the end')).toBe(true);
  expect(cut.errors).toEqual(['error: disk quota exceeded on /dev/sda1']);
  expect(cut.bytes).toBe(Buffer.byteLength(long));
  expect(cut.sha256).toBe(sha256(long));
  expect(cut.head.length + cut.tail.length).toBeLessThanOrEqual(OUTPUT_CAP);
  // A failed tool under its own, larger cap stays whole.
  expect(Buffer.byteLength(failed)).toBeLessThan(FAILED_OUTPUT_CAP);
  expect(stream.find(entry => entry.k === 'result' && entry.call === 't2')).toMatchObject({ out: failed, error: true });
  expect(result.failures).toEqual([expect.objectContaining({ kind: 'tool', tool: 'Read', at: Date.parse('2026-09-10T08:00:06.000Z') })]);
  // One response written over two lines says its usage once.
  expect(stream.filter(entry => entry.k === 'usage' && entry.in === 12)).toHaveLength(1);
  expect(stream.some(entry => entry.k === 'wire')).toBe(false);
  // The order and the times are the provider's.
  const times = stream.flatMap(entry => typeof entry.t === 'string' ? [entry.t] : []);
  expect(times).toEqual([...times].sort());
  // The picture is stored once for its two uses.
  expect(result.blobs).toHaveLength(1);
  const blob = result.blobs[0]!;
  expect(readdirSync(join(blobs, blob.sha256.slice(0, 2)))).toEqual([`${blob.sha256}.${blob.ext}`]);
  expect(JSON.stringify(stream)).not.toContain(PNG);
  expect(stream.filter(entry => JSON.stringify(entry).includes(blob.sha256))).toHaveLength(2);
  expect(result.records).toBe(stream.length);
  expect(result.bytes).toBeLessThan(result.rawBytes / 10);
});

test('a Codex rollout keeps its messages, calls and failed commands under the same kinds', async () => {
  const file = join(scratch, 'rollout-2026-09-10T08-00-00-0f3a9c2e-1111-4bbb-8ccc-0123456789ab.jsonl');
  writeFileSync(file, jsonl([
    { timestamp: '2026-09-10T08:00:00.000Z', type: 'session_meta', payload: { id: '0f3a9c2e-1111-4bbb-8ccc-0123456789ab', cwd: '/work', model: 'gpt-test' } },
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the tests' }] } },
    { timestamp: '2026-09-10T08:00:02.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Start with the suite.' }], encrypted_content: 'E'.repeat(4000) } },
    { timestamp: '2026-09-10T08:00:03.000Z', type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{"command":["bun","test"]}' } },
    { timestamp: '2026-09-10T08:00:04.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'Exit code: 1\n3 tests failed' } },
    { timestamp: '2026-09-10T08:00:05.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Three tests fail.' }] } },
  ]));
  const out = join(scratch, 'codex.jsonl.zst');
  const result = await compactSession({ source: 'codex', files: [file], out, blobs: join(scratch, 'blobs'), keepBlobs: true });
  const stream = await records(out);
  expect(stream.find(entry => entry.k === 'user')?.text).toBe('Run the tests');
  expect(stream.find(entry => entry.k === 'assistant')?.text).toBe('Three tests fail.');
  expect(JSON.stringify(stream.find(entry => entry.k === 'reasoning'))).toContain('Start with the suite.');
  expect(JSON.stringify(stream)).not.toContain('EEEE');
  expect(stream.find(entry => entry.k === 'call')).toMatchObject({ call: 'c1', tool: 'shell' });
  expect(result.failures).toEqual([expect.objectContaining({ kind: 'tool', tool: 'shell', text: 'Exit code: 1\n3 tests failed' })]);
  expect(result.models).toEqual(['gpt-test']);
});

test('a tool input that only starts like base64 stays whole, and the delay on images leaves a PDF stored', async () => {
  const lookalike = `${'Ab1+'.repeat(600)} and then plain words`;
  const encoded = Buffer.from('x'.repeat(3000)).toString('base64');
  const pdf = Buffer.from(`%PDF-1.7\n${'page '.repeat(400)}`).toString('base64');
  const file = join(scratch, 's1.jsonl');
  writeFileSync(file, jsonl([
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T08:00:00.000Z', message: { role: 'user', content: [
      { type: 'text', text: 'Read this' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
    ] } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-09-10T08:00:01.000Z', message: { id: 'm1', role: 'assistant', content: [
      { type: 'tool_use', id: 'c1', name: 'Write', input: { file_path: '/work/key.txt', content: lookalike, key: encoded } },
    ] } },
  ]));
  const out = join(scratch, 's1.jsonl.zst');
  const blobs = join(scratch, 'blobs');
  // Images already due to go: their bytes are not stored, a document's are.
  const result = await compactSession({ source: 'claude', files: [file], out, blobs, keepBlobs: false });
  const call = (await records(out)).find(entry => entry.k === 'call')!;
  expect(call.input).toEqual({ file_path: '/work/key.txt', content: lookalike, key: encoded });
  const stored = readdirSync(blobs, { recursive: true }).map(String).filter(name => name.includes('.'));
  expect(stored.map(name => name.split('.').pop())).toEqual(['pdf']);
  expect(result.blobs.map(blob => [blob.mime, blob.stored > 0]).sort()).toEqual([['application/pdf', true], ['image/png', false]]);
});

test('a Codex event keeps the image its message did not carry, and an old wrapped output keeps its exit code', async () => {
  const picture = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(2000, 7)]).toString('base64')}`;
  const file = join(scratch, 'rollout-2026-09-10T08-00-00-0f3a9c2e-1111-4bbb-8ccc-0123456789ab.jsonl');
  writeFileSync(file, jsonl([
    { timestamp: '2026-09-10T08:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What is on this picture?' }] } },
    { timestamp: '2026-09-10T08:00:01.100Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', id: 'i1', content: [{ type: 'text', text: 'What is on this picture?' }, { type: 'image', image_url: picture }] } } },
    { timestamp: '2026-09-10T08:00:03.000Z', type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{"command":["make"]}' } },
    { timestamp: '2026-09-10T08:00:04.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: `${'compiling\n'.repeat(5000)}make: *** [all] Error 9`, metadata: { exit_code: 9, duration_seconds: 4.2 } }) } },
  ]));
  const out = join(scratch, 'codex.jsonl.zst');
  const result = await compactSession({ source: 'codex', files: [file], out, blobs: join(scratch, 'blobs'), keepBlobs: true });
  const stream = await records(out);
  const item = stream.find(entry => entry.k === 'item')!;
  expect(item.content).toEqual([{ type: 'image', image_url: expect.objectContaining({ mime: 'image/png' }) }]);
  expect(result.blobs).toHaveLength(1);
  expect(stream.find(entry => entry.k === 'result')).toMatchObject({ call: 'c1', exit: 9, error: true, info: { exit_code: 9 } });
  expect(result.failures).toEqual([expect.objectContaining({ kind: 'tool', tool: 'shell' })]);
});

test('a Codex subagent is read with the session that spawned it, and a linked folder is not scanned', async () => {
  const parent = '0f3a9c2e-1111-4bbb-8ccc-0123456789ab';
  const child = '0f3a9c2e-2222-4bbb-8ccc-0123456789ab';
  const day = join(scratch, 'codex', 'sessions', '2026', '09', '10');
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, `rollout-2026-09-10T08-00-00-${child}.jsonl`), jsonl([{ type: 'session_meta', payload: { id: child, source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } }]));
  writeFileSync(join(day, `rollout-2026-09-10T09-00-00-${parent}.jsonl`), jsonl([{ type: 'session_meta', payload: { id: parent, source: 'cli' } }]));
  const found = await scanSessions(join(scratch, 'codex'), 'codex', true);
  expect([...found.keys()]).toEqual([parent]);
  expect(found.get(parent)!.files.map(path => path.includes(parent))).toEqual([true, false]);

  const outside = join(scratch, 'outside', 'folder');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, `${parent}.jsonl`), claudeSessionFixture('/elsewhere', { sessionId: parent }));
  mkdirSync(join(scratch, 'claude'));
  symlinkSync(join(scratch, 'outside'), join(scratch, 'claude', 'projects'));
  expect((await scanSessions(join(scratch, 'claude'), 'claude', true)).size).toBe(0);
});

test('an archive that is gone is an error the caller gets, and reading the index leaves no file beside it', async () => {
  expect(String((await rejection(records(join(scratch, 'gone.jsonl.zst')))).reason)).toContain('ENOENT');
  const writer = new TranscriptStore(scratch);
  writer.putThread({ id: 't1', title: 'One', projectPath: null, provider: null, model: null, createdAt: null, updatedAt: null, deletedAt: 1 }, 2);
  writer.close();
  const reader = new TranscriptStore(scratch);
  expect(reader.deleted()).toEqual([{ id: 't1', deletedAt: 1, imagesErasedAt: null }]);
  expect(reader.totalBytes()).toBe(0);
  expect(readdirSync(join(scratch, 'transcripts'))).toEqual(['index.db']);
  reader.close();
});

test('a measure writes nothing', async () => {
  const file = join(scratch, 's1.jsonl');
  writeFileSync(file, claudeSessionFixture('/work'));
  const result = await compactSession({ source: 'claude', files: [file], out: null, blobs: null, keepBlobs: true });
  expect(result.records).toBeGreaterThan(3);
  expect(result.bytes).toBeGreaterThan(0);
  expect(readdirSync(scratch)).toEqual(['s1.jsonl']);
});

test('a preset never compacts an open conversation except Storage, and Custom starts as the old deletion delay', () => {
  expect(TRANSCRIPT_PRESETS.delete.idleCompactDays).toBeNull();
  expect(TRANSCRIPT_PRESETS.classic).toEqual({ idleCompactDays: null, deletedCompactDays: 7, deletedEraseDays: null, imagesEraseDays: 30 });
  expect(TRANSCRIPT_PRESETS.storage.deletedEraseDays).toBeNull();
  expect(transcriptPolicy(undefined, 30)).toEqual({ idleCompactDays: null, deletedCompactDays: null, deletedEraseDays: 30, imagesEraseDays: null });
  expect(transcriptPolicy({ mode: 'custom' }, 0).deletedEraseDays).toBeNull();
});

test('an agent reads the archive from its own thread and decides nothing about it', () => {
  const agent = { principal: 'agent' as const, threadId: 'thr_1' };
  expect(accessRefusal('transcripts.read', agent, { threadId: 'thr_1', conversation: 'thr_2' })).toBeNull();
  expect(accessRefusal('transcripts.list', agent, { threadId: 'thr_1' })).toBeNull();
  expect(accessRefusal('transcripts.failures', agent, { threadId: 'thr_1' })).toBeNull();
  expect(accessRefusal('transcripts.preview', agent, { threadId: 'thr_1' })).not.toBeNull();
  expect(accessRefusal('transcripts.compactUnlinked', agent, { threadId: 'thr_1', days: 0 })).not.toBeNull();
});

// -- the pass, on a core -------------------------------------------------------

let harness: TestCore;
let client: CoreClient;

async function core(): Promise<void> {
  harness = await startTestCore();
  client = await harness.connect();
}

afterEach(async () => {
  await client?.close();
  await harness?.stop();
});

/** A thread imported from a Claude session filed in an isolated account, with one turn's usage. */
async function importedThread(): Promise<{ threadId: string; file: string; side: string }> {
  const project = await testProject(harness, client);
  const account = await client.call('accounts.add', { providerId: 'claude', label: 'isolated' });
  if (account.isolationDir === null) throw new Error('the account must be isolated');
  const folder = join(account.isolationDir, 'projects', claudeProjectFolder(project.path));
  mkdirSync(join(folder, FIXTURE_SESSION_ID, 'subagents'), { recursive: true });
  const file = join(folder, `${FIXTURE_SESSION_ID}.jsonl`);
  writeFileSync(file, claudeSessionFixture(project.path));
  writeFileSync(join(folder, FIXTURE_SESSION_ID, 'subagents', 'agent-1.jsonl'), jsonl([{ type: 'user', isSidechain: true, agentId: 'a1', timestamp: '2026-09-10T08:00:09.000Z', message: { role: 'user', content: 'Count the files' } }]));
  const summary = await client.call('imports.run', { projectId: project.id, accountId: account.id, sessionId: FIXTURE_SESSION_ID });
  harness.core.journal.db.query('UPDATE turns SET usage = ?, finished_at = ? WHERE thread_id = ?').run(JSON.stringify({ inputTokens: 120, outputTokens: 45 }), Date.now() - 40 * DAY, summary.id);
  return { threadId: summary.id, file, side: join(folder, FIXTURE_SESSION_ID) };
}

function age(threadId: string, file: string, days: number): void {
  const at = Date.now() - days * DAY;
  harness.core.journal.db.query('UPDATE threads SET updated_at = ? WHERE id = ?').run(at, threadId);
  harness.core.journal.db.query('UPDATE thread_deletions SET deleted_at = ? WHERE root_id = ?').run(at, threadId);
  utimesSync(file, at / 1000, at / 1000);
  utimesSync(join(file.slice(0, -'.jsonl'.length), 'subagents', 'agent-1.jsonl'), at / 1000, at / 1000);
}

function index(): Database {
  return new Database(join(harness.dataDir, 'transcripts', 'index.db'), { readonly: true });
}

test('with no mode picked nothing is compacted, whatever the age', async () => {
  await core();
  const { threadId, file } = await importedThread();
  age(threadId, file, 400);
  expect(harness.core.transcripts.policy()).toBeNull();
  await harness.core.transcripts.run();
  expect(existsSync(file)).toBe(true);
  expect(existsSync(join(harness.dataDir, 'transcripts'))).toBe(false);
  expect(harness.core.journal.getThread(threadId)).not.toBeNull();
});

test('a preview says what a mode would take and changes nothing', async () => {
  await core();
  const { threadId, file } = await importedThread();
  age(threadId, file, 40);
  const preview = await client.call('transcripts.preview', { policy: TRANSCRIPT_PRESETS.storage });
  expect(preview.compact.threads).toBe(1);
  expect(preview.compact.bytes).toBeGreaterThan(0);
  expect(preview.erase).toEqual({ threads: 0, bytes: 0 });
  expect(preview.keptRatio).toBeGreaterThan(0);
  expect(preview.freedBytes).toBe(Math.round(preview.compact.bytes * (1 - preview.keptRatio!)));
  expect(preview.totalBytes).toBe(preview.compact.bytes);
  // Classic leaves an open conversation alone.
  expect((await client.call('transcripts.preview', { policy: TRANSCRIPT_PRESETS.classic })).compact.threads).toBe(0);
  expect(existsSync(file)).toBe(true);
  expect(existsSync(join(harness.dataDir, 'transcripts'))).toBe(false);
});

test('Storage archives an idle conversation and removes its provider files; the app keeps it whole', async () => {
  await core();
  const { threadId, file, side } = await importedThread();
  const messages = harness.core.journal.db.query('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?').get(threadId) as { count: number };
  await client.call('settings.set', { transcriptStorage: { mode: 'storage' } });
  // Written to yesterday: not idle yet.
  await harness.core.transcripts.run();
  expect(existsSync(file)).toBe(true);

  age(threadId, file, 31);
  await harness.core.transcripts.run();
  expect(harness.core.transcripts.progress().lastError).toBeNull();
  expect(existsSync(file)).toBe(false);
  expect(existsSync(side)).toBe(false);
  expect(harness.core.journal.getThread(threadId)).not.toBeNull();
  expect(harness.core.journal.db.query('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?').get(threadId)).toEqual(messages);

  const [listed] = await client.call('transcripts.list', {});
  expect(listed).toMatchObject({ threadId, deletedAt: null, sessions: 1 });
  const page = await client.call('transcripts.read', { conversation: threadId, kinds: ['user'] });
  expect(page.sessionId).toBe(FIXTURE_SESSION_ID);
  expect(page.records.map(item => item.record.text)).toContain('List the files of this folder, then say hello');
  // The subagent's file is part of the session.
  expect(page.records.map(item => item.record.text)).toContain('Count the files');
  expect(page.next).toBeNull();
});

test('Classic compacts a deleted conversation after 7 days, keeps its usage, and Delete erases it later', async () => {
  await core();
  const { threadId, file, side } = await importedThread();
  await client.call('settings.set', { transcriptStorage: { mode: 'classic' } });
  await client.call('threads.remove', { threadId });
  age(threadId, file, 3);
  await harness.core.transcripts.run();
  // Three days in: still in the bin, restorable, untouched.
  expect(existsSync(file)).toBe(true);
  expect((await client.call('threads.deleted', {})).map(thread => thread.id)).toEqual([threadId]);

  age(threadId, file, 8);
  await harness.core.transcripts.run();
  expect(harness.core.transcripts.progress().lastError).toBeNull();
  expect(harness.core.journal.getThread(threadId)).toBeNull();
  expect(await client.call('threads.deleted', {})).toEqual([]);
  expect(existsSync(file)).toBe(false);
  expect(existsSync(side)).toBe(false);

  const [listed] = await client.call('transcripts.list', {});
  expect(listed).toMatchObject({ threadId, sessions: 2 });
  expect(listed!.deletedAt).not.toBeNull();
  const journal = await client.call('transcripts.read', { conversation: threadId, sessionId: 'journal' });
  expect(journal.sessions.sort()).toEqual([FIXTURE_SESSION_ID, 'journal'].sort());
  expect(journal.records.some(item => item.record.k === 'turn' && JSON.stringify(item.record.usage) === JSON.stringify({ inputTokens: 120, outputTokens: 45 }))).toBe(true);
  expect(journal.records.some(item => item.record.k === 'user' && item.record.text === 'List the files of this folder, then say hello')).toBe(true);
  const raw = await client.call('transcripts.read', { conversation: threadId, sessionId: FIXTURE_SESSION_ID, kinds: ['call'] });
  expect(raw.records[0]!.record).toMatchObject({ tool: 'Bash', input: { command: 'ls' } });
  // The usage page still counts its turns.
  expect((harness.core.journal.db.query('SELECT COUNT(*) AS count FROM removed_turn_usage').get() as { count: number }).count).toBeGreaterThan(0);

  // A second pass finds nothing left to do.
  await harness.core.transcripts.run();
  expect(harness.core.transcripts.progress()).toMatchObject({ compacted: 0, erased: 0, lastError: null });

  // Delete mode erases what is compacted 7 days after the deletion; the turns stay in the index.
  await client.call('settings.set', { transcriptStorage: { mode: 'delete' } });
  await harness.core.transcripts.run();
  expect(await client.call('transcripts.list', {})).toEqual([]);
  expect((await client.call('transcripts.read', { conversation: threadId })).records).toEqual([]);
  expect(readdirSync(join(harness.dataDir, 'transcripts', 'sessions'))).toEqual([]);
  const db = index();
  try {
    const turns = db.query('SELECT usage FROM turns WHERE thread_id = ?').all(threadId) as { usage: string | null }[];
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every(turn => turn.usage === JSON.stringify({ inputTokens: 120, outputTokens: 45 }))).toBe(true);
    expect((db.query('SELECT erased_at FROM threads WHERE id = ?').get(threadId) as { erased_at: number | null }).erased_at).not.toBeNull();
  } finally { db.close(); }
});

test('a restored conversation is not compacted, and a session another thread names keeps its files', async () => {
  await core();
  const { threadId, file } = await importedThread();
  await client.call('settings.set', { transcriptStorage: { mode: 'delete' } });
  await client.call('threads.remove', { threadId });
  await client.call('threads.restore', { threadId });
  await harness.core.transcripts.run();
  expect(harness.core.journal.getThread(threadId)).not.toBeNull();
  expect(existsSync(file)).toBe(true);
  expect(await client.call('transcripts.list', {})).toEqual([]);
});

test('sessions no thread names are archived on request only, and never erased', async () => {
  await core();
  const { threadId, file } = await importedThread();
  const stray = join(file, '..', '7c1d2e3f-2222-4aaa-8bbb-0123456789ab.jsonl');
  writeFileSync(stray, claudeSessionFixture('/elsewhere', { sessionId: '7c1d2e3f-2222-4aaa-8bbb-0123456789ab' }));
  utimesSync(stray, (Date.now() - 10 * DAY) / 1000, (Date.now() - 10 * DAY) / 1000);
  await client.call('settings.set', { transcriptStorage: { mode: 'delete' } });
  const preview = await client.call('transcripts.preview', { policy: TRANSCRIPT_PRESETS.delete });
  expect(preview.unlinked.sessions).toBe(1);
  await harness.core.transcripts.run();
  expect(existsSync(stray)).toBe(true);

  await client.call('transcripts.compactUnlinked', { days: 7 });
  await harness.core.transcripts.run();
  expect(existsSync(stray)).toBe(false);
  expect(existsSync(file)).toBe(true);
  expect(harness.core.journal.getThread(threadId)).not.toBeNull();
  const listed = await client.call('transcripts.list', {});
  expect(listed.map(item => item.threadId)).toEqual(['session:7c1d2e3f-2222-4aaa-8bbb-0123456789ab']);
  // Nothing of a mode erases it: it is no deleted conversation.
  await harness.core.transcripts.run();
  expect((await client.call('transcripts.list', {})).length).toBe(1);
});

test('a file the archive does not read stays in its folder, and a session written during the pass keeps the family in the journal', async () => {
  await core();
  const { threadId, file, side } = await importedThread();
  writeFileSync(join(side, 'notes.txt'), 'kept by hand');
  await client.call('settings.set', { transcriptStorage: { mode: 'classic' } });
  await client.call('threads.remove', { threadId });
  age(threadId, file, 8);

  // An import reads the session: nothing of the family is archived or purged.
  const busy = harness.core.imports.busy.bind(harness.core.imports);
  harness.core.imports.busy = () => true;
  await harness.core.transcripts.run();
  harness.core.imports.busy = busy;
  expect((await client.call('threads.deleted', {})).map(thread => thread.id)).toEqual([threadId]);
  expect(existsSync(file)).toBe(true);

  // Written after the scan, as the pass first looks at the session: the same.
  let written = false;
  harness.core.imports.busy = () => {
    if (!written) appendFileSync(file, jsonl([{ type: 'user', uuid: 'late', timestamp: '2026-09-10T09:00:00.000Z', message: { role: 'user', content: 'One more thing' } }]));
    written = true;
    return false;
  };
  await harness.core.transcripts.run();
  harness.core.imports.busy = busy;
  expect(written).toBe(true);
  expect((await client.call('threads.deleted', {})).map(thread => thread.id)).toEqual([threadId]);
  expect(existsSync(file)).toBe(true);

  age(threadId, file, 8);
  await harness.core.transcripts.run();
  expect(await client.call('threads.deleted', {})).toEqual([]);
  expect(existsSync(file)).toBe(false);
  expect(readdirSync(side)).toEqual(['notes.txt']);
  const late = await client.call('transcripts.read', { conversation: threadId, sessionId: FIXTURE_SESSION_ID, query: 'One more thing' });
  expect(late.records).toHaveLength(1);
});

test('a pass planned for Delete stops erasing once another mode is applied', async () => {
  await core();
  const project = await testProject(harness, client);
  const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
  for (const title of ['First', 'Second']) {
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title });
    await client.call('threads.remove', { threadId: thread.id });
  }
  harness.core.journal.db.query('UPDATE thread_deletions SET deleted_at = ?').run(Date.now() - 8 * DAY);
  harness.core.settings.set({ transcriptStorage: { mode: 'delete' } });
  const off = harness.core.bus.onAny(name => {
    if (name === 'thread.removed' && harness.core.settings.get().transcriptStorage?.mode === 'delete') harness.core.settings.set({ transcriptStorage: { mode: 'storage' } });
  });
  await harness.core.transcripts.run();
  off();
  await harness.core.transcripts.run();
  expect(await client.call('threads.deleted', {})).toHaveLength(1);
});
