import { expect, test } from 'bun:test';
import { Bus } from '../src/bus.ts';

test('a throwing listener neither stops the others nor escapes the delta timer', async () => {
  const bus = new Bus();
  const errors: string[] = [];
  bus.onError = (message) => errors.push(message);
  const seen: string[] = [];
  bus.onAny(() => {
    throw new Error('listener broke');
  });
  bus.onAny((name) => seen.push(name));
  bus.emit('message.delta', { threadId: 't', messageId: 'm', partIndex: 0, text: 'hi' });
  // The delta goes out from a 16 ms timer, where a throw would end the process.
  await Bun.sleep(40);
  expect(seen).toEqual(['message.delta']);
  expect(errors).toEqual(['event listener failed on message.delta: listener broke']);
  bus.dispose();
});

test('a report that throws again does not loop', () => {
  const bus = new Bus();
  let reports = 0;
  bus.onAny(() => {
    throw new Error('always');
  });
  bus.onError = (message) => {
    reports += 1;
    // A core reports through the bus itself, and the same listener throws on that too.
    bus.emit('core.log', { level: 'error', message, at: 0 });
  };
  bus.emit('core.log', { level: 'info', message: 'first', at: 0 });
  expect(reports).toBe(1);
  bus.dispose();
});

test('committed observers wait for the write while internal listeners remain synchronous', () => {
  const bus = new Bus();
  const internal: string[] = [], committed: string[] = [];
  bus.onAny((_, payload) => internal.push((payload as { message: string }).message));
  bus.onCommitted((_, payload) => committed.push((payload as { message: string }).message));
  const result = bus.afterCommit(() => {
    bus.emit('core.log', { level: 'info', message: 'first', at: 0 });
    expect(internal).toEqual(['first']);
    expect(committed).toEqual([]);
    bus.afterCommit(() => bus.emit('core.log', { level: 'info', message: 'second', at: 0 }));
    expect(committed).toEqual([]);
    return 42;
  });
  expect(result).toBe(42);
  expect(committed).toEqual(['first', 'second']);
  bus.dispose();
});

test('rollback discards nested notifications and new deltas, preserving earlier deltas', () => {
  const bus = new Bus();
  const committed: string[] = [];
  bus.onCommitted((name, payload) => committed.push(name === 'message.delta' ? (payload as { text: string }).text : name));
  const delta = { threadId: 't', messageId: 'm', partIndex: 0, text: 'before' };
  bus.emit('message.delta', delta);
  expect(() => bus.afterCommit(() => {
    bus.afterCommit(() => bus.emit('core.log', { level: 'info', message: 'nested', at: 0 }));
    bus.emit('message.delta', { ...delta, text: 'rolled back' });
    throw new Error('write failed');
  })).toThrow('write failed');
  bus.flush();
  expect(committed).toEqual(['before']);
  bus.afterCommit(() => {
    bus.emit('core.log', { level: 'info', message: 'outer', at: 0 });
    try {
      bus.afterCommit(() => {
        bus.emit('message.delta', { ...delta, text: 'nested failure' });
        throw new Error('nested failed');
      });
    } catch { /* The enclosing write can still commit. */ }
    bus.emit('message.delta', { ...delta, text: 'after' });
  });
  bus.flush();
  expect(committed).toEqual(['before', 'core.log', 'after']);
  bus.dispose();
});

test('the first text follows its part immediately after the commit and rolls back with it', () => {
  const bus = new Bus();
  let deliveredInternally = 0;
  bus.onAny(name => { if (name === 'message.delta') deliveredInternally += 1; });
  const seen: string[] = [];
  bus.onCommitted((name, payload) => seen.push(name === 'message.delta' ? (payload as { text: string }).text : name));
  const slot = { threadId: 't', messageId: 'm', partIndex: 0 };
  const firstText = () => {
    const before = deliveredInternally;
    bus.emit('message.part', { ...slot, part: { type: 'text', text: '' } });
    bus.emit('message.delta', { ...slot, text: 'first' }, { firstText: true });
    expect(deliveredInternally).toBe(before + 1);
    expect(seen).toEqual([]);
  };
  expect(() => bus.afterCommit(() => { firstText(); throw new Error('rollback'); })).toThrow('rollback');
  expect(seen).toEqual([]);
  bus.afterCommit(firstText);
  bus.emit('message.delta', { ...slot, text: 'next' });
  expect(seen).toEqual(['message.part', 'first']);
  bus.flush();
  expect(seen).toEqual(['message.part', 'first', 'next']);
  bus.dispose();
});

test('another thread can publish a part while pending text stays batched on this thread', () => {
  const bus = new Bus();
  const seen: string[] = [];
  bus.onCommitted((name, payload) => seen.push(name === 'message.delta' ? (payload as { text: string }).text : name));
  const slot = (threadId: string) => ({ threadId, messageId: threadId, partIndex: 0 });
  bus.emit('message.delta', { ...slot('a'), text: 'one' });
  bus.emit('message.delta', { ...slot('b'), text: 'b' });
  bus.emit('message.part', { ...slot('b'), part: { type: 'text', text: 'replacement' } });
  expect(seen).toEqual(['b', 'message.part']);
  bus.emit('message.delta', { ...slot('a'), text: ' two' });
  bus.emit('core.log', { level: 'info', message: 'global', at: 0 });
  expect(seen).toEqual(['b', 'message.part', 'one two', 'core.log']);
  bus.dispose();
});
