import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcErrorCode, type Message } from '@boite/contracts';
import { Journal } from '../src/journal.ts';
import { createMessageSearch, refreshStreamMessageSearch, searchThreadMessages } from '../src/journal/message-search.ts';
import { copyStoredParts } from '../src/journal/stream-buffer.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let core: TestCore | undefined;
afterEach(async () => { await core?.stop(); core = undefined; });

function message(id: string, threadId: string, text: string, createdAt = 1): Message {
  return { id, threadId, turnId: 'search-turn', role: 'user', state: 'complete', createdAt, parts: [{ type: 'text', text }] };
}

test('schema 54 indexes old visible messages and tracks replacements, streamed text and rewind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boite-search-'));
  const file = join(dir, 'journal.db');
  let journal = new Journal(file);
  try {
    journal.db.exec(`
      DROP TRIGGER message_search_insert;
      DROP TRIGGER message_search_update; DROP TRIGGER message_search_delete;
      DROP TABLE IF EXISTS messages_fts_infix; DROP TABLE messages_fts; DROP TABLE message_search_keys;
      PRAGMA user_version = 53;
    `);
    journal.db.exec(`
      INSERT INTO threads (id, title, provider_id, account_id, cwd, permission_mode, status, unread, archived, created_at, updated_at, incognito)
        VALUES ('visible', 'Visible', 'echo', 'echo', '.', 'default', 'idle', 0, 0, 1, 1, 0),
               ('private', 'Private', 'echo', 'echo', '.', 'default', 'idle', 0, 0, 1, 1, 1)
    `);
    journal.putMessage(message('old', 'visible', 'Réparer le panneau'));
    journal.putMessage(message('incognito', 'private', 'Réparer le panneau'));
    journal.close();
    journal = new Journal(file);
    const search = (query: string) => searchThreadMessages(journal.db, query).map(hit => hit.messageId);
    expect(journal.schema).toEqual({ from: 53, to: 54 });
    expect(search('reparer panneau')).toEqual(['old']);
    expect(search('"réparer le panneau"')).toEqual(['old']);
    expect(search('"réparer panneau"')).toEqual([]);
    expect(search('pann')).toEqual(['old']);
    if (journal.db.query("SELECT 1 FROM sqlite_schema WHERE name = 'messages_fts_infix'").get() !== null) {
      expect(search('anne')).toEqual(['old']);
      expect(search('"réparer le" anne')).toEqual(['old']);
    }
    expect(search('---')).toEqual([]);

    journal.db.exec('VACUUM');
    journal.putMessage(message('old', 'visible', 'Original text replaced'));
    expect(search('panneau')).toEqual([]);
    expect(search('replace')).toEqual(['old']);
    journal.putMessage({ ...message('live', 'visible', 'Writing an '), role: 'assistant', state: 'streaming' });
    journal.stream.setMessagePart('live', 0, { type: 'text', text: 'Writing an updated sentence' });
    journal.persistMessages();
    expect(journal.db.query("SELECT json FROM streaming_parts WHERE message_id = 'live'").get()).not.toBeNull();
    expect(search('updated sentence')).toEqual(['live']);
    journal.stream.setMessageState('live', 'complete');
    expect(search('updated sentence')).toEqual(['live']);
    const live = journal.db.query<{ rowid: number }, []>("SELECT rowid FROM messages WHERE id = 'live'").get()!;
    journal.truncateMessages('visible', live.rowid);
    expect(search('updated sentence')).toEqual([]);
    journal.putMessage({ ...message('revised', 'visible', 'Writing an '), role: 'assistant', state: 'streaming' });
    journal.stream.setMessagePart('revised', 0, { type: 'text', text: 'Writing an updated sentence' });
    journal.persistMessages();
    expect(search('updated sentence')).toEqual(['revised']);
    journal.stream.setMessagePart('revised', 0, { type: 'text', text: 'Writing an ' });
    journal.stream.setMessageState('revised', 'complete');
    expect(search('updated sentence')).toEqual([]);
    expect(search('original')).toEqual(['old']);

    // A streaming message whose earlier text part lives only in messages.parts stays searchable
    // when a later part index is flushed to streaming_parts, and copies preserve both parts.
    journal.db.query("INSERT INTO threads (id, title, provider_id, account_id, cwd, permission_mode, status, unread, archived, created_at, updated_at, incognito) VALUES ('visible-copy', 'Copy', 'echo', 'echo', '.', 'default', 'idle', 0, 0, 1, 1, 0)").run();
    journal.putMessage({ ...message('multi', 'visible', 'xylophonist baseline'), role: 'assistant', state: 'streaming' });
    journal.stream.setMessagePart('multi', 1, { type: 'text', text: 'marimba continuation' });
    journal.persistMessages();
    expect(search('xylophonist')).toEqual(['multi']);
    expect(search('marimba')).toEqual(['multi']);
    expect(search('xylophonist marimba')).toEqual(['multi']);
    journal.putMessage({ ...message('multi-copy', 'visible-copy', 'xylophonist baseline'), role: 'assistant', state: 'streaming' });
    copyStoredParts(journal.db, 'multi', { id: 'multi-copy', threadId: 'visible-copy' });
    expect(search('xylophonist marimba').sort()).toEqual(['multi', 'multi-copy']);
  } finally {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('threads.search ranks the best message per thread and respects archive and removal through the RPC', async () => {
  core = await startTestCore();
  const client = await core.connect();
  const { threadId: first } = await echoThread(core, client, 'First');
  const { threadId: second } = await echoThread(core, client, 'Second');
  const { threadId: third } = await echoThread(core, client, 'Third');
  const journal = core.core.journal;
  journal.putMessage(message('first', first, 'Opus Arasoft is the rollout name'));
  journal.putMessage(message('first-later', first, 'Opus launched at Arasoft', 30));
  journal.putMessage(message('second', second, 'Arasoft uses Opus', 20));
  journal.putMessage(message('third', third, `Arasoft ${'separate '.repeat(12)} Opus`, 40));
  journal.putMessage(message('hex', third, 'ID 8392abcd135d'));
  const query = 'opus arasoft';
  const search = async (params: { limit?: number; includeArchived?: boolean } = {}) =>
    (await client.call('threads.search', { query, ...params })).matches.map(hit => hit.messageId);
  expect(await search()).toEqual(['first', 'second', 'third']);
  expect(await search({ limit: 1 })).toEqual(['first']);
  expect(await client.call('threads.search', { query: 'abcd' })).toEqual({ query: 'abcd', matches: [] });
  await client.call('threads.archive', { threadId: first, archived: true });
  expect(await search({ includeArchived: false })).toEqual(['second', 'third']);
  expect(await search()).toEqual(['first', 'second', 'third']);
  await client.call('threads.remove', { threadId: first });
  expect(await search()).toEqual(['second', 'third']);
  await client.call('threads.restore', { threadId: first });
  expect(await search()).toEqual(['first', 'second', 'third']);
  expect(await client.call('threads.search', { query, limit: 51 }).catch(error => error))
    .toMatchObject({ rpc: { code: RpcErrorCode.InvalidParams, data: { field: 'limit' } } });
});

test('threads.search keeps the newest equally relevant message and reserves room for other threads', async () => {
  core = await startTestCore();
  const client = await core.connect();
  const { threadId: busy } = await echoThread(core, client, 'Busy');
  const { threadId: quiet } = await echoThread(core, client, 'Quiet');
  const journal = core.core.journal;
  journal.db.transaction(() => {
    for (let index = 0; index < 200; index++) journal.putMessage(message(`busy-${index}`, busy, 'Opus', index + 1));
    journal.putMessage(message('quiet-hit', quiet, 'Opus', 1));
  })();

  const { matches } = await client.call('threads.search', { query: 'opus', limit: 2 });
  expect(matches.map(hit => [hit.threadId, hit.messageId])).toEqual([[busy, 'busy-199'], [quiet, 'quiet-hit']]);
});

test('a replacement message search releases the older reader on the same connection', async () => {
  core = await startTestCore();
  const client = await core.connect();
  const sent = new Map<string, SearchWorker>();
  class SearchWorker extends EventTarget {
    onmessage?: (event: MessageEvent) => void;
    postMessage({ params }: { params: { query: string } }) {
      sent.set(params.query, this);
      if (params.query === 'new') this.reply();
    }
    reply() { this.onmessage?.(new MessageEvent('message', { data: { hits: [] } })); }
    terminate() { this.dispatchEvent(new Event('close')); }
  }
  const original = globalThis.Worker;
  globalThis.Worker = SearchWorker as unknown as typeof Worker;
  const old = client.call('threads.search', { query: 'old', replacePending: true }).catch(error => error);
  try {
    await waitFor(() => sent.has('old'));
    const newest = client.call('threads.search', { query: 'new', replacePending: true });
    try {
      await waitFor(() => sent.has('new'), 1000);
      expect(await old).toMatchObject({ rpc: { code: RpcErrorCode.Unavailable } });
      expect(await newest).toEqual({ query: 'new', matches: [] });
    } finally {
      sent.get('old')?.reply();
      await newest.catch(() => undefined);
    }
  } finally {
    globalThis.Worker = original;
  }
});

test('threads.search keeps exact whole words ahead of many prefix hits and scans past hex false positives', async () => {
  core = await startTestCore();
  const client = await core.connect();
  const { threadId: exactThread } = await echoThread(core, client, 'Exact');
  const { threadId: prefixThread } = await echoThread(core, client, 'Prefix');
  const { threadId: infixThread } = await echoThread(core, client, 'Infix');
  const hexThreads: string[] = [];
  for (let index = 0; index < 85; index++) {
    hexThreads.push((await echoThread(core, client, `Hex ${index}`)).threadId);
  }
  const journal = core.core.journal;
  journal.db.transaction(() => {
    journal.putMessage(message('exact-planet', exactThread, 'Observe the planet today', 1));
    for (let index = 0; index < 200; index++) journal.putMessage(message(`prefix-${index}`, prefixThread, 'Many planets orbit suns', index + 10));
    for (let index = 0; index < hexThreads.length; index++) {
      journal.putMessage(message(`hex-${index}`, hexThreads[index]!, `deadbeefabcd${String(index).padStart(4, '0')}`, index + 100));
      if (index < 50) journal.putMessage(message(`pos1-${index}`, hexThreads[index]!, 'zephyr omega', index + 200));
    }
    journal.putMessage(message('pos2-phrase', hexThreads[0]!, 'detailed notes covering the exact omega zephyr phrase rollout checklist', 50));
    journal.putMessage(message('real-infix', infixThread, 'Check prefixabcdsuffix here', 1));
  })();

  const planet = await client.call('threads.search', { query: 'planet', limit: 2 });
  expect(planet.matches[0]).toMatchObject({ threadId: exactThread, messageId: 'exact-planet' });

  // Consecutive searches across >40 matching threads must still inspect position=2..4 candidates and leave no busy statements.
  const firstMany = await client.call('threads.search', { query: 'deadbeef', limit: 5 });
  const secondMany = await client.call('threads.search', { query: 'deadbeef', limit: 5 });
  expect(firstMany.matches).toHaveLength(5);
  expect(secondMany.matches).toHaveLength(5);
  const phrase = await client.call('threads.search', { query: 'omega zephyr', limit: 5 });
  expect(phrase.matches[0]).toMatchObject({ threadId: hexThreads[0], messageId: 'pos2-phrase' });

  if (journal.db.query("SELECT 1 FROM sqlite_schema WHERE name = 'messages_fts_infix'").get() !== null) {
    const infix = await client.call('threads.search', { query: 'abcd', limit: 5 });
    expect(infix.matches.map(hit => hit.messageId)).toEqual(['real-infix']);
    // Short word (< 4 chars) combined with >= 4-char infix term must match without joining two FTS5 MATCH tables.
    journal.putMessage(message('short-infix', infixThread, 'Check the prefixabcdsuffix log', 2));
    const combo = await client.call('threads.search', { query: 'the abcd', limit: 5 });
    expect(combo.matches.map(hit => hit.messageId)).toEqual(['short-infix']);
  }
  // Replacing a visible message with a system role removes its FTS rows and search key.
  journal.putMessage({ ...message('exact-planet', exactThread, 'System replacement', 99), role: 'system' });
  expect(journal.db.query("SELECT 1 FROM message_search_keys WHERE message_id = 'exact-planet'").get()).toBeNull();
});

test('createMessageSearch falls back cleanly when SQLite lacks contentless_delete or trigram options', () => {
  const runFallback = (rejectPlainTrigram: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'boite-search-fallback-'));
    const journal = new Journal(join(dir, 'journal.db'));
    try {
      journal.db.exec(`
        DROP TRIGGER message_search_insert;
        DROP TRIGGER message_search_update;
        DROP TRIGGER message_search_delete;
        DROP TABLE IF EXISTS messages_fts_infix;
        DROP TABLE messages_fts;
        DROP TABLE message_search_keys;
        INSERT INTO threads (id, title, provider_id, account_id, cwd, permission_mode, status, unread, archived, created_at, updated_at, incognito)
          VALUES ('t1', 'Legacy SQLite', 'echo', 'echo', '.', 'default', 'idle', 0, 0, 1, 1, 0);
      `);
      journal.putMessage(message('m1', 't1', 'PrefixAlphaSuffix baseline', 1));
      const realExec = journal.db.exec.bind(journal.db);
      journal.db.exec = ((sql: string) => {
        if (sql.includes('contentless_delete')) throw new Error('unrecognized option: "contentless_delete"');
        if (sql.includes('trigram remove_diacritics')) throw new Error('error in tokenizer constructor');
        if (rejectPlainTrigram && sql.includes("tokenize='trigram'")) throw new Error('no such tokenizer: trigram');
        return realExec(sql);
      }) as typeof journal.db.exec;
      try {
        journal.db.transaction(() => createMessageSearch(journal.db))();
      } finally {
        journal.db.exec = realExec;
      }
      const ftsSql = journal.db.query<{ sql: string }, []>("SELECT sql FROM sqlite_schema WHERE name = 'messages_fts'").get()?.sql ?? '';
      expect(ftsSql).not.toContain('contentless_delete');
      const infixRow = journal.db.query<{ sql: string }, []>("SELECT sql FROM sqlite_schema WHERE name = 'messages_fts_infix'").get();
      if (rejectPlainTrigram) {
        expect(infixRow).toBeNull();
      } else {
        expect(infixRow?.sql).toContain("tokenize='trigram'");
        expect(infixRow?.sql).not.toContain('contentless_delete');
        expect(searchThreadMessages(journal.db, 'alpha').map(hit => hit.messageId)).toEqual(['m1']);
      }
      expect(searchThreadMessages(journal.db, 'prefixalpha').map(hit => hit.messageId)).toEqual(['m1']);
      refreshStreamMessageSearch(journal.db, 'm1', 'UpdatedStreamToken');
      journal.db.query("UPDATE messages SET parts = ? WHERE id = 'm1'").run(JSON.stringify([{ type: 'text', text: 'UpdatedStreamToken' }]));
      expect(searchThreadMessages(journal.db, 'updatedstream').map(hit => hit.messageId)).toEqual(['m1']);
      journal.db.query("DELETE FROM messages WHERE id = 'm1'").run();
      expect(searchThreadMessages(journal.db, 'updatedstream')).toEqual([]);
      expect(journal.db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    } finally {
      journal.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  runFallback(false);
  runFallback(true);
});
