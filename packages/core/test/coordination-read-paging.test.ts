import { afterEach, expect, test } from 'bun:test';
import { fitTranscript, TRANSCRIPT_READ_BUDGET, type AgentAddress, type AgentTranscript, type Turn } from '@boite/contracts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import { resultPageOf } from '../src/delegation/results.ts';
import { remoteTranscript } from '../src/coordination-lookup.ts';

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
/** A long answer: the page cut at 500 and the entry read from 499 that ends at 16,499 both fall inside a surrogate pair. */
function long(seed: number, size = 40_000): string {
  return `${seed}:`.padEnd(499, 'x') + '😀' + 'y'.repeat(15_997) + '😀' + `${'z'.repeat(size - 16_500)} end ${seed}`;
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

test('a default read carries a 500-character preview of each entry, and every cut entry reads back whole', async () => {
  const { h, a, b } = await setup();
  const texts = Array.from({ length: 30 }, (_, index) => long(index));
  for (const [index, text] of texts.entries()) say(h, b, text, 1000 + index);
  const target = h.core.coordination.get(b).self;
  const page = await h.core.coordination.read(a, target);
  // Measured on 2026-11-13: this read was 29,990 characters of text and 31,662 of JSON with 3,000 an entry.
  const chars = page.entries.reduce((sum, entry) => sum + entry.text.length, 0);
  console.log(`default read: ${page.entries.length} entries, ${chars} characters of text, ${JSON.stringify(page).length} characters of JSON`);
  expect(page.entries).toHaveLength(10);
  expect(chars).toBeLessThanOrEqual(5_000);
  expect(JSON.stringify(page).length).toBeLessThan(TRANSCRIPT_READ_BUDGET / 2);
  expect(page.more).toBe(true);
  for (const entry of page.entries) expect(entry.tools).toEqual(['Bash']);
  // The cut never splits a surrogate pair: the entry stops before it and the rest starts with it.
  expect(page.entries[0]!.next).toBe(499);
  expect(await whole((entry, offset) => h.core.coordination.read(a, target, undefined, undefined, entry, offset), page)).toEqual(texts.slice(20));
  // The older entries are a `before` away, cut the same way.
  const older = await h.core.coordination.read(a, target, 20, page.entries[0]!.at);
  expect(await whole((entry, offset) => h.core.coordination.read(a, target, undefined, undefined, entry, offset), older)).toEqual(texts.slice(0, 20));
  expect(await thrown(h.core.coordination.read(a, target, undefined, undefined, page.entries[0]!.id, 40_100))).toThrow('offset: expected 0 to');
  expect(await thrown(h.core.coordination.read(a, target, undefined, undefined, 'no-such-entry'))).toThrow('not an entry of this thread');
  expect(await thrown(h.core.coordination.read(a, target, undefined, undefined, undefined, 5))).toThrow('offset: expected a nonnegative integer beside entry');
});

test('a page stops at the size budget with its newest entries, and the cursor at the cut reaches the rest', async () => {
  const { h, a, b } = await setup();
  const ids = Array.from({ length: 60 }, (_, index) => say(h, b, long(index, 20_000), 1000 + index));
  // One message that called 400 tools: the newest names stay, after a count of the others.
  const busy = crypto.randomUUID();
  h.core.journal.putMessage({ id: busy, threadId: b, turnId: 'history', role: 'assistant', state: 'complete', createdAt: 2000, parts: Array.from({ length: 400 }, (_, index) => ({ type: 'tool', toolId: `t${index}`, name: `tool-${index}`, input: {}, status: 'done', output: '' })) as never });
  const target = h.core.coordination.get(b).self;
  const seen: string[] = [];
  let before: number | undefined;
  for (let pages = 0; ; pages += 1) {
    const page = await h.core.coordination.read(a, target, 100, before);
    const size = JSON.stringify(page).length;
    if (pages === 0) {
      console.log(`read of 100 entries: ${page.entries.length} entries, ${size} characters of JSON`);
      // The newest end is the one kept.
      const last = page.entries.at(-1)!;
      expect(last.id).toBe(busy);
      expect([last.tools.length, last.tools[0], last.tools[1], last.tools.at(-1)]).toEqual([51, '+350 earlier', 'tool-350', 'tool-399']);
      expect(page.entries.length).toBeLessThan(61);
    }
    expect(size).toBeLessThanOrEqual(TRANSCRIPT_READ_BUDGET);
    expect(page.entries.length).toBeGreaterThan(0);
    seen.unshift(...page.entries.map(entry => entry.id));
    if (!page.more) break;
    before = page.entries[0]!.at;
    expect(pages).toBeLessThan(20);
  }
  expect(seen).toEqual([...ids, busy]);
  // Names that double once serialized: the newest entry alone would pass the budget, so its oldest names leave too.
  const quoted = fitTranscript({ contact: h.core.coordination.describe(b), more: false, entries: [{ id: busy, role: 'assistant', at: 2000, text: '', tools: ['+350 earlier', ...Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(200, '"'))] }] });
  expect(JSON.stringify(quoted).length).toBeLessThanOrEqual(TRANSCRIPT_READ_BUDGET);
  expect(quoted.entries[0]!.tools[0]).toMatch(/^\+3[6-9]\d earlier$/);
  expect(quoted.entries[0]!.tools.at(-1)).toStartWith('49"');
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
  expect(page.entries[0]).toMatchObject({ length: text.length, next: 499 });
  expect(await whole((entry, offset) => one.h.core.coordination.read(one.a, target, undefined, undefined, entry, offset), page)).toEqual([text]);
  const request = one.h.core.coordination.request.bind(one.h.core.coordination);
  // A core that still sends 3,000 characters an entry: the page is cut to this core's preview, and the rest reads back from there.
  one.h.core.coordination.request = async (peer, operation, payload) => {
    const answer = await request(peer, operation, payload) as AgentTranscript;
    if (operation !== 'read' || (payload as { entry?: string }).entry !== undefined) return answer;
    return { ...answer, entries: answer.entries.map(entry => ({ ...entry, text: text.slice(0, 3000), next: 3000 })) };
  };
  const wide = await one.h.core.coordination.read(one.a, target);
  expect(wide.entries[0]).toMatchObject({ length: text.length, next: 499 });
  expect(wide.entries[0]!.text).toHaveLength(499);
  expect(await whole((entry, offset) => one.h.core.coordination.read(one.a, target, undefined, undefined, entry, offset), wide)).toEqual([text]);
  // An older core reads the payload's thread, limit and before only, and sends a page.
  one.h.core.coordination.request = (peer, operation, payload) => {
    const { entry: _entry, offset: _offset, ...older } = payload as Record<string, unknown>;
    return request(peer, operation, operation === 'read' ? older : payload);
  };
  const older = await thrown(one.h.core.coordination.read(one.a, target, undefined, undefined, page.entries[0]!.id, 499));
  expect(older).toThrow('older Boite');
  // It answered: the refusal names the mismatch, not a machine that did not answer.
  expect(older).not.toThrow('did not answer');
}, 25000);

test('an older core that sends every tool name of an entry is cut to the newest, after a count of the rest', () => {
  const contact = { coreId: 'core_far', threadId: 'thr_far' } as AgentTranscript['contact'];
  const tools = Array.from({ length: 80 }, (_, index) => `tool-${index}`);
  const read = remoteTranscript(contact, { entries: [{ id: 'msg_1', role: 'assistant', at: 1, text: 'done', tools }], more: false });
  expect(read.entries[0]!.tools).toEqual(['+30 earlier', ...tools.slice(-50)]);
  // What a current core sends, the count first, passes untouched.
  const sent = ['+30 earlier', ...tools.slice(-50)];
  expect(remoteTranscript(contact, { entries: [{ id: 'msg_1', role: 'assistant', at: 1, text: 'done', tools: sent }], more: false }).entries[0]!.tools).toEqual(sent);
});
