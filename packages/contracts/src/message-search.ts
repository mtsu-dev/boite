import type { MessageId, ThreadId, Timestamp } from './ids';
import type { Message } from './messages';

export interface ThreadMessageMatch {
  threadId: ThreadId;
  messageId: MessageId;
  role: 'user' | 'assistant';
  snippet: string;
  messageCreatedAt: Timestamp;
  score: number;
}

export const MESSAGE_SEARCH_QUERY_LIMIT = 200;
export const MESSAGE_SEARCH_RESULT_LIMIT = 50;

export interface SearchRange { start: number; end: number }
export interface MessageSearchTerm { words: string[]; exact: boolean }

export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Convert offsets in folded text back to the original string for display. */
export function originalSearchRange(text: string, folded: string, start: number, end: number): SearchRange {
  if (text.length === folded.length) return { start, end };
  let consumed = 0;
  let offset = 0;
  let originalStart = 0;
  for (const character of text) {
    const length = foldSearch(character).length;
    if (length > 0) {
      if (consumed >= end) break;
      if (consumed <= start) originalStart = offset;
      consumed += length;
    }
    offset += character.length;
  }
  return { start: originalStart, end: offset };
}

export function messageSearchTerms(query: string): MessageSearchTerm[] {
  return Array.from(query.matchAll(/"([^"]*)"|([^\s"]+)/gu)).flatMap<MessageSearchTerm>(match => {
    const words = Array.from((match[1] ?? match[2] ?? '').matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu), word => foldSearch(word[0]));
    return words.length && match[1] !== undefined ? [{ words, exact: true }] : words.map(word => ({ words: [word], exact: false }));
  });
}

export function searchableMessageText(message: Pick<Message, 'parts'>): string {
  return message.parts.flatMap(part => part?.type === 'text' ? [part.displayText ?? part.text] : []).join('\n');
}

interface Word extends SearchRange { value: string; raw: string }
function wordsOf(text: string): Word[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu), ({ 0: word, index }) =>
    ({ value: foldSearch(word), raw: word, start: index, end: index + word.length }));
}

interface Match extends SearchRange { quality: number; term: number }
function rangesOf(text: string, terms: readonly MessageSearchTerm[]): Match[] {
  const words = wordsOf(text);
  const matches: Match[] = [];
  for (const [index, word] of words.entries()) {
    for (const [term, { words: needle, exact }] of terms.entries()) {
      const first = needle[0]!;
      if (needle.every((value, offset) => words[index + offset]?.value === value)) {
        matches.push({ start: word.start, end: words[index + needle.length - 1]!.end, quality: 3, term });
        continue;
      }
      if (exact || first.length < 3) continue;
      const at = word.value.indexOf(first);
      if (at < 0 || (at > 0 && (first.length < 4 || /^[a-f0-9]{8,}$/u.test(word.value)))) continue;
      const range = originalSearchRange(word.raw, word.value, at, at + first.length);
      matches.push({ start: word.start + range.start, end: word.start + range.end, quality: at === 0 ? 2 : 1, term });
    }
  }
  return matches;
}

export function messageMatchRanges(text: string, terms: readonly MessageSearchTerm[]): SearchRange[] {
  const merged: SearchRange[] = [];
  for (const { start, end } of rangesOf(text, terms).sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = merged.at(-1);
    if (previous && start < previous.end) previous.end = Math.max(previous.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

/** Choose the closest window containing every term, and preserve the original text in the excerpt. */
export function gradeMessage(text: string, terms: readonly MessageSearchTerm[]): Pick<ThreadMessageMatch, 'score' | 'snippet'> | null {
  if (!terms.length) return null;
  const body = text.replace(/\s+/gu, ' ').trim();
  const matches = rangesOf(body, terms).sort((a, b) => a.start - b.start);
  const counts = new Map<number, number>();
  let left = 0;
  let best: (SearchRange & { width: number }) | undefined;
  const qualities = new Map<number, number>();
  for (const match of matches) {
    qualities.set(match.term, Math.max(qualities.get(match.term) ?? 0, match.quality));
    counts.set(match.term, (counts.get(match.term) ?? 0) + 1);
    while (counts.size === terms.length) {
      const first = matches[left++]!;
      const width = Math.max(first.end, match.end) - first.start;
      if (!best || width < best.width) best = { start: first.start, end: first.start + width, width };
      const count = counts.get(first.term)!;
      if (count === 1) counts.delete(first.term);
      else counts.set(first.term, count - 1);
    }
  }
  if (!best) return null;
  const phrase = terms.flatMap(term => term.words).join(' ');
  const folded = terms.length > 1 ? foldSearch(body) : '';
  const exact = new RegExp(`(^|[^\\p{L}\\p{N}])(${phrase})(?![\\p{L}\\p{N}])`, 'u').exec(folded);
  const score = (exact ? 200 : terms.length > 1 && best.width <= 60 ? 100 : 0)
    + [...qualities.values()].reduce((sum, quality) => sum + quality, 0) / terms.length;
  const exactAt = exact ? exact.index + exact[1]!.length : -1;
  const span = exactAt < 0 ? best : originalSearchRange(body, folded, exactAt, exactAt + phrase.length);
  const center = (span.start + span.end) / 2;
  const start = Math.max(0, Math.min(body.length - 120, Math.floor(center - 60)));
  const end = Math.min(body.length, start + 120);
  const snippet = `${start ? '... ' : ''}${body.slice(start, end).trim()}${end < body.length ? ' ...' : ''}`;
  return { score, snippet };
}

export function orderMessageMatches(a: ThreadMessageMatch, b: ThreadMessageMatch): number {
  return b.score - a.score || b.messageCreatedAt - a.messageCreatedAt || a.messageId.localeCompare(b.messageId);
}
