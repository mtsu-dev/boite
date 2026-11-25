import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcErrorCode, type Message } from '@boite/contracts';
import { Journal } from '../src/journal.ts';
import { searchThreadMessages } from '../src/journal/message-search.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';

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
    expect(search('anne')).toEqual(['old']);
    expect(search('---')).toEqual([]);

    journal.db.exec('VACUUM');
    journal.putMessage(message('old', 'visible', 'Original text replaced'));
    expect(search('panneau')).toEqual([]);
    expect(search('replace')).toEqual(['old']);
    journal.putMessage({ ...message('live', 'visible', 'Writing an '), role: 'assistant', state: 'streaming' });
    journal.stream.setMessagePart('live', 0, { type: 'text', text: 'Writing an updated sentence' });
    journal.stream.setMessageState('live', 'complete');
    expect(search('updated sentence')).toEqual(['live']);
    const live = journal.db.query<{ rowid: number }, []>("SELECT rowid FROM messages WHERE id = 'live'").get()!;
    journal.truncateMessages('visible', live.rowid);
    expect(search('updated sentence')).toEqual([]);
    expect(search('original')).toEqual(['old']);
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
