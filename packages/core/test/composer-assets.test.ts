import { afterEach, expect, spyOn, test } from 'bun:test';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import type { ComposerAttachment, ComposerValue } from '@boite/contracts';
import { ComposerStorage } from '../src/composer-storage.ts';
import type { Connection } from '../src/router.ts';

let h: TestCore;
afterEach(async () => { await h?.stop(); });
const attachment = { kind: 'file' as const, mimeType: 'text/plain', name: 'notes.txt', data: 'aGVsbG8=' };
const value = (...attachments: ComposerAttachment[]): ComposerValue => ({ input: { text: '', attachments, queued: [], paused: false } });
const owner = (id: string): Connection => ({ id, subscriptions: new Set(), identity: { principal: 'owner', sessionId: null, threadId: null }, sendEvent() {}, close() {} });

test('large composer records and assets write through uncached statements', async () => {
  h = await startTestCore();
  const storage = h.core.composer.storage;
  const query = spyOn(h.core.journal.db, 'query');
  try {
    const large = { ...attachment, data: 'aGVs'.repeat(20_000) };
    const asset = storage.putAsset(large, false, owner('first'));
    const input = { ...value().input, text: 'a'.repeat(80_000), attachments: [{ kind: large.kind, name: large.name, mimeType: large.mimeType, ...asset }] };
    const saved = storage.save('drafts', 'large', { input });
    expect(storage.get('drafts', 'large')).toEqual(saved);
    expect(storage.readAsset(asset.assetId)).toEqual(large);
    expect(query.mock.calls.map(([sql]) => sql).filter(sql => /INSERT (?:OR IGNORE )?INTO composer_(?:records|assets)/i.test(sql))).toEqual([]);
  } finally { query.mockRestore(); }
});

test('private pending uploads share bounded budgets, expire and keep active drafts intact', async () => {
  h = await startTestCore();
  const storage = new ComposerStorage(h.core, { perConnection: 2048, global: 3072, ttlMs: 200 });
  const a = owner('a'), b = owner('b'), c = owner('c');
  const file = { ...attachment, data: 'aGVs'.repeat(256) };
  const upload = (id: string, connection: Connection) => storage.putAsset({ ...file, name: id }, true, connection);
  try {
    const active = upload('active', a);
    expect(upload('active', a)).toEqual(active);
    expect(() => upload('too many for a', a)).toThrow('pending incognito');
    const ref = { kind: file.kind, name: 'active', mimeType: file.mimeType, ...active };
    storage.save('drafts', 'active', { ...value(ref), draft: { projectId: null, worktree: false, incognito: true } }, a);
    const pendingA = upload('pending-a', a);
    const pendingB = upload('pending-b', b);
    expect(() => upload('too many globally', c)).toThrow('pending incognito');
    expect(storage.readAsset(pendingA.assetId).data).toBe(file.data);
    expect(storage.readAsset(pendingB.assetId).data).toBe(file.data);
    await waitFor(() => { try { storage.readAsset(pendingA.assetId); return false; } catch { return true; } }, 1500);
    expect(() => storage.readAsset(pendingB.assetId)).toThrow('uploaded attachment');
    expect(storage.getAsset(active.assetId, a.id).data).toBe(file.data);
    expect(upload('pending-a', a)).toEqual(pendingA);
    expect(upload('active', a)).toEqual(active);
    expect(upload('pending-c', c).assetId).toBeTruthy();
  } finally { storage.close(); }
});

test('asset collection preserves shared references and pending uploads through replacement, null saves and hard deletion', async () => {
  h = await startTestCore();
  const a = await h.connect(), b = await h.connect();
  const count = () => (h.core.journal.db.query('SELECT count(*) AS n FROM composer_assets').get() as { n: number }).n;
  const asset = await a.call('composer.asset.put', { attachment });
  await b.call('composer.asset.put', { attachment });
  const ref = { kind: attachment.kind, mimeType: attachment.mimeType, name: attachment.name, ...asset };
  const first = await a.call('composer.put', { section: 'drafts', id: 'first', expectedRevision: 0, value: value(ref) });
  await a.call('composer.put', { section: 'drafts', id: 'first', expectedRevision: first.record.revision, value: null });
  expect(count()).toBe(1); // b has uploaded the same bytes but has not saved its composer yet.
  const second = await b.call('composer.put', { section: 'drafts', id: 'second', expectedRevision: 0, value: { input: { ...value().input, paused: true, queued: [{ id: 'queued-file', text: 'keep its bytes', attachments: [ref] }] } } });
  const third = await b.call('composer.put', { section: 'drafts', id: 'third', expectedRevision: 0, value: value(ref) });
  await b.call('composer.put', { section: 'drafts', id: 'second', expectedRevision: second.record.revision, value: null });
  expect(count()).toBe(1);
  const next = await b.call('composer.asset.put', { attachment: { ...attachment, data: 'bmV4dA==' } });
  const replacement = { ...ref, ...next };
  const replaced = await b.call('composer.put', { section: 'drafts', id: 'third', expectedRevision: third.record.revision, value: value(replacement) });
  expect(count()).toBe(1); // The replaced asset has neither references nor pending owners.
  const one = await echoThread(h, b), two = await echoThread(h, b);
  await b.call('composer.put', { section: 'inputs', id: one.threadId, expectedRevision: 0, value: value(replacement) });
  await b.call('composer.put', { section: 'inputs', id: two.threadId, expectedRevision: 0, value: value(replacement) });
  await b.call('composer.put', { section: 'drafts', id: 'third', expectedRevision: replaced.record.revision, value: null });
  await b.call('threads.remove', { threadId: one.threadId });
  h.core.journal.db.query('UPDATE thread_deletions SET deleted_at = 0 WHERE thread_id = ?').run(one.threadId);
  h.core.threads.purgeDeleted();
  expect(count()).toBe(1); // The other conversation still references it.
  await a.call('composer.asset.put', { attachment: { ...attachment, data: 'bmV4dA==' } });
  const project = h.core.projects.require(h.core.threads.require(two.threadId).projectId);
  await b.call('projects.remove', { projectId: project.id });
  expect(h.core.composer.storage.get('inputs', two.threadId).value?.input.attachments).toEqual([replacement]);
  expect(count()).toBe(1); // The hidden project keeps its saved attachment.
  await b.call('projects.add', { path: project.path });
  await b.call('threads.remove', { threadId: two.threadId });
  h.core.journal.db.query('UPDATE thread_deletions SET deleted_at = 0 WHERE thread_id = ?').run(two.threadId);
  h.core.threads.purgeDeleted();
  expect(count()).toBe(1); // a's pending upload survives deletion of every saved reference.
  a.close();
  await waitFor(() => count() === 0, 1000);
  expect(count()).toBe(0);
  const last = await b.call('composer.asset.put', { attachment });
  const final = await b.call('composer.put', { section: 'drafts', id: 'final', expectedRevision: 0, value: value({ ...ref, ...last }) });
  await b.call('composer.put', { section: 'drafts', id: 'final', expectedRevision: final.record.revision, value: null });
  expect(count()).toBe(0);
});

test('private assets release removed references and disconnected ownership without touching another owner', async () => {
  h = await startTestCore();
  const a = await h.connect(), b = await h.connect();
  const upload = await a.call('composer.asset.put', { attachment, incognito: true });
  const pending = await a.call('composer.asset.put', { attachment: { ...attachment, data: 'cGVuZGluZw==' }, incognito: true });
  const other = await b.call('composer.asset.put', { attachment, incognito: true });
  const ref = { kind: attachment.kind, mimeType: attachment.mimeType, name: attachment.name, ...upload };
  const privateValue = (...refs: ComposerAttachment[]): ComposerValue => ({ ...value(...refs), draft: { projectId: null, worktree: false, incognito: true } });
  const first = await a.call('composer.put', { section: 'drafts', id: 'private-first', expectedRevision: 0, value: privateValue(ref) });
  const second = await a.call('composer.put', { section: 'drafts', id: 'private-second', expectedRevision: 0, value: privateValue(ref) });
  await a.call('composer.put', { section: 'drafts', id: 'private-first', expectedRevision: first.record.revision, value: privateValue() });
  expect(h.core.composer.storage.readAsset(upload.assetId)).toEqual(attachment);
  await a.call('composer.put', { section: 'drafts', id: 'private-second', expectedRevision: second.record.revision, value: null });
  expect(() => h.core.composer.storage.readAsset(upload.assetId)).toThrow('uploaded attachment');
  const used = await a.call('composer.asset.put', { attachment, incognito: true });
  const durable = await b.call('composer.asset.put', { attachment });
  const durableRef = { ...ref, ...durable };
  const saved = await b.call('composer.put', { section: 'drafts', id: 'durable-shared', expectedRevision: 0, value: value(durableRef) });
  const current = h.core.composer.storage.get('drafts', 'private-first');
  await a.call('composer.put', { section: 'drafts', id: current.id, expectedRevision: current.revision, value: privateValue({ ...ref, ...used }, durableRef) });
  await b.call('composer.put', { section: 'drafts', id: 'durable-shared', expectedRevision: saved.record.revision, value: null });
  expect(await a.call('composer.asset.get', durable)).toEqual(attachment);
  a.close();
  await waitFor(() => !h.core.composer.storage.list().some(record => record.id === current.id), 1000);
  expect(() => h.core.composer.storage.readAsset(used.assetId)).toThrow('uploaded attachment');
  expect(() => h.core.composer.storage.readAsset(pending.assetId)).toThrow('uploaded attachment');
  expect(() => h.core.composer.storage.readAsset(durable.assetId)).toThrow('uploaded attachment');
  expect(h.core.composer.storage.readAsset(other.assetId)).toEqual(attachment);
  expect(await thrown(b.call('composer.asset.get', other))).toThrow('referenced');
  b.close();
});


test('an incognito draft queue and its delivered assets leave no composer rows on disk', async () => {
  h = await startTestCore();
  const owner = await h.connect();
  const account = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
  const choice = { providerId: 'echo', accountId: account.id, model: null, effort: null, permissionMode: 'default' as const };
  const file = { kind: 'file' as const, name: 'private-queue.txt', mimeType: 'text/plain', data: 'c2VjcmV0' };
  const { assetId } = await owner.call('composer.asset.put', { attachment: file, incognito: true });
  const { data: _data, ...meta } = file;
  await owner.call('composer.put', { section: 'drafts', id: 'private-queued-draft', expectedRevision: 0, value: {
    draft: { projectId: null, worktree: false, incognito: true }, choice,
    input: { text: '', attachments: [], paused: false, queued: [
      { id: 'private-queued-first', text: 'private first', attachments: [{ ...meta, assetId }] },
      { id: 'private-queued-second', text: 'private second', attachments: [] },
    ] },
  } });
  await waitFor(() => h.core.journal.listThreads().some(thread => thread.incognito && h.core.journal.listTurns(thread.id).some(turn => turn.status === 'done')));
  const thread = h.core.journal.listThreads().find(thread => thread.incognito)!;
  await waitFor(() => h.core.composer.storage.get('inputs', thread.id).value?.input.queued.length === 0);
  const messages = h.core.journal.listMessages(thread.id).filter(message => message.role === 'user');
  expect(messages).toHaveLength(2);
  expect(messages[0]?.parts).toContainEqual({ type: 'file', mimeType: file.mimeType, name: file.name, data: file.data });
  for (const table of ['composer_records', 'composer_assets', 'composer_deliveries']) {
    expect(h.core.journal.db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  }
});


test('reconnecting an incognito queue with a new arrival never rebatches already delivered input', async () => {
  h = await startTestCore();
  const owner = await h.connect();
  const project = await owner.call('projects.drafts', {});
  const account = (await owner.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
  const thread = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, incognito: true });
  const first = { id: 'private-reconnect-first', text: 'Already delivered', attachments: [] };
  await owner.call('composer.put', { section: 'inputs', id: thread.id, expectedRevision: 0,
    value: { input: { text: '', attachments: [], paused: false, queued: [first] } } });
  await waitFor(() => h.core.journal.listTurns(thread.id).some(turn => turn.status === 'done'));
  owner.close();
  await waitFor(() => h.core.composer.storage.list().length === 0);
  const reconnected = await h.connect();
  await reconnected.call('composer.put', { section: 'inputs', id: thread.id, expectedRevision: 0,
    value: { input: { text: '', attachments: [], paused: false, queued: [first, { id: 'private-reconnect-next', text: 'New arrival', attachments: [] }] } } });
  await waitFor(() => h.core.composer.storage.get('inputs', thread.id).value?.input.queued.length === 0);
  const texts = h.core.journal.listMessages(thread.id).filter(message => message.role === 'user')
    .flatMap(message => message.parts.flatMap(part => part.type === 'text' ? [part.text] : []));
  expect(texts).toEqual(['Already delivered', 'New arrival']);
  expect(h.core.journal.db.query('SELECT count(*) AS n FROM composer_deliveries').get()).toEqual({ n: 0 });
});
