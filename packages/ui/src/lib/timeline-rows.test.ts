import { expect, test } from 'vitest';
import type { MemoryEvent, Message, MessagePart } from '@boite/contracts';
import { heavyThread } from './fake-client/heavy-thread';
import { memoryPartRuns } from './memory-timeline';
import { partRuns } from './tool-groups';
import { CUT_FROM, ROW_CHARS, ROW_PARTS, SPLIT_FROM, TimelineRows, rowCuts, rowEstimate, rowIndexOf, seam, textCuts, type TimelineRow } from './timeline-rows';
import { markdownAnswer } from './fake-client/markdown-thread';
import { findHits } from './find';

const tool = (id: string): MessagePart => ({ type: 'tool', toolId: id, name: 'Bash', input: { command: `echo ${id}` }, output: 'ok', status: 'done' });
const text = (value: string): MessagePart => ({ type: 'text', text: value });

function failedAttempts(): Message[] {
  return Array.from({ length: 4 }, (_, index) => [
    { ...message(`wake-${index}`, [text('Resumed after an error')], 'system'), turnId: `retry-${index}` },
    { ...message(`error-${index}`, [{ type: 'error', message: `HTTP 503 attempt ${index}` }]), turnId: `retry-${index}` }
  ]).flat();
}

test('consecutive failed automatic attempts occupy one row and retain every original message and jump target', () => {
  const messages = failedAttempts();
  const builder = new TimelineRows();
  const rows = builder.build(messages);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.failures).toEqual(messages);
  expect(rows[0]!.message).toBe(messages.at(-1));
  for (const original of messages) expect(rowIndexOf(rows, original.id)).toBe(0);
  expect(builder.build(messages)).toBe(rows);
  const more = [...messages, { ...messages.at(-1)!, id: 'error-new', turnId: 'retry-new' }];
  expect(builder.build(more)).toHaveLength(1);
  expect(builder.changedFrom).toBe(0);
  expect(builder.build(more)[0]!.failures).toHaveLength(9);
});

test('a failed group never swallows useful work, live output, memory notices or missing history', () => {
  const messages = failedAttempts();
  const boundary = message('answer', [text('The deployment completed.')]);
  for (const middle of [boundary, { ...boundary, role: 'user' as const }, message('work', [tool('call')]), { ...messages[3]!, id: 'live', state: 'streaming' as const }]) {
    const rows = new TimelineRows().build([...messages.slice(0, 4), middle, ...messages.slice(4)]);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.message).toBe(middle);
  }
  const memory = new Map([['wake-2', [{ at: 1, kind: 'killed' } as MemoryEvent]]]);
  expect(new TimelineRows().build(messages, memory).some(row => row.failures?.some(message => message.id === 'wake-2'))).toBe(false);
  const rows = new TimelineRows().build(messages, undefined, new Map([['wake-2', {}]]));
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.failures?.length)).toEqual([4, 4]);
});

function message(id: string, parts: MessagePart[], role: Message['role'] = 'assistant'): Message {
  return { id, threadId: 't-1', turnId: `turn-${id}`, role, parts, state: 'complete', createdAt: 0 };
}

/** A turn of work: `runs` runs of `calls` calls, a paragraph in front of each and one to close. */
function work(runs: number, calls: number): MessagePart[] {
  const parts: MessagePart[] = [];
  for (let run = 0; run < runs; run += 1) {
    parts.push(text(`paragraph ${run}`));
    for (let call = 0; call < calls; call += 1) parts.push(tool(`k-${run}-${call}`));
  }
  parts.push(text('done'));
  return parts;
}

test('a message is one row until it is long, then it is cut in front of its paragraphs', () => {
  const short = message('m-short', work(4, 9));
  const long = message('m-long', work(30, 9));
  expect(short.parts.length).toBeLessThanOrEqual(CUT_FROM);
  const rows = new TimelineRows().build([short, long]);

  expect(rows[0]).toMatchObject({ id: 'm-short', from: 0, to: short.parts.length, first: true, last: true });
  const cut = rows.slice(1);
  expect(cut.length).toBeGreaterThan(5);
  // The first row keeps the message's id: an anchor, a jump or a saved height by message still finds it.
  expect(cut.map(row => row.id)).toEqual(['m-long', ...cut.slice(1).map((_, index) => `m-long#${index + 1}`)]);
  expect(cut.map(row => row.first)).toEqual(cut.map((_, index) => index === 0));
  expect(cut.map(row => row.last)).toEqual(cut.map((_, index) => index === cut.length - 1));
  // Every part is drawn once, in order, and each row but the last holds a row's worth.
  expect(cut[0]!.from).toBe(0);
  expect(cut.at(-1)!.to).toBe(long.parts.length);
  cut.slice(1).forEach((row, index) => {
    expect(row.from).toBe(cut[index]!.to);
    expect(long.parts[row.from]!.type).toBe('text');
    expect(cut[index]!.to - cut[index]!.from).toBeGreaterThanOrEqual(ROW_PARTS);
  });
});

test('the rows of a cut message draw the runs the whole message drew', () => {
  const thread = heavyThread();
  let cutMessages = 0;
  for (const whole of thread.messages) {
    const rows = new TimelineRows().build([whole]);
    if (rows.length > 1) cutMessages += 1;
    expect(rows.flatMap(row => memoryPartRuns(whole.parts, [], row.from, row.to))).toEqual(partRuns(whole.parts));
  }
  expect(cutMessages).toBeGreaterThan(5);
});

test('blank text, a hidden marker, a noticed part and the last part never start a row', () => {
  const parts = work(1, ROW_PARTS + 30);
  // Past a row's worth of calls: a blank paragraph, a goal marker alone, then a real one.
  parts.splice(ROW_PARTS + 4, 0, text('   '));
  parts.splice(ROW_PARTS + 8, 0, text('[BOITE_GOAL_COMPLETE]'));
  parts.splice(ROW_PARTS + 12, 0, text('noticed'));
  parts.splice(ROW_PARTS + 16, 0, text('a real paragraph'));
  const long = message('m-1', parts);
  expect(rowCuts(long)).toEqual([ROW_PARTS + 12]);
  // A memory notice anchored on a paragraph keeps it in the row before.
  expect(rowCuts(long, new Set([ROW_PARTS + 12]))).toEqual([ROW_PARTS + 16]);
  const notice = { at: 1, kind: 'killed', anchor: { messageId: 'm-1', partIndex: ROW_PARTS + 12 } } as unknown as MemoryEvent;
  expect(new TimelineRows().build([long], new Map([['m-1', [notice]]])).map(row => row.from)).toEqual([0, ROW_PARTS + 16]);
  // Stops a minute apart on the same call read as one card; another limit does not join it.
  const stop = (at: number, limitBytes = 1) => ({ ...notice, at, reason: 'machine', limitBytes }) as MemoryEvent;
  const runs = memoryPartRuns(parts, [stop(1), stop(60_001), stop(60_002, 2)]).filter(run => run.kind === 'memory');
  expect(runs.map(run => run.kind === 'memory' && run.events.length)).toEqual([2, 1]);
  // The closing paragraph is the one an answer may still be writing: it is not read.
  const closing = message('m-2', [...Array.from({ length: CUT_FROM + 6 }, (_, index) => tool(`k-${index}`)), text('still writing')]);
  expect(rowCuts(closing)).toEqual([]);
  // A prompt is never cut, whatever it carries.
  expect(rowCuts(message('m-3', work(30, 9), 'user'))).toEqual([]);
});

test('rows that did not change stay the same objects, and a part arriving touches only the last row', () => {
  // Twenty-one runs of ten parts: the closing paragraph sits ten parts into the last row.
  const steady = message('m-steady', work(21, 9));
  const growing = message('m-growing', work(21, 9));
  const builder = new TimelineRows();
  const before = builder.build([steady, growing]);
  expect(builder.build([steady, growing])).toBe(before);
  expect(builder.changedFrom).toBe(before.length);

  growing.parts.push(tool('k-new'));
  const after = builder.build([steady, growing]);
  expect(after).not.toBe(before);
  expect(after).toHaveLength(before.length);
  after.slice(0, -1).forEach((row, index) => expect(row).toBe(before[index]));
  expect(after.at(-1)).not.toBe(before.at(-1));
  expect(after.at(-1)!.to).toBe(growing.parts.length);
  expect(builder.changedFrom).toBe(before.length - 1);
  expect(builder.order).toBe(after.map(row => row.id).join('\0'));

  // A paragraph a row's worth further on starts the next row once a part follows it.
  for (let call = 0; call < ROW_PARTS; call += 1) growing.parts.push(tool(`k-more-${call}`));
  growing.parts.push(text('the next paragraph'));
  expect(builder.build([steady, growing])).toHaveLength(after.length);
  growing.parts.push(tool('k-last'));
  const cut = builder.build([steady, growing]);
  expect(cut).toHaveLength(after.length + 1);
  expect(cut.at(-1)).toMatchObject({ from: growing.parts.length - 2, to: growing.parts.length, first: false, last: true });
  expect(cut.at(-2)!.last).toBe(false);
  expect(builder.changedFrom).toBe(after.length - 1);
});

test('a part is found in the row that draws it, and a cut row is estimated by what it holds', () => {
  const long = message('m-long', work(30, 9));
  const rows = new TimelineRows().build([message('m-first', [text('hello')]), long]);
  expect(rowIndexOf(rows, 'm-long')).toBe(1);
  expect(rowIndexOf(rows, 'm-missing')).toBe(-1);
  for (const [index, row] of rows.entries()) {
    if (row.message !== long) continue;
    expect(rowIndexOf(rows, 'm-long', row.from)).toBe(index);
    expect(rowIndexOf(rows, 'm-long', row.to - 1)).toBe(index);
  }
  expect(rowEstimate(rows[0]!, 80)).toBe(80);
  expect(rowEstimate(rows[1]!, 80)).toBeGreaterThan(80);
  // A run of nine calls per paragraph weighs its parts; a sentence before each call, ADEMark's long session, its paragraphs.
  expect(rowEstimate(rows[1]!, 80)).toBe((rows[1]!.to - rows[1]!.from) * 11);
  const steps = new TimelineRows().build([message('m-steps', work(100, 1))]);
  expect(steps.length).toBeGreaterThan(2);
  for (const row of steps) expect(rowEstimate(row, 80)).toBe(Math.ceil((row.to - row.from) / 2) * 100);
});

test('the heavy thread is the 11.5 MiB conversation it stands for, the same at every build', () => {
  const thread = heavyThread();
  const bytes = new TextEncoder().encode(JSON.stringify(thread.messages)).byteLength / 1048576;
  expect(thread.messages).toHaveLength(40);
  expect(bytes).toBeGreaterThan(11);
  expect(bytes).toBeLessThan(12);
  expect(Math.max(...thread.messages.map(message => message.parts.length))).toBeGreaterThan(1000);
  expect(JSON.stringify(heavyThread().messages.at(-2))).toBe(JSON.stringify(thread.messages.at(-2)));
});

test('an assistant message that carries on the turn above joins it at the gap of one message', () => {
  const whole = (value: Message): TimelineRow => ({ id: value.id, message: value, from: 0, to: value.parts.length, first: true, last: true });
  const inTurn = (value: Message, turnId: string): Message => ({ ...value, turnId });
  const tools = whole(inTurn(message('a', [text('Checking.'), tool('1'), tool('2'), text('')]), 'turn'));
  const running = whole(inTurn(message('b', [text(' '), tool('3')]), 'turn'));
  // Two runs of work meet: the space between two parts of one message.
  expect(seam(tools, running)).toBe('part');
  // Text on either side keeps a paragraph's space.
  expect(seam(running, whole(inTurn(message('c', [text('Done.')]), 'turn')))).toBe('block');
  expect(seam(whole(inTurn(message('d', [tool('4'), text('Found it.')]), 'turn')), running)).toBe('block');
  // Another turn, a prompt, a cut row and the first row keep the gap between messages.
  expect(seam(whole(inTurn(message('e', [tool('5')]), 'other')), running)).toBeNull();
  expect(seam(whole(inTurn(message('f', [text('Go on')], 'user'), 'turn')), running)).toBeNull();
  // A system wake-up stays close to its answer, including an error, without joining another turn.
  const wake = whole(inTurn(message('wake', [text('Resumed after an error')], 'system'), 'turn'));
  expect(seam(wake, running)).toBe('block');
  expect(seam({ ...wake, message: { ...wake.message, turnId: 'other' } }, running)).toBeNull();
  expect(seam(tools, { ...running, first: false })).toBeNull();
  expect(seam(undefined, running)).toBeNull();
});

test('a long answer is cut into rows at its top-level blocks, ids kept through its stream and its end', () => {
  const para = (n: number) => `Paragraph ${n} ${'with words enough to fill a line '.repeat(8)}`.trim();
  const fence = ['```ts', ...Array.from({ length: 30 }, (_, i) => `const line${i} = ${i};`), '', 'const afterBlank = 1;', '```'].join('\n');
  const list = Array.from({ length: 40 }, (_, i) => `- item ${i} ${'in a long list '.repeat(4)}`).join('\n\n');
  const table = ['| a | b |', '| - | - |', ...Array.from({ length: 30 }, (_, i) => `| ${i} | ${'cell '.repeat(10)} |`)].join('\n');
  const text = [para(1), para(2), para(3), para(4), para(5), para(6), para(7), para(8), para(9), fence, para(10), list, para(11), table, ...Array.from({ length: 40 }, (_, i) => para(12 + i))].join('\n\n');
  expect(text.length).toBeGreaterThan(SPLIT_FROM);
  const cuts = textCuts(text);
  expect(cuts.length).toBeGreaterThan(1);
  for (const [index, at] of cuts.entries()) {
    // Each cut starts a block after a blank line, at least ROW_CHARS after the one before.
    expect(text.slice(at - 2, at)).toBe('\n\n');
    expect(at - (cuts[index - 1] ?? 0)).toBeGreaterThanOrEqual(ROW_CHARS);
    // Never inside the fence, the list or the table, and never on the line after the list.
    const before = text.slice(0, at);
    expect((before.match(/```/g) ?? []).length % 2).toBe(0);
    expect(text.slice(at).startsWith('- ') || text.slice(at).startsWith('|')).toBe(false);
    expect(at === text.indexOf(para(11))).toBe(false);
  }
  // A definition and its first use stay in the last row.
  const defined = `${text}\n\nSee [the guide][guide] and the note[^n].\n\n${para(60)}\n\n[guide]: https://example.com\n[^n]: A note.\n`;
  const withUse = textCuts(defined.replace(para(5), `${para(5)} [guide]`));
  expect(withUse.every(at => at <= defined.replace(para(5), `${para(5)} [guide]`).indexOf('[guide]'))).toBe(true);
  // Short answers are left whole.
  expect(textCuts(para(1))).toEqual([]);

  // Rows: the first keeps the message's id, then <message>#<part>.<block>; each draws its slice.
  const answer: Message = { id: 'm-a', threadId: 't', turnId: 'u', role: 'assistant', state: 'complete', createdAt: 0, parts: [{ type: 'text', text, complete: true }] };
  const rows = new TimelineRows().build([answer]);
  expect(rows.map(row => row.id)).toEqual(['m-a', ...cuts.map((_, index) => `m-a#0.${index + 1}`)]);
  expect(rows.map(row => row.text)).toEqual([{ start: 0, end: cuts[0] }, ...cuts.map((start, index) => cuts[index + 1] === undefined ? { start } : { start, end: cuts[index + 1] })]);
  expect(rows.map(row => text.slice(row.text!.start, row.text!.end)).join('')).toBe(text);
  // Each slice is estimated by its own characters, not the whole answer's.
  expect(rowEstimate(rows[1]!, 9000)).toBeLessThan(2000);

  // Streamed a line at a time, the rows are those of the prefix, the same ids, and the finished answer keeps them.
  const streamed = new TimelineRows();
  const lines = text.split('\n');
  const seen = new Map<string, number>();
  for (let count = 1; count <= lines.length; count += 1) {
    const prefix = lines.slice(0, count).join('\n') + (count < lines.length ? '\n' : '');
    const live: Message = { ...answer, state: 'streaming', parts: [{ type: 'text', text: prefix }] };
    for (const row of streamed.build([live])) if (!seen.has(row.id)) seen.set(row.id, row.text?.start ?? 0);
  }
  const done = streamed.build([answer]);
  expect(done.map(row => row.id)).toEqual(rows.map(row => row.id));
  expect([...seen.keys()]).toEqual(rows.map(row => row.id));
  expect(done.map(row => row.text?.start ?? 0)).toEqual(rows.map(row => seen.get(row.id)));
});

test('the bench answers of 20 to 40 KB are cut into rows of about ROW_CHARS', () => {
  let seed = 3;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const text = markdownAnswer(random, 30_000);
  const cuts = textCuts(text);
  expect(cuts.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...[0, ...cuts, text.length].slice(1).map((at, index) => at - ([0, ...cuts][index] ?? 0)))).toBeLessThan(3 * ROW_CHARS);
});

test('find opens the slice of a cut answer that holds the match, not its last slice', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const words = `The quokka opens this answer.\n\n${markdownAnswer(random, 15_000)}\n\nThe platypus sits in the middle.\n\n${markdownAnswer(random, 15_000)}\n\nA wombat closes it.`;
  const answer = message('m-long', [text(words)]);
  const rows = new TimelineRows().build([message('m-q', [text('Explain')], 'user'), answer]);
  const slices = rows.filter(row => row.message === answer);
  expect(slices.length).toBeGreaterThanOrEqual(5);
  const holding = (word: string) => {
    const [hit] = findHits([answer], word);
    const row = rows[rowIndexOf(rows, hit!.messageId, hit!.part, hit!.at)]!;
    expect(words.slice(row.text?.start, row.text?.end)).toContain(word);
    return slices.indexOf(row);
  };
  expect(holding('quokka')).toBe(0);
  expect(holding('platypus')).toBeGreaterThan(0);
  expect(holding('platypus')).toBeLessThan(slices.length - 1);
  expect(holding('wombat')).toBe(slices.length - 1);
  // No offset named: the first slice of the part, where a jump to the message opens.
  expect(rows[rowIndexOf(rows, 'm-long', 0)]).toBe(slices[0]);
});
