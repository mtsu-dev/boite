import { messageMatchRanges, type Message, type MessageSearchTerm } from '@boite/contracts';
import { promptText, visibleAnswer } from './message-display';
import { planOf } from './plan';

/**
 * One occurrence of the query: in which message, which one there counting from
 * 0, in which of its parts and where in that part's shown text, so a long
 * message the timeline cut in several rows, or a long answer cut in slices, is
 * opened on the row that draws it.
 */
export interface FindHit {
  messageId: string;
  nth: number;
  part: number;
  at: number;
}

function occurrences(text: string, needle: string): number[] {
  if (!needle) return [];
  const hay = text.toLowerCase();
  const found: number[] = [];
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

/**
 * What each part of a message shows as text, in the order the page draws it:
 * the prompt, or the answer without its hidden markers, and a plan card's
 * plan. Other tool cards are folded to one line and left out.
 */
function readable(message: Message): { part: number; text: string }[] {
  return message.parts.flatMap((part, index) => {
    if (part.type === 'text') return [{ part: index, text: message.role === 'user' ? promptText(part) : visibleAnswer(part.text) }];
    if (part.type === 'tool') {
      const plan = planOf(part.name, part.input);
      return plan === null ? [] : [{ part: index, text: plan }];
    }
    return [];
  });
}

/**
 * Every occurrence of `query` in the thread, oldest first, without case. It
 * reads the messages, not the page, so a match in a message the window has not
 * drawn is still counted and can be jumped to.
 */
export function findHits(messages: readonly Message[], query: string): FindHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  // A query is one line, so no occurrence spans two parts: counted part by part, they are the message's.
  return messages.flatMap((message) => {
    let nth = 0;
    return readable(message).flatMap(({ part, text }) =>
      occurrences(text, needle).map((at) => ({ messageId: message.id, nth: nth++, part, at })));
  });
}

/** The ranges of `query` in the text drawn under `root`, without case, in reading order. */
export function findRanges(root: Node, query: string): Range[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

const ALL = 'boite-find';
const CURRENT = 'boite-find-current';
const MESSAGE_SEARCH = 'boite-message-search';

export function messageSearchPosition(message: Message, terms: MessageSearchTerm[]): { part: number; offset: number } | undefined {
  for (const { part, text } of readable(message)) {
    const first = messageMatchRanges(text, terms)[0];
    if (first) return { part, offset: first.start };
  }
}

export function paintMessageSearch(root: HTMLElement, terms: MessageSearchTerm[], selector = '[data-testid="text-part"], .part[data-kind="text"]'): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  const ranges: Range[] = [];
  for (const part of root.querySelectorAll(selector)) {
    const nodes: { node: Node; start: number; end: number }[] = [];
    let text = '';
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue ?? '';
      if (!value) continue;
      nodes.push({ node, start: text.length, end: text.length + value.length });
      text += value;
    }
    let cursor = 0;
    for (const { start, end } of messageMatchRanges(text, terms)) {
      while (nodes[cursor]!.end <= start) cursor++;
      const first = nodes[cursor]!;
      while (nodes[cursor]!.end < end) cursor++;
      const last = nodes[cursor]!;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
    }
  }
  if (ranges.length) CSS.highlights.set(MESSAGE_SEARCH, new Highlight(...ranges));
  else CSS.highlights.delete(MESSAGE_SEARCH);
}

export function clearMessageSearch(): void {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(MESSAGE_SEARCH);
}

/** Paints the matches with the CSS highlight API, which leaves the DOM alone. A browser without it paints nothing. */
export function paintFind(all: Range[], current: Range | null): void {
  const registry = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
  if (!registry || typeof Highlight === 'undefined') return;
  registry.set(ALL, new Highlight(...all));
  if (current) registry.set(CURRENT, new Highlight(current));
  else registry.delete(CURRENT);
}

export function clearFind(): void {
  const registry = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
  registry?.delete(ALL);
  registry?.delete(CURRENT);
}
