import { diffRowsOf } from './diff';
import type { TurnDiff } from './turn-files';

const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const NO_NEWLINE = '\\ No newline at end of file';
const GIT_HEADER = /^(?:index [\da-f]+\.\.[\da-f]+(?: \d+)?|(?:(?:old|new|new file|deleted file) mode) \d+|(?:dis)?similarity index \d+%|(?:rename|copy) (?:from|to) .+|Binary files .+ differ)$/;

function hunkEnd(lines: string[], start: number): number {
  const header = HUNK.exec(lines[start] ?? '');
  if (!header) return start;
  let before = Number(header[1] ?? 1);
  let after = Number(header[2] ?? 1);
  let end = start + 1;
  while (before > 0 || after > 0) {
    const prefix = lines[end]?.[0];
    if (prefix === ' ' || prefix === '-') before--;
    if (prefix === ' ' || prefix === '+') after--;
    if (prefix !== ' ' && prefix !== '-' && prefix !== '+') return start;
    if (before < 0 || after < 0) return start;
    end++;
    if (lines[end] === NO_NEWLINE) end++;
  }
  return end;
}

function patchEnd(lines: string[], start: number): number {
  if (lines[start] === '*** Begin Patch') {
    const end = lines.indexOf('*** End Patch', start + 1);
    return end === -1 ? start : end + 1;
  }
  let end = start;
  const git = lines[start]?.startsWith('diff --git ');
  if (git) {
    end++;
    while (GIT_HEADER.test(lines[end] ?? '')) end++;
  }
  if (lines[end]?.startsWith('--- ') && lines[end + 1]?.startsWith('+++ ')) {
    const firstHunk = end + 2;
    end = hunkEnd(lines, firstHunk);
    if (end === firstHunk) return start;
    for (let next = hunkEnd(lines, end); next > end; next = hunkEnd(lines, end)) end = next;
    return end;
  }
  return git && end > start + 1 ? end : start;
}

/** A hunk's counts distinguish a context line from an indented log after it. */
export function extractToolPatches(value: string | null | undefined): { patches: string[]; rest: string } {
  if (!value || !/^(?:diff --git |--- |\*\*\* Begin Patch\r?$)/m.test(value)) return { patches: [], rest: value ?? '' };
  const lines = value.split(/\r?\n/);
  const patches: string[] = [];
  const rest: string[] = [];
  for (let start = 0; start < lines.length;) {
    const end = patchEnd(lines, start);
    if (end === start) rest.push(lines[start++]!);
    else {
      patches.push(lines.slice(start, end).join('\n'));
      start = end;
    }
  }
  return { patches, rest: patches.length ? rest.join('\n').trim() : value };
}

function diffHeader(path: string): string {
  const display = path.replace(/[\r\n]+/g, ' ');
  return `--- ${display}\n+++ ${display}`;
}

export function diffText(diff: TurnDiff): string {
  const lines: string[] = [];
  let oldAt = 1;
  let newAt = 1;
  let hunk: string[] = [];
  let removed = 0;
  let added = 0;
  function flush(): void {
    if (!hunk.length) return;
    lines.push(`@@ -${oldAt - Number(removed === 0)},${removed} +${newAt - Number(added === 0)},${added} @@`, hunk.join('\n'));
    oldAt += removed;
    newAt += added;
    hunk = [];
    removed = added = 0;
  }
  for (const row of diffRowsOf(diff)) {
    if (row.kind === 'gap') {
      flush();
      oldAt += row.hidden;
      newAt += row.hidden;
      continue;
    }
    hunk.push(`${row.kind === 'context' ? ' ' : row.kind === 'add' ? '+' : '-'}${row.text}`);
    if (row.kind !== 'add') removed++;
    if (row.kind !== 'remove') added++;
  }
  flush();
  return lines.length ? `${diffHeader(diff.path)}\n${lines.join('\n')}` : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Codex updates can carry just the hunks, and adds/deletes can carry file contents. */
function codexPatch(path: string, diff: string, kind: unknown): string {
  if (diff.startsWith('@@')) return `${diffHeader(path)}\n${diff}`;
  if (patchEnd(diff.split(/\r?\n/), 0) > 0) return diff;
  const type = record(kind)?.['type'] ?? kind;
  if (type === 'add' || type === 'delete') {
    return diffText({ kind: 'diff', path, oldText: type === 'delete' ? diff : '', newText: type === 'add' ? diff : '' });
  }
  return diff;
}

export function extractInputPatches(input: unknown, inputText: string | null | undefined): { patches: string[]; rest: string } {
  const fields = record(input);
  if (fields) {
    const rest = { ...fields };
    const patches: string[] = [];
    if (typeof fields['command'] === 'string') {
      const command = extractToolPatches(fields['command']);
      patches.push(...command.patches);
      rest['command'] = command.rest;
    }
    if (Array.isArray(fields['changes'])) {
      rest['changes'] = fields['changes'].map((entry: unknown) => {
        const change = record(entry);
        if (!change) return entry;
        const { path, diff, kind, ...metadata } = change;
        if (typeof path !== 'string' || typeof diff !== 'string' || !diff) return entry;
        patches.push(codexPatch(path, diff, kind));
        return { path, kind, ...metadata };
      });
    }
    if (patches.length) return { patches, rest: JSON.stringify(rest, null, 2) };
  }
  return extractToolPatches(inputText ?? (typeof input === 'string' ? input : JSON.stringify(input, null, 2)));
}
