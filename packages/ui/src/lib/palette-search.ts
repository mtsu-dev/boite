import { foldSearch, originalSearchRange, type SearchRange } from '@boite/contracts';

export type FieldName = 'title' | 'project' | 'model' | 'branch' | 'pr' | 'machine' | 'parent' | 'keywords';
export type ThreadField = { field: FieldName; text: string };
export type MatchHint = { field: Exclude<FieldName, 'title' | 'keywords'>; text: string; ranges: SearchRange[] };

const penalties: Record<FieldName, number> = { title: 0, project: 9, model: 15, branch: 22, pr: 22, machine: 28, parent: 30, keywords: 34 };

interface Word extends SearchRange { value: string; raw: string }
function fieldsOf(text: string): Word[] {
  const pattern = /[\p{Lu}]?[\p{Ll}\p{M}]+|\p{Lu}+(?=\p{Lu}\p{Ll}|[^\p{L}]|$)|\p{N}+|\p{L}+/gu;
  return Array.from(text.matchAll(pattern), ({ 0: raw, index }) => ({ value: foldSearch(raw), raw, start: index, end: index + raw.length }));
}

function oneEdit(a: string, b: string): boolean {
  if (a.length < 3 || /^\d+$/u.test(a) || Math.abs(a.length - b.length) > 1) return false;
  const firstSwap = a[0] === b[1] && a[1] === b[0] && a.slice(2) === b.slice(2);
  if (a[0] !== b[0]) return firstSwap;
  let i = 1;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return a.slice(i + 1) === b.slice(i + 1)
    || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

interface FieldMatch { score: number; range: SearchRange }

function matchTerm(needle: string, exact: boolean, tokens: string[], text: string, words: Word[]): FieldMatch | null {
  if (!exact && tokens.length === 1 && tokens[0] === needle) return bestWord(needle, words);
  const folded = foldSearch(text);
  const literal = folded.indexOf(needle);
  if (literal >= 0) return { score: exact ? 115 : 108, range: originalSearchRange(text, folded, literal, literal + needle.length) };
  if (exact) return null;
  const parts = tokens.map(token => bestWord(token, words));
  if (parts.length === 0 || parts.some(part => part === null)) return null;
  const matches = parts as FieldMatch[];
  return {
    score: Math.min(...matches.map(match => match.score)) - 5,
    range: { start: Math.min(...matches.map(match => match.range.start)), end: Math.max(...matches.map(match => match.range.end)) },
  };
}

function bestWord(needle: string, words: Word[]): FieldMatch | null {
  // A pure number names a PR (or another number) exactly.
  const number = /^\d+$/u.test(needle);
  let best: FieldMatch | null = null;
  const put = (score: number, start: number, end: number) => {
    if (!best || score > best.score) best = { score, range: { start, end } };
  };
  for (const [index, word] of words.entries()) {
    const { value, start, end } = word;
    if (value === needle) put(index === 0 ? 105 : 100, start, end);
    else if (!number) {
      const at = value.indexOf(needle);
      if (at >= 0) {
        const range = originalSearchRange(word.raw, value, at, at + needle.length);
        put(at > 0 ? 72 : index === 0 ? 94 : 90, start + range.start, start + range.end);
      }
      else if (oneEdit(needle, value)) put(67, start, end);
      let joined = value;
      for (let next = index + 1; next < words.length && joined.length < needle.length && needle.startsWith(joined); next++) {
        const tail = words[next]!;
        joined += tail.value;
        if (joined === needle) put(93, start, tail.end);
      }
    }
  }
  return best;
}

export function mergeSearchRanges(ranges: SearchRange[]): SearchRange[] {
  const merged: SearchRange[] = [];
  for (const { start, end } of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged.at(-1);
    if (last && last.end >= start) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

export function matchThreadFields(query: string, fields: readonly ThreadField[]): { score: number; titleRanges: SearchRange[]; matchHint?: MatchHint } | null {
  const terms = Array.from(query.matchAll(/"([^"]*)"|([^\s"]+)/gu), match => {
    const raw = (match[1] ?? match[2] ?? '').trim().replace(/^#(?=\d)/u, '');
    return { needle: foldSearch(raw), exact: match[1] !== undefined, tokens: fieldsOf(raw).map(word => word.value) };
  }).filter(term => term.needle.length > 0);
  if (!terms.length) return null;
  const prepared = fields.map(field => ({ ...field, words: fieldsOf(field.text) }));
  const titleRanges: SearchRange[] = [];
  let hint: MatchHint | undefined;
  let score = 0;
  for (const { needle, exact, tokens } of terms) {
    const candidates = prepared.flatMap(({ field, text, words }) => {
      const match = matchTerm(needle, exact, tokens, text, words);
      return match ? [{ field, text, range: match.range, score: match.score - penalties[field] }] : [];
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;
    score += best.score;
    const title = candidates.find(candidate => candidate.field === 'title');
    if (title && (best.field === 'title' || title.score >= 90)) {
      titleRanges.push(title.range);
      continue;
    }
    if (best.field === 'title' || best.field === 'keywords') continue;
    if (hint?.field === best.field && hint.text === best.text) hint.ranges.push(best.range);
    else if (!hint || hint.field === 'project') hint = { field: best.field, text: best.text, ranges: [best.range] };
  }
  return { score: score / terms.length, titleRanges: mergeSearchRanges(titleRanges), ...(hint ? { matchHint: { ...hint, ranges: mergeSearchRanges(hint.ranges) } } : {}) };
}
