import { afterEach, beforeEach, expect, test } from 'bun:test';
import { RpcErrorCode, type MessagePart, type RpcEvents } from '@boite/contracts';
import { echoThread, startTestCore, type TestCore } from './harness';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

let harness: TestCore;
beforeEach(async () => { harness = await startTestCore(); });
afterEach(async () => { await harness.stop(); });

function toolParts(events: RpcEvents['message.part'][]): ToolPart[] {
  return events.map(event => event.part).filter((part): part is ToolPart => part.type === 'tool');
}

test('a socket without live output gets a running command once, then its whole result, while another keeps every redraw', async () => {
  const phone = await harness.connect();
  const desk = await harness.connect();
  const { threadId } = await echoThread(harness, desk);
  await phone.call('threads.subscribe', { threadId, channels: ['text', 'tools'] });
  await desk.call('threads.subscribe', { threadId });
  const phoneParts: RpcEvents['message.part'][] = [];
  const deskParts: RpcEvents['message.part'][] = [];
  phone.on('message.part', event => phoneParts.push(event));
  desk.on('message.part', event => deskParts.push(event));
  const finished = phone.next('turn.finished', turn => turn.threadId === threadId, 15_000);
  await desk.call('turns.start', { threadId, prompt: '[command:3500]built' });
  expect((await finished).status).toBe('done');

  const deskRunning = toolParts(deskParts).filter(part => part.status === 'running' && (part.output ?? '') !== '');
  expect(deskRunning.length).toBeGreaterThanOrEqual(3);
  const phoneRunning = toolParts(phoneParts).filter(part => part.status === 'running');
  // The opening card, then the same card marked as holding output: no redraw after that.
  expect(phoneRunning.map(part => [part.output ?? '', part.outputDeferred ?? false])).toEqual([['', false], ['', true]]);
  const done = toolParts(phoneParts).filter(part => part.status === 'done');
  expect(done).toHaveLength(1);
  // The text still streams to the phone.
  const texts = phoneParts.map(event => event.part).filter(part => part.type === 'text');
  expect(texts.length).toBeGreaterThan(0);
  // The finished call is stored whole and read back when its card opens.
  const messageId = phoneParts.find(event => event.part.type === 'tool')!.messageId;
  const { part } = await phone.call('messages.toolPart', { threadId, messageId, toolId: done[0]!.toolId });
  expect(part.output?.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(60);
});

test('turning live output on sends the running output before the subscribe answer, and off again withholds the redraws', async () => {
  const phone = await harness.connect();
  const { threadId } = await echoThread(harness, phone);
  await phone.call('threads.subscribe', { threadId, channels: ['text', 'tools'] });
  const parts: RpcEvents['message.part'][] = [];
  phone.on('message.part', event => parts.push(event));
  const withheld = phone.next('message.part', event => event.part.type === 'tool' && event.part.outputDeferred === true, 10_000);
  const finished = phone.next('turn.finished', turn => turn.threadId === threadId, 15_000);
  await phone.call('turns.start', { threadId, prompt: '[command:4000]built' });
  await withheld;

  const before = parts.length;
  await phone.call('threads.subscribe', { threadId });
  const resent = toolParts(parts.slice(before));
  expect(resent).toHaveLength(1);
  expect(resent[0]).toMatchObject({ status: 'running' });
  expect(resent[0]!.output?.length ?? 0).toBeGreaterThan(0);
  expect(resent[0]!.outputDeferred).toBeUndefined();

  await phone.call('threads.subscribe', { threadId, channels: ['text', 'tools'] });
  const off = parts.length;
  await finished;
  const after = toolParts(parts.slice(off));
  // One card without output after the switch, then the finished call.
  expect(after.filter(part => part.status === 'running').length).toBeLessThanOrEqual(1);
  expect(after.filter(part => part.status === 'running' && (part.output ?? '') !== '')).toEqual([]);
  expect(after.filter(part => part.status === 'done')).toHaveLength(1);
});

test('a socket without text still gets the tool cards, and its text when the channel comes back', async () => {
  const phone = await harness.connect();
  const reader = await harness.connect();
  const { threadId } = await echoThread(harness, phone);
  await phone.call('threads.subscribe', { threadId, channels: ['tools'] });
  // Text alone: no card while it runs, but the finished call still arrives.
  await reader.call('threads.subscribe', { threadId, channels: ['text'] });
  const read: RpcEvents['message.part'][] = [];
  reader.on('message.part', event => read.push(event));
  const deltas: RpcEvents['message.delta'][] = [];
  const parts: RpcEvents['message.part'][] = [];
  phone.on('message.delta', event => deltas.push(event));
  phone.on('message.part', event => parts.push(event));
  const running = phone.next('message.part', event => event.part.type === 'tool', 10_000);
  const finished = phone.next('turn.finished', turn => turn.threadId === threadId, 15_000);
  await phone.call('turns.start', { threadId, prompt: 'hello there [command:1500]built' });
  await running;
  expect(deltas).toEqual([]);
  expect(parts.filter(event => event.part.type === 'text')).toEqual([]);
  await phone.call('threads.subscribe', { threadId, channels: ['text', 'tools'] });
  const text = parts.map(event => event.part).find(part => part.type === 'text');
  expect(text?.type === 'text' ? text.text : '').toContain('hello there');
  await finished;
  expect(toolParts(read).map(part => part.status)).toEqual(['done']);
});

test('an unknown channel is refused by its field', async () => {
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  const refused = await client.call('threads.subscribe', { threadId, channels: ['video' as never] }).then(() => null, (error: unknown) => error);
  expect((refused as { rpc: unknown }).rpc).toMatchObject({ code: RpcErrorCode.InvalidParams, data: { field: 'channels[0]' } });
});
