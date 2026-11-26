import { extractToolPatches, patchEndOffset } from '@boite/contracts';
import { diffRowsOf } from './diff';
import type { TurnDiff } from './turn-files';

export { extractToolPatches };

const NO_NEWLINE = '\\ No newline at end of file';

function diffHeader(path: string): string {
  const display = path.replace(/[\r\n]+/g, ' ');
  return `--- ${display}\n+++ ${display}`;
}

function lineCount(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length - 1; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}

function lastLine(text: string): string {
  const end = text.endsWith('\n') ? text.length - 1 : text.length;
  const prev = text.lastIndexOf('\n', end - 1);
  return text.slice(prev + 1, end);
}

export function diffText(diff: TurnDiff): string {
  const oldCount = lineCount(diff.oldText);
  const newCount = lineCount(diff.newText);
  const oldNoNewline = oldCount > 0 && !diff.oldText.endsWith('\n');
  const newNoNewline = newCount > 0 && !diff.newText.endsWith('\n');
  const lines: string[] = [];
  let oldAt = 1;
  let newAt = 1;
  let hunk: string[] = [];
  let removed = 0;
  let added = 0;
  let sawEof = false;
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
    if (row.kind === 'context') {
      const oldMissing = row.oldLine === oldCount && oldNoNewline;
      const newMissing = row.newLine === newCount && newNoNewline;
      if (row.oldLine === oldCount && row.newLine === newCount) sawEof = true;
      if (oldMissing !== newMissing) {
        hunk.push(`-${row.text}`);
        if (oldMissing) hunk.push(NO_NEWLINE);
        hunk.push(`+${row.text}`);
        if (newMissing) hunk.push(NO_NEWLINE);
      } else {
        hunk.push(` ${row.text}`);
        if (oldMissing) hunk.push(NO_NEWLINE);
      }
      removed++;
      added++;
      continue;
    }
    if (row.kind === 'remove') {
      hunk.push(`-${row.text}`);
      if (row.oldLine === oldCount) {
        sawEof = true;
        if (oldNoNewline) hunk.push(NO_NEWLINE);
      }
      removed++;
      continue;
    }
    hunk.push(`+${row.text}`);
    if (row.newLine === newCount) {
      sawEof = true;
      if (newNoNewline) hunk.push(NO_NEWLINE);
    }
    added++;
  }
  flush();
  if (!sawEof && oldCount > 0 && newCount > 0 && oldNoNewline !== newNoNewline) {
    // diffRows strips a single trailing newline; emit a hunk when the final line's newline changed outside visible hunks.
    const last = lastLine(diff.oldText);
    const body = [
      `-${last}`,
      ...(oldNoNewline ? [NO_NEWLINE] : []),
      `+${last}`,
      ...(newNoNewline ? [NO_NEWLINE] : []),
    ];
    lines.push(`@@ -${oldCount},1 +${newCount},1 @@`, body.join('\n'));
  }
  return lines.length ? `${diffHeader(diff.path)}\n${lines.join('\n')}` : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Codex updates can carry just the hunks, and adds/deletes can carry file contents. */
function codexPatch(path: string, diff: string, kind: unknown): string {
  if (diff.startsWith('@@')) return `${diffHeader(path)}\n${diff}`;
  if (patchEndOffset(diff, 0) > 0) return diff;
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
