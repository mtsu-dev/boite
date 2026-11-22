import { expect, test } from 'bun:test';
import type { Core } from '../src/core.ts';
import { Router } from '../src/router.ts';
import { handleFrame } from '../src/server/frame.ts';
import { FrameQueue } from '../src/server/frame-queue.ts';
import type { ServerConnection } from '../src/server/connection.ts';

test('a synchronous snapshot is sent before a later mutation from another connection', async () => {
  const router = new Router();
  const core = { router, logs: { record() {} } } as unknown as Core;
  const frames: unknown[] = [];
  const connection = (sendResponse: (frame: unknown) => void) => ({
    authenticated: true, identity: { principal: 'owner', threadId: null }, sendResponse,
  }) as unknown as ServerConnection;
  const reader = connection(frame => frames.push(frame));
  const writer = connection(() => {});
  const project = { id: 'prj_new', name: 'New', path: '/new', createdAt: 1 };
  const projects: (typeof project)[] = [];
  router.register('projects.list', () => [...projects]);
  router.register('projects.add', () => {
    projects.push(project);
    frames.push({ method: 'project.added', params: project });
    return project;
  });
  const queue = new FrameQueue((socket, raw, signal) => handleFrame(core, socket, raw, signal));
  try {
    await Promise.all([
      queue.enqueue(reader, JSON.stringify({ id: 1, method: 'projects.list', params: {} })),
      queue.enqueue(writer, JSON.stringify({ id: 2, method: 'projects.add', params: { path: project.path } })),
    ]);
    expect(frames).toEqual([
      { jsonrpc: '2.0', id: 1, result: [] },
      { method: 'project.added', params: project },
    ]);
  } finally { queue.close(); }
});

test('pending asynchronous requests leave room for a second connection', async () => {
  const sender = { close: () => undefined } as unknown as ServerConnection;
  const reader = { close: () => undefined } as unknown as ServerConnection;
  const gate = Promise.withResolvers<void>();
  let active = 0, maximum = 0, observed = 0;
  const queue = new FrameQueue(async connection => {
    if (connection === reader) { observed = active; return; }
    active++; maximum = Math.max(maximum, active);
    await gate.promise;
    active--;
  });
  try {
    const burst = Array.from({ length: 64 }, () => queue.enqueue(sender, 'slow'));
    await queue.enqueue(reader, 'read');
    expect(observed).toBeGreaterThan(0);
    expect(observed).toBeLessThanOrEqual(8);
    gate.resolve();
    await Promise.all(burst);
    expect(maximum).toBeLessThanOrEqual(8);
  } finally { gate.resolve(); queue.close(); }
});

test('asynchronous floods across connections keep the total active work bounded', async () => {
  const connections = Array.from({ length: 10 }, () => ({ close: () => undefined }) as unknown as ServerConnection);
  const gate = Promise.withResolvers<void>(), filled = Promise.withResolvers<void>();
  let active = 0, maximum = 0;
  const queue = new FrameQueue(async () => {
    active++; maximum = Math.max(maximum, active);
    if (active === 64) filled.resolve();
    await gate.promise;
    active--;
  });
  try {
    const pending = connections.flatMap(connection => Array.from({ length: 8 }, () => queue.enqueue(connection, 'slow')));
    await filled.promise;
    expect(maximum).toBe(64);
    gate.resolve();
    await Promise.all(pending);
    expect(maximum).toBe(64);
  } finally { gate.resolve(); queue.close(); }
});

test('long agent requests leave capacity for owner, paired client and authentication', async () => {
  const agents = Array.from({ length: 10 }, () => ({ authenticated: true, identity: { principal: 'agent' }, close: () => undefined }) as unknown as ServerConnection);
  const users = ['owner', 'session', 'agent'].map((principal, index) => ({ authenticated: index < 2, identity: { principal }, close: () => undefined }) as unknown as ServerConnection);
  const gate = Promise.withResolvers<void>(), filled = Promise.withResolvers<void>();
  let active = 0, maximum = 0, reads = 0;
  const queue = new FrameQueue(async connection => {
    if (users.includes(connection)) { reads++; return; }
    active++; maximum = Math.max(maximum, active);
    if (active === 48) filled.resolve();
    await gate.promise;
    active--;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = agents.flatMap(connection => Array.from({ length: 8 }, () => queue.enqueue(connection, 'wait')));
    await filled.promise;
    const requests = users.map(connection => queue.enqueue(connection, 'interact'));
    const completed = await Promise.race([
      Promise.all(requests).then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 250); }),
    ]);
    expect(completed).toBe(true);
    expect(reads).toBe(3);
    expect(maximum).toBeLessThanOrEqual(48);
    gate.resolve();
    await Promise.all(pending);
    expect(maximum).toBeLessThanOrEqual(48);
  } finally { if (timer) clearTimeout(timer); gate.resolve(); queue.close(); }
});

test('agent requests whose client left give their slots back at once and learn it, while their work may go on', async () => {
  const agent = () => ({ authenticated: true, identity: { principal: 'agent' }, close: () => undefined }) as unknown as ServerConnection;
  // 40 stuck: under the 48 that requests of closed agent connections may hold.
  const gone = Array.from({ length: 5 }, agent);
  const fresh = agent();
  const gate = Promise.withResolvers<void>(), filled = Promise.withResolvers<void>();
  const signals: AbortSignal[] = [];
  let stuck = 0, answered = false;
  const queue = new FrameQueue(async (connection, _raw, signal) => {
    if (connection === fresh) { answered = true; return; }
    signals.push(signal);
    if (++stuck === 40) filled.resolve();
    await gate.promise;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = gone.flatMap(connection => Array.from({ length: 8 }, () => queue.enqueue(connection, 'wait')));
    await filled.promise;
    for (const connection of gone) queue.drop(connection);
    const completed = await Promise.race([
      queue.enqueue(fresh, 'where').then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 250); }),
    ]);
    expect(completed).toBe(true);
    expect(answered).toBe(true);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    gate.resolve();
    await Promise.all(pending);
  } finally { if (timer) clearTimeout(timer); gate.resolve(); queue.close(); }
});

test('late completions after a disconnect never free another request\'s slot', async () => {
  const agent = () => ({ authenticated: true, identity: { principal: 'agent' }, close: () => undefined }) as unknown as ServerConnection;
  const gone = Array.from({ length: 5 }, agent);
  const others = Array.from({ length: 7 }, agent);
  const first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>();
  const filled = Promise.withResolvers<void>(), refilled = Promise.withResolvers<void>();
  let stuck = 0, active = 0, maximum = 0;
  const queue = new FrameQueue(async connection => {
    if (gone.includes(connection)) { if (++stuck === 40) filled.resolve(); await first.promise; return; }
    active++; maximum = Math.max(maximum, active);
    if (active === 48) refilled.resolve();
    await second.promise;
    active--;
  });
  try {
    const dropped = gone.flatMap(connection => Array.from({ length: 8 }, () => queue.enqueue(connection, 'wait')));
    await filled.promise;
    for (const connection of gone) queue.drop(connection);
    // 56 requests: 48 run, 8 wait for a slot.
    const work = others.flatMap(connection => Array.from({ length: 8 }, () => queue.enqueue(connection, 'wait')));
    await refilled.promise;
    // The dropped handlers end now: their slots went back at the drop, so the 8 waiting stay queued.
    first.resolve();
    await Promise.all(dropped);
    await Bun.sleep(20);
    expect(maximum).toBe(48);
    second.resolve();
    await Promise.all(work);
    expect(maximum).toBe(48);
  } finally { first.resolve(); second.resolve(); queue.close(); }
});

test('requests of closed connections that ignore their signal cannot push running handlers past the caps, and past them new ones are refused with their methods named', async () => {
  const agent = () => ({ authenticated: true, identity: { principal: 'agent' }, close: () => undefined }) as unknown as ServerConnection;
  const frame = (method: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} });
  const gate = Promise.withResolvers<void>();
  const refused: { connection: ServerConnection; message: string }[] = [], warnings: string[] = [];
  const pending: Promise<void>[] = [];
  let frameObserved: (() => void) | undefined;
  let running = 0, maximum = 0, handled = 0;
  const queue = new FrameQueue(async (_connection, raw) => {
    handled++;
    frameObserved?.();
    if (raw.includes('"where"')) return;
    running++; maximum = Math.max(maximum, running);
    // Ignores its signal, as a handler with no abort path does.
    await gate.promise;
    running--;
  }, {
    refuse: (connection, _raw, message) => {
      refused.push({ connection, message });
      frameObserved?.();
    },
    warn: message => warnings.push(message),
  });
  const disconnectBatch = async (client: ServerConnection, methodAt: (index: number) => string) => {
    const observed = Promise.withResolvers<void>();
    let remaining = 8;
    frameObserved = () => { if (--remaining === 0) observed.resolve(); };
    for (let i = 0; i < 8; i++) pending.push(queue.enqueue(client, frame(methodAt(i))));
    // A pump slice can yield with frames still queued. Drop only after each frame starts or is refused.
    await observed.promise;
    frameObserved = undefined;
    queue.drop(client);
  };
  try {
    // 20 clients each send 8 waits and reconnect: 160 handlers would run without the caps.
    for (let round = 0; round < 20; round++) {
      await disconnectBatch(agent(), i => i % 4 === 0 ? 'threads.wait' : 'browser.command');
    }
    expect(maximum).toBeLessThanOrEqual(96);
    expect(queue.counts.detachedAgents).toBe(48);
    expect(refused).toHaveLength(20 * 8 - 48);
    expect(refused[0]!.message).toMatch(/browser\.command x\d+/);
    expect(refused[0]!.message).toMatch(/threads\.wait x\d+/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/browser\.command x\d+/);
    // A fresh agent request is refused at once, never queued behind them.
    const fresh = agent();
    const before = refused.length;
    await queue.enqueue(fresh, frame('where'));
    expect(refused.length).toBe(before + 1);
    expect(refused.at(-1)!.connection).toBe(fresh);
    // The agent cap leaves the owner admitted until the shared cap of 64 fills.
    const owner = () => ({ authenticated: true, identity: { principal: 'owner' }, close: () => undefined }) as unknown as ServerConnection;
    let count = handled;
    await queue.enqueue(owner(), frame('where'));
    expect(handled).toBe(count + 1);
    for (let round = 0; round < 2; round++) {
      await disconnectBatch(owner(), () => 'browser.command');
    }
    expect(queue.counts.detached).toBe(64);
    const late = owner();
    await queue.enqueue(late, frame('where'));
    expect(refused.at(-1)!.connection).toBe(late);
    // The detached work ends: requests are admitted again, and nothing is freed twice.
    gate.resolve();
    await Promise.all(pending);
    expect(queue.counts).toEqual({ active: 0, activeAgents: 0, detached: 0, detachedAgents: 0 });
    count = handled;
    await queue.enqueue(agent(), frame('where'));
    expect(handled).toBe(count + 1);
  } finally { gate.resolve(); queue.close(); }
});

test('handlers that honour their signal leave the detached count as soon as their client leaves', async () => {
  const agent = () => ({ authenticated: true, identity: { principal: 'agent' }, close: () => undefined }) as unknown as ServerConnection;
  const refused: string[] = [];
  const queue = new FrameQueue(async (_connection, _raw, signal) => {
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { refuse: (_connection, _raw, message) => refused.push(message), warn: () => {} });
  try {
    const pending: Promise<void>[] = [];
    for (let round = 0; round < 20; round++) {
      const client = agent();
      for (let i = 0; i < 8; i++) pending.push(queue.enqueue(client, '{"method":"browser.command"}').catch(() => {}));
      await Bun.sleep(5);
      queue.drop(client);
      await Bun.sleep(0);
      expect(queue.counts.detached).toBe(0);
    }
    await Promise.all(pending);
    expect(refused).toEqual([]);
    expect(queue.counts).toEqual({ active: 0, activeAgents: 0, detached: 0, detachedAgents: 0 });
  } finally { queue.close(); }
});

test('an incoming flood closes its connection and never executes its abandoned requests', async () => {
  const closed: { code: number; reason?: string }[] = [];
  const connection = { close: (code: number, reason?: string) => closed.push({ code, reason }) } as unknown as ServerConnection;
  let calls = 0;
  const queue = new FrameQueue(async () => { calls++; });
  try {
    const pending = Array.from({ length: 4097 }, () => queue.enqueue(connection, '{}'));
    pending.push(queue.enqueue(connection, 'after close'));
    await Promise.all(pending);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.code).toBe(1013);
    expect(closed[0]?.reason).toContain('1024 frames');
    expect(calls).toBe(0);
  } finally { queue.close(); }
});

test('large queued frames are bounded by bytes and shutdown releases accepted work', async () => {
  const closed: number[] = [];
  const connection = { close: (code: number) => closed.push(code) } as unknown as ServerConnection;
  let calls = 0;
  const queue = new FrameQueue(async () => { calls++; });
  const raw = 'x'.repeat(16 * 1024 * 1024);
  try {
    await Promise.all([queue.enqueue(connection, raw), queue.enqueue(connection, raw), queue.enqueue(connection, raw)]);
    expect(closed).toEqual([1013]);
    expect(calls).toBe(0);
    const other = { close: () => undefined } as unknown as ServerConnection;
    const accepted = queue.enqueue(other, 'accepted');
    queue.close();
    await accepted;
    await queue.enqueue(other, 'after shutdown');
    expect(calls).toBe(0);
  } finally { queue.close(); }
});

test('a shared backlog evicts a flooding sender instead of an incoming reader', async () => {
  const closed: number[] = [];
  const senders = Array.from({ length: 4 }, (_, index) => ({ close: () => closed.push(index) }) as unknown as ServerConnection);
  let readerClosed = false, reads = 0;
  const reader = { close: () => { readerClosed = true; } } as unknown as ServerConnection;
  const queue = new FrameQueue(async connection => { if (connection === reader) reads++; });
  try {
    const backlog = senders.flatMap(sender => Array.from({ length: 1024 }, () => queue.enqueue(sender, '{}')));
    await queue.enqueue(reader, 'read');
    await Promise.all(backlog);
    expect(readerClosed).toBe(false);
    expect(reads).toBe(1);
    expect(closed).toHaveLength(1);
  } finally { queue.close(); }
});

test('one sender cannot spend another connection\'s byte capacity', async () => {
  let senderClosed = false, readerClosed = false, reads = 0;
  const sender = { close: () => { senderClosed = true; } } as unknown as ServerConnection;
  const reader = { close: () => { readerClosed = true; } } as unknown as ServerConnection;
  const queue = new FrameQueue(async connection => { if (connection === reader) reads++; });
  const raw = 'x'.repeat(16 * 1024 * 1024);
  try {
    const backlog = [queue.enqueue(sender, raw), queue.enqueue(sender, raw)];
    await queue.enqueue(reader, 'read');
    await Promise.all(backlog);
    expect(senderClosed).toBe(true);
    expect(readerClosed).toBe(false);
    expect(reads).toBe(1);
  } finally { queue.close(); }
});

test('an interactive call starts at once behind eight slow pull request reads, and each lane keeps its own order', async () => {
  const connection = { close: () => undefined } as unknown as ServerConnection;
  const frame = (method: string, id: number) => JSON.stringify({ jsonrpc: '2.0', id, method, params: {} });
  const slowMs = 300;
  const started: string[] = [];
  let slowEnded = false, interactiveAt = 0;
  const queue = new FrameQueue(async (_connection, raw) => {
    const { method, id } = JSON.parse(raw) as { method: string; id: number };
    started.push(`${method}#${id}`);
    if (method === 'settings.get') { interactiveAt = performance.now(); return; }
    await new Promise(resolve => setTimeout(resolve, slowMs));
    slowEnded = true;
  });
  try {
    const slow = Array.from({ length: 8 }, (_, id) => queue.enqueue(connection, frame(id % 2 === 0 ? 'threads.pullRequest' : 'git.status', id)));
    const sentAt = performance.now();
    const interactive = queue.enqueue(connection, frame('settings.get', 8));
    await interactive;
    const delay = interactiveAt - sentAt;
    console.log(`interactive call started ${delay.toFixed(1)} ms after it was queued behind 8 slow calls of ${slowMs} ms`);
    expect(slowEnded).toBe(false);
    expect(delay).toBeLessThan(slowMs / 2);
    await Promise.all(slow);
    // Six background calls ran first, in order; the last two waited for a background slot, still in order.
    expect(started).toEqual([0, 1, 2, 3, 4, 5].map(id => `${id % 2 === 0 ? 'threads.pullRequest' : 'git.status'}#${id}`).concat('settings.get#8', 'threads.pullRequest#6', 'git.status#7'));
  } finally { queue.close(); }
});

test('background calls alone never hold more than six of a connection\'s slots, and interactive calls still get eight', async () => {
  const connection = { close: () => undefined } as unknown as ServerConnection;
  const gate = Promise.withResolvers<void>();
  let active = 0, maximum = 0;
  const run = async () => { active++; maximum = Math.max(maximum, active); await gate.promise; active--; };
  const queue = new FrameQueue(run);
  try {
    const slow = Array.from({ length: 10 }, (_, id) => queue.enqueue(connection, JSON.stringify({ id, method: 'threads.pullRequests' })));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(active).toBe(6);
    const fast = Array.from({ length: 4 }, (_, id) => queue.enqueue(connection, JSON.stringify({ id, method: 'threads.get' })));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(active).toBe(8);
    gate.resolve();
    await Promise.all([...slow, ...fast]);
    expect(maximum).toBe(8);
  } finally { gate.resolve(); queue.close(); }
});
