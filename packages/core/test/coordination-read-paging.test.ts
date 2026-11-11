import { afterEach, expect, test } from 'bun:test';
import type { AgentAddress, AgentTranscript, Turn } from '@boite/contracts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import { resultPageOf } from '../src/delegation/results.ts';

const cores: TestCore[] = [];
afterEach(async () => { for (const core of cores.splice(0)) await core.stop(); });

async function setup() {
  const h = await startTestCore(); cores.push(h);
  const owner = await h.connect();
  const a = (await echoThread(h, owner, 'Reader')).threadId;
  const b = (await echoThread(h, owner, 'Writer')).threadId;
  return { h, a, b };
}
function say(h: TestCore, threadId: string, text: string, at: number, turnId = 'history'): string {
  const id = crypto.randomUUID();
  h.core.journal.putMessage({ id, threadId, turnId, role: 'assistant', state: 'complete', createdAt: at, parts: [{ type: 'text', text }, { type: 'tool', toolId: 't1', name: 'Bash', input: {}, status: 'done', output: 'tool output' }] as never });
  return id;
}
/** A long answer: the page cut at 3,000 and the entry read from 2,999 that ends at 18,999 both fall inside a surrogate pair. */
function long(seed: number, size = 40_000): string {
  return `${seed}:`.padEnd(2999, 'x') + '😀' + 'y'.repeat(15_997) + '😀' + `${'z'.repeat(size - 19_000)} end ${seed}`;
}
/** Every entry's whole text, through its `next` cursors. */
async function whole(read: (entry: string, offset: number) => Promise<AgentTranscript>, page: AgentTranscript): Promise<string[]> {
  const texts: string[] = [];
  for (const entry of page.entries) {
    let text = entry.text;
    for (let next = entry.next; next !== undefined;) {
      const rest = (await read(entry.id, next)).entries[0]!;
      expect(rest).toMatchObject({ id: entry.id, offset: next, length: entry.length });
      text += rest.text;
      next = rest.next;
    }
    texts.push(text);
  }
  return texts;
}

test('a default read is a quarter of its former size, and every cut entry reads back whole', async () => {
  const { h, a, b } = await setup();
  const texts = Array.from({ length: 30 }, (_, index) => long(index));
  for (const [index, text] of texts.entries()) say(h, b, text, 1000 + index);
  const target = h.core.coordination.get(b).self;
  const page = await h.core.coordination.read(a, target);
  // Measured: 30 entries of 4,000 characters made 120,000 characters of text by default.
  const chars = page.entries.reduce((sum, entry) => sum + entry.text.length, 0);
  console.log(`default read: ${page.entries.length} entries, ${chars} characters of text, ${JSON.stringify(page).length} bytes of JSON`);
  expect(page.entries).toHaveLength(10);
  expect(chars).toBeLessThanOrEqual(30_000);
  expect(page.more).toBe(true);
  for (const entry of page.entries) expect(entry.tools).toEqual(['Bash']);
  // The cut never splits a surrogate pair: the entry stops before it and the rest starts with it.
  expect(page.entries[0]!.next).toBe(2999);
  expect(await whole((entry, offset) => h.core.coordination.read(a, target, undefined, undefined, entry, offset), page)).toEqual(texts.slice(20));
  // The older entries are a `before` away, cut the same way.
  const older = await h.core.coordination.read(a, target, 20, page.entries[0]!.at);
  expect(await whole((entry, offset) => h.core.coordination.read(a, target, undefined, undefined, entry, offset), older)).toEqual(texts.slice(0, 20));
  expect(await thrown(h.core.coordination.read(a, target, undefined, undefined, page.entries[0]!.id, 40_100))).toThrow('offset: expected 0 to');
  expect(await thrown(h.core.coordination.read(a, target, undefined, undefined, 'no-such-entry'))).toThrow('not an entry of this thread');
  expect(await thrown(h.core.coordination.read(a, target, undefined, undefined, undefined, 5))).toThrow('offset: expected a nonnegative integer beside entry');
});

test('a final answer cut for its reader names the command and offset that read the rest exactly', async () => {
  const { h, a, b } = await setup();
  const answer = long(7, 20_000);
  say(h, b, 'Looking at the parser first.', 1000, 'turn-1');
  const id = say(h, b, answer, 2000, 'turn-1');
  const turn: Turn = { id: 'turn-1', threadId: b, status: 'done', queuedAt: 1000, startedAt: 1000, finishedAt: 2000, usage: null, error: null };
  h.core.journal.putTurn(turn);
  const shown = h.core.delegation.result(turn, 'thread')!;
  expect(shown.length).toBeLessThanOrEqual(4000);
  const [, kept, offset] = /^([\s\S]*)\n\[Cut at character (\d+) of this message\. The rest: boite threads read \S+ --entry (?:\S+) --offset \d+\]$/.exec(shown)!;
  expect(shown).toContain(`--entry ${id} --offset ${offset}`);
  const target = h.core.coordination.get(b).self;
  const rest = await whole((entry, from) => h.core.coordination.read(a, target, undefined, undefined, entry, from), { contact: h.core.coordination.describe(b), more: false, entries: [{ id, role: 'assistant', at: 2000, text: kept!, tools: [], length: answer.length, next: Number(offset) }] });
  expect(rest).toEqual([answer]);
  // For a parent, the offset counts from the start of the turn's answer, as `delegation.result` pages it.
  const forParent = h.core.delegation.result(turn, 'delegate', 3000)!;
  expect(forParent.length).toBeLessThanOrEqual(3000);
  const [, at, total, turnId] = /\[Cut at character (\d+) of (\d+)\. The rest: boite delegate result \S+ (\S+) \d+\]$/.exec(forParent)!;
  const before = 'Looking at the parser first.\n';
  expect(Number(total)).toBe([...before, ...answer].length);
  // The page from that offset, as `delegation.result` reads it, completes the last message from what the parent was shown.
  let tail = '';
  for (let next: number | null = Number(at); next !== null;) {
    const page = resultPageOf(h.core, b, turnId, next);
    tail += page.text;
    next = page.nextOffset;
  }
  expect(forParent.slice(0, forParent.lastIndexOf('\n[Cut')) + tail).toBe(answer);
  // An error the agent hit is part of the entry `threads read` shows, so the offset counts it too.
  const failed = crypto.randomUUID();
  h.core.journal.putMessage({ id: failed, threadId: b, turnId: 'turn-2', role: 'assistant', state: 'complete', createdAt: 3000, parts: [{ type: 'error', message: 'tool crashed' }, { type: 'text', text: answer }] as never });
  const second = h.core.delegation.result({ ...turn, id: 'turn-2' } as Turn, 'thread')!;
  const [, start, from] = /^([\s\S]*)\n\[Cut at character (\d+) of this message\. The rest: boite threads read \S+ --entry \S+ --offset \d+\]$/.exec(second)!;
  const full = `[error] tool crashed\n${answer}`;
  expect(start).toBe(full.slice(0, Number(from)));
  expect(await whole((entry, offset) => h.core.coordination.read(a, target, undefined, undefined, entry, offset), { contact: h.core.coordination.describe(b), more: false, entries: [{ id: failed, role: 'assistant', at: 3000, text: start!, tools: [], length: full.length, next: Number(from) }] })).toEqual([full]);
});

test('a linked core pages an entry, and an older core that answers with a page is named, not trusted', async () => {
  const one = await setup(); const two = await setup();
  const cardA = one.h.core.coordination.identity(), cardB = two.h.core.coordination.identity();
  one.h.core.coordination.trust(cardB); two.h.core.coordination.trust({ ...cardA, readThreads: true });
  const text = long(3);
  say(two.h, two.b, text, 1000);
  const target: AgentAddress = { coreId: cardB.coreId, threadId: two.b };
  const page = await one.h.core.coordination.read(one.a, target);
  expect(page.entries[0]).toMatchObject({ length: text.length, next: 2999 });
  expect(await whole((entry, offset) => one.h.core.coordination.read(one.a, target, undefined, undefined, entry, offset), page)).toEqual([text]);
  // An older core reads the payload's thread, limit and before only, and sends a page.
  const request = one.h.core.coordination.request.bind(one.h.core.coordination);
  one.h.core.coordination.request = (peer, operation, payload) => {
    const { entry: _entry, offset: _offset, ...older } = payload as Record<string, unknown>;
    return request(peer, operation, operation === 'read' ? older : payload);
  };
  const older = await thrown(one.h.core.coordination.read(one.a, target, undefined, undefined, page.entries[0]!.id, 2999));
  expect(older).toThrow('older Boite');
  // It answered: the refusal names the mismatch, not a machine that did not answer.
  expect(older).not.toThrow('did not answer');
}, 25000);
