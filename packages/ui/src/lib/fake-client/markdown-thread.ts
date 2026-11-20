import type { Message, Thread, Turn } from '@boite/contracts';
import { T0 } from './shared.ts';

/**
 * A thread of long written answers, what `?fake=1&markdown=1` adds: twenty
 * turns, each a short question and an answer of 20 to 40 KB of Markdown, its
 * headings, lists, tables, quotes and fenced code. What a heavy conversation
 * costs to open when the weight is in the text the page parses, not in tool
 * calls (`bench/ui-frames.ts`, "open heavy thread"). Deterministic: one seed.
 */
const MARKDOWN_THREAD = 't-markdown';

function generator(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = 'the window keeps rows near the view measured and drops the others while a reader scrolls through answers written with `code` spans **bold** words and [links](https://example.com/docs) between plain sentences about caches parsers workers and frames'.split(' ');

function sentence(random: () => number, words: number): string {
  const out: string[] = [];
  for (let index = 0; index < words; index += 1) out.push(WORDS[Math.floor(random() * WORDS.length)]!);
  const text = out.join(' ');
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

function paragraph(random: () => number): string {
  return Array.from({ length: 3 + Math.floor(random() * 4) }, () => sentence(random, 8 + Math.floor(random() * 14))).join(' ');
}

function code(random: () => number, index: number): string {
  const lines = Array.from({ length: 8 + Math.floor(random() * 18) }, (_, line) => `  const value${line} = compute(input.items[${line}], ${Math.floor(random() * 1000)}); // step ${line}`);
  return ['```ts', `export function section${index}(input: { items: number[] }): number {`, ...lines, '  return value0;', '}', '```'].join('\n');
}

function block(random: () => number, index: number): string {
  const kind = Math.floor(random() * 6);
  if (kind === 0) return code(random, index);
  if (kind === 1) return Array.from({ length: 3 + Math.floor(random() * 5) }, () => `- ${sentence(random, 6 + Math.floor(random() * 10))}`).join('\n');
  if (kind === 2) return ['| Step | Cost | Note |', '| --- | ---: | --- |', ...Array.from({ length: 4 + Math.floor(random() * 6) }, (_, row) => `| ${row + 1} | ${Math.floor(random() * 900)} ms | ${sentence(random, 5)} |`)].join('\n');
  if (kind === 3) return `> ${sentence(random, 14)}`;
  return paragraph(random);
}

export function markdownAnswer(random: () => number, size: number): string {
  const blocks: string[] = [];
  let length = 0;
  for (let index = 0; length < size; index += 1) {
    const next = index % 9 === 0 ? `## Part ${index / 9 + 1}\n\n${paragraph(random)}` : block(random, index);
    blocks.push(next);
    length += next.length + 2;
  }
  return blocks.join('\n\n');
}

export function markdownThread(): Thread {
  const random = generator(0x15_11_2026);
  const messages: Message[] = [];
  const turns: Turn[] = [];
  // Older than every seeded thread: the list opens elsewhere and the bench opens this one in its measured window.
  let at = T0 - 30 * 86_400_000;
  const createdAt = at;
  for (let turn = 0; turn < 20; turn += 1) {
    const turnId = `turn-markdown-${turn}`;
    const startedAt = at;
    messages.push({ id: `m-markdown-${turn}-q`, threadId: MARKDOWN_THREAD, turnId, role: 'user', state: 'complete', createdAt: at, parts: [{ type: 'text', text: sentence(random, 16) }] });
    at += 1000;
    messages.push({ id: `m-markdown-${turn}-a`, threadId: MARKDOWN_THREAD, turnId, role: 'assistant', state: 'complete', createdAt: at, parts: [{ type: 'text', text: markdownAnswer(random, 20_000 + Math.floor(random() * 20_000)), complete: true }] });
    at += 60_000;
    turns.push({ id: turnId, threadId: MARKDOWN_THREAD, status: 'done', queuedAt: startedAt, startedAt, finishedAt: at, usage: null, error: null });
  }
  return {
    id: MARKDOWN_THREAD, projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default',
    archived: false, pinned: false, title: 'Long written answers', titleSource: 'prompt', cwd: 'C:\\src\\boite', branch: null,
    status: 'idle', unread: false, sessionId: 'sess-markdown', load: null, context: null,
    createdAt, updatedAt: at, messagesBefore: null, commands: [], turns, messages
  };
}
