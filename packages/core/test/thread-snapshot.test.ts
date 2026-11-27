import { afterEach, beforeEach, expect, test } from 'bun:test';
import { projectMessage, type Message } from '@boite/contracts';
import { echoThread, holdAccountTurns, startTestCore, startTurn, type TestCore } from './harness';

let harness: TestCore;
beforeEach(async () => { harness = await startTestCore(); });
afterEach(async () => { await harness.stop(); });

test('opening a search hit in a short archived thread keeps the anchor when the byte budget cuts the page', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  for (const index of [0, 1, 2]) {
    harness.core.journal.putMessage({ id: `manual${index}`, threadId, turnId: 'search', role: 'assistant',
      state: 'complete', createdAt: index, parts: [{ type: 'text', text: 'x'.repeat(3000) }] });
  }
  await client.call('threads.archive', { threadId, archived: true });
  const page = await client.call('threads.get', { threadId, around: 'manual0', limit: 40, maxBytes: 4096 });
  expect(page.messages.map(message => message.id)).toEqual(['manual0']);
  expect(page.messagesBefore).toBeNull();
  expect(page.messagesAfter).toBe('manual0');
  const following = await client.call('messages.list', { threadId, after: page.messagesAfter!, maxBytes: 4096 });
  expect(following.messages.map(message => message.id)).toEqual(['manual1']);
});

test('opening subscribes, replaces the previous thread and restores pending cards in one snapshot', async () => {
  const client = await harness.connect();
  const previous = await echoThread(harness, client, 'Previous');
  const { threadId } = await echoThread(harness, client, 'Opened');
  await client.call('threads.subscribe', { threadId: previous.threadId });
  const opened = await client.call('threads.get', { threadId, sync: true, open: { previous: previous.threadId, markRead: true } });
  expect(opened.opened).toEqual({ permissions: [], questions: [] });
  expect(opened.unread).toBe(false);
  const event = client.next('message.started', message => message.threadId === threadId);
  harness.core.bus.emit('message.started', { id: 'subscribed', threadId, turnId: 'turn', role: 'assistant', parts: [], state: 'streaming', createdAt: 1 });
  expect((await event).id).toBe('subscribed');
});

test('a quiet return omits its unchanged payload and an unseen tool suffix still invalidates the proof', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  harness.core.journal.putTurn({ id: 'finished', threadId, status: 'done', queuedAt: 1, startedAt: 1, finishedAt: 2, usage: null, error: null });
  harness.core.journal.putMessage({ id: 'latest', threadId, turnId: 'finished', role: 'assistant', state: 'complete', createdAt: 1,
    parts: [{ type: 'tool', toolId: 'large', name: 'Bash', input: {}, output: 'same prefix '.repeat(4000) + 'before', status: 'done' }] });
  const first = await client.call('threads.get', { threadId, compactTools: true, sync: true });
  expect(first.messagesSync?.from).toBe('latest');
  const quiet = await client.call('threads.get', { threadId, after: 'latest', compactTools: true, sync: first.messagesSync });
  expect(quiet.messages).toEqual([]);
  expect(quiet.messagesUnchanged).toBe(true);
  expect(quiet.messagesFrom).toBe('latest');
  const changed = harness.core.journal.getMessage('latest')!;
  if (changed.parts[0]?.type !== 'tool') throw new Error('fixture needs a tool');
  changed.parts[0].output = 'same prefix '.repeat(4000) + 'after!';
  harness.core.journal.putMessage(changed);
  const fresh = await client.call('threads.get', { threadId, after: 'latest', compactTools: true, sync: first.messagesSync });
  expect(fresh.messagesUnchanged).toBeUndefined();
  expect(fresh.messages).toHaveLength(1);
  expect(fresh.messagesSync?.hash).not.toBe(first.messagesSync?.hash);
});

test('compact attachment pages skip cached blobs and match legacy rows in both resume proofs', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const { journal } = harness.core;
  for (const turnId of ['older-turn', 'latest-turn']) journal.putTurn({ id: turnId, threadId, status: 'done', queuedAt: 1, startedAt: 1, finishedAt: 2, usage: null, error: null });
  const png = Buffer.alloc(64 * 1024);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.write('IHDR', 12);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  const data = png.toString('base64');
  const older: Message = { id: 'older', threadId, turnId: 'older-turn', role: 'user', state: 'complete', createdAt: 1,
    parts: [{ type: 'file', mimeType: 'text/plain', name: 'notes.txt', data }, { type: 'file', mimeType: 'image/png', name: 'image.png', data }] };
  const latest: Message = { id: 'latest', threadId, turnId: 'latest-turn', role: 'assistant', state: 'complete', createdAt: 2,
    parts: [{ type: 'image', mimeType: 'image/png', alt: null, data }, { type: 'file', mimeType: 'application/pdf', name: 'inline.pdf', data }] };
  journal.putMessage(older);
  journal.putMessage(latest);
  const options = { compactFiles: true, compactImages: true, sync: true } as const;
  const blur = 'data:image/png;base64,blur';
  journal.db.query('INSERT INTO media_previews (thread_id, message_id, part_index, preview) VALUES (?, ?, ?, ?)').run(threadId, 'older', 1, blur);
  journal.db.query('INSERT INTO media_previews (thread_id, message_id, part_index, preview) VALUES (?, ?, ?, ?)').run(threadId, 'latest', 0, blur);
  const first = await client.call('threads.get', { threadId, ...options });
  expect(first.messages).toEqual([older, latest].map(message => projectMessage(message, options, () => blur)));
  expect(first.messagesSync?.prefix?.count).toBe(1);
  const blobs = journal.db.query('SELECT message_id AS id, data, preview FROM part_blobs WHERE field = ? AND part_index = 0').all('data') as { id: string; data: Uint8Array; preview: string }[];
  expect(blobs.map(blob => JSON.parse(blob.preview))).toEqual(Array.from({ length: 2 }, () => ({ bytes: png.length, width: 640, height: 480 })));
  journal.db.run("UPDATE part_blobs SET preview = NULL WHERE field = 'data'");
  const legacy = await client.call('threads.get', { threadId, ...options });
  expect(legacy.messages).toEqual(first.messages);
  expect(legacy.messagesSync).toEqual(first.messagesSync);
  const update = journal.db.query('UPDATE part_blobs SET data = ?, preview = ? WHERE message_id = ? AND part_index = 0');
  for (const blob of blobs) update.run(Buffer.from('invalid zstd'), blob.preview, blob.id);
  const resume = await client.call('threads.get', { threadId, ...options, after: latest.id, sync: first.messagesSync });
  expect(resume.messagesUnchanged).toBe(true);
  const forward = await client.call('messages.list', { threadId, after: older.id, limit: 1, compactFiles: true, compactImages: true });
  expect(forward.messages).toEqual(first.messages.slice(1));
  for (const blob of blobs) update.run(blob.data, blob.preview, blob.id);
  expect(journal.getMessage(latest.id)?.parts).toEqual(latest.parts);
  png[png.length - 1] = 1;
  const image = latest.parts[0];
  if (image?.type !== 'image') throw new Error('fixture needs an image');
  journal.putMessage({ ...latest, parts: [{ ...image, data: png.toString('base64') }, latest.parts[1]!] });
  const changed = await client.call('threads.get', { threadId, ...options, after: latest.id, sync: first.messagesSync });
  expect(changed.messagesUnchanged).toBeUndefined();
  expect(changed.messages).toEqual(first.messages.slice(1));
});

test('opening and quiet reconnect snapshots retain durable native background history after completion', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const finished = client.next('turn.finished', turn => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: 'Snapshot history' });
  const turn = await finished;
  const source = harness.core.threads.require(threadId);
  const owner = { providerId: source.providerId, sessionGeneration: source.sessionGeneration ?? 0, parentTurnId: turn.id };
  harness.core.threads.agentState.noteBackground(threadId, [{ id: 'snapshot-native-task', kind: 'shell', description: 'Native work', toolId: null, startedAt: Date.now() }], owner);
  const opened = await client.call('threads.get', { threadId, compactFiles: true, sync: true, open: { markRead: true } });
  expect(opened.background).toHaveLength(1);
  expect(opened.backgroundHistory).toMatchObject([{ id: 'snapshot-native-task', state: 'running', parentTurnId: turn.id }]);
  expect(opened.opened).toEqual({ permissions: [], questions: [] });
  if (!opened.messagesSync) throw new Error('completed fixture needs a resume proof');
  harness.core.threads.agentState.finishBackground(threadId, 'snapshot-native-task', owner, 'completed');
  const reconnected = await harness.connect();
  const quiet = await reconnected.call('threads.get', {
    threadId, after: opened.messagesSync.from, compactFiles: true, sync: opened.messagesSync, open: { markRead: true },
  });
  expect(quiet.messages).toEqual([]);
  expect(quiet.messagesUnchanged).toBe(true);
  expect(quiet.background).toEqual([]);
  expect(quiet.backgroundHistory).toMatchObject([{ id: 'snapshot-native-task', state: 'completed', parentTurnId: turn.id }]);
  const { Core } = await import('../src/core');
  const restarted = new Core({ dataDir: harness.dataDir, token: harness.token });
  try {
    const restored = restarted.threads.get(threadId, undefined, { compactFiles: true, sync: true });
    expect(restored.background).toEqual([]);
    expect(restored.backgroundHistory).toEqual(quiet.backgroundHistory);
  } finally { await restarted.close(); }
});

test('a reconnect refreshes an older question answered outside the retained tail', async () => {
  const writer = await harness.connect();
  const reader = await harness.connect();
  const { threadId, accountId } = await echoThread(harness, writer);
  await writer.call('threads.subscribe', { threadId });
  await (await startTurn(writer, threadId, 'First turn')).finished;
  const { questionId } = await writer.call('questions.ask', { threadId, text: 'Old card', options: ['Yes'] });
  await (await startTurn(writer, threadId, 'Second turn')).finished;
  const held = await reader.call('threads.get', { threadId, sync: true, open: {} });
  const proof = held.messagesSync!;
  const answer = (thread: typeof held) => thread.messages.flatMap(message => message.parts).flatMap(part =>
    part.type === 'question' && part.questionId === questionId ? [part.answer?.text ?? null] : []);
  expect(answer(held)).toEqual([null]);
  expect(held.messages.findIndex(message => message.id === proof.from)).toBeGreaterThan(0);
  reader.close();
  const resume = { threadId, after: proof.from, sync: proof, open: {} };
  const reconnected = await harness.connect();
  const quiet = await reconnected.call('threads.get', resume);
  expect(quiet.messagesUnchanged).toBe(true);
  const release = holdAccountTurns(harness, accountId);
  try {
    await writer.call('questions.answer', { threadId, questionId, optionIds: [], text: 'Answered elsewhere' });
    const refreshed = await reconnected.call('threads.get', resume);
    expect(refreshed.messagesFrom).toBeUndefined();
    expect(answer(refreshed)).toEqual(['Answered elsewhere']);
  } finally { release(); }
});
