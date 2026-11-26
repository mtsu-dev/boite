import type { Message, MessagePart, ToolDocument } from './index';
import { isCompleteGitBinaryHunk, isGitBase85Line } from './git-binary';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

/** Folded tools need their label and error preview, not megabytes of command output. */
export const TOOL_OUTPUT_INLINE_CHARS = 16 * 1024;
export const TOOL_OUTPUT_PREVIEW_CHARS = 1024;
/**
 * The longest output a successful call keeps in a history page. A folded card
 * draws nothing of it, and a turn of 90 commands of a few kilobytes each made
 * pages of megabytes that no reader had opened; past this it stays on the
 * core with no preview, and opening the card fetches it.
 */
export const TOOL_OUTPUT_FOLDED_CHARS = 256;
/**
 * A tool input past this many serialized characters reaches a page as a
 * preview: a Write of a large file carries the whole file in its input, and
 * the card's line only needs the path or the command.
 */
export const TOOL_INPUT_INLINE_CHARS = 16 * 1024;
/** About how many serialized characters an input preview keeps. */
export const TOOL_INPUT_PREVIEW_CHARS = 4 * 1024;
/**
 * Tool documents past this many characters together stay on the core until
 * the card opens. A diff carries both whole texts of the file.
 */
export const TOOL_DOCUMENTS_INLINE_CHARS = 64 * 1024;

/**
 * Whether `value` holds more than `limit` characters of content, give or take
 * its punctuation. It stops as soon as it knows, so a 30 MB input costs the
 * first strings it meets, not a full `JSON.stringify`. Its JSON is at most six
 * UTF-8 bytes per character counted: `\u001f` is the longest escape.
 */
export function longerThan(value: unknown, limit: number): boolean {
  let total = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'string') total += item.length + 2;
    // A number's JSON runs to 24 characters: -1.2345678901234567e-308.
    else if (item === null || typeof item !== 'object') total += 24;
    else if (Array.isArray(item)) { total += 2; for (const entry of item) stack.push(entry); }
    else for (const [key, entry] of Object.entries(item)) { total += key.length + 4; stack.push(entry); }
    if (total > limit) return true;
  }
  return false;
}

/**
 * The same shape cut to about `budget` serialized characters: each string to
 * its first characters, arrays and objects to their first entries. The card
 * reads its line (a path, a command, a pattern) from the start of the input.
 */
export function inputPreview(value: unknown, budget = TOOL_INPUT_PREVIEW_CHARS): unknown {
  let left = budget;
  const cut = (item: unknown, depth: number): unknown => {
    if (typeof item === 'string') {
      const keep = Math.max(0, Math.min(item.length, TOOL_OUTPUT_PREVIEW_CHARS, left));
      left -= keep + 2;
      // Flattened: a slice can keep the original megabytes alive in V8.
      return keep === item.length ? item : item.slice(0, keep).split('').join('');
    }
    if (item === null || typeof item !== 'object') { left -= 8; return item; }
    left -= 2;
    if (Array.isArray(item)) {
      const out: unknown[] = [];
      if (depth < 6) for (const entry of item) { if (left <= 0) break; out.push(cut(entry, depth + 1)); }
      return out;
    }
    const out: Record<string, unknown> = {};
    if (depth < 6) {
      for (const [key, entry] of Object.entries(item)) {
        if (left <= 0) break;
        left -= key.length + 4;
        out[key] = cut(entry, depth + 1);
      }
    }
    return out;
  };
  return cut(value, 0);
}

/** Characters of content the documents carry: texts and base64. */
function documentChars(documents: readonly ToolDocument[]): number {
  let total = 0;
  for (const doc of documents) {
    total += doc.kind === 'diff' ? doc.oldText.length + doc.newText.length + doc.path.length
      : doc.kind === 'markdown' ? doc.text.length : doc.data.length;
  }
  return total;
}

/** What a folded card shows of a document: its kind, path, title or caption, not its content. */
function documentStub(doc: ToolDocument): ToolDocument {
  if (doc.kind === 'diff') return { kind: 'diff', path: doc.path, oldText: '', newText: '' };
  if (doc.kind === 'markdown') return { kind: 'markdown', title: doc.title, text: '' };
  return { kind: 'image', mimeType: doc.mimeType, data: '', alt: doc.alt };
}

export interface ToolPreviewOptions {
  /** Inputs and documents too, for a client that sent `compactToolParts`. */
  inputs?: boolean;
  /** Defer every finished call's content whatever its size: the message is still too heavy. */
  strict?: boolean;
  /**
   * Read from history, where the card is folded: a successful call keeps no
   * output past `TOOL_OUTPUT_FOLDED_CHARS`. A failed or refused one keeps its
   * preview, which the opened card shows while the rest arrives. Live events
   * leave it out, so a card open on a running call keeps what it showed.
   */
  folded?: boolean;
}

/**
 * One finished tool call as a page sends it: a long output as its preview,
 * and with `inputs` a long input as its preview and heavy documents as stubs.
 * `messages.toolPart` hands the whole call back when the card opens. A running
 * call stays whole: its output is still streaming.
 */
export function previewToolPart(part: ToolPart, options: ToolPreviewOptions = {}): ToolPart {
  if (part.status === 'running') return part;
  const strict = options.strict === true;
  let next = part;
  const output = part.output;
  if (options.folded && part.status === 'done' && output !== null && output.length > (part.outputDeferred ? 0 : TOOL_OUTPUT_FOLDED_CHARS)) {
    // A preview read from `part_blobs` is cut too: no folded line reads it.
    next = { ...next, output: '', outputDeferred: true };
  } else if (!part.outputDeferred && output !== null && output.length > (strict ? TOOL_OUTPUT_PREVIEW_CHARS : TOOL_OUTPUT_INLINE_CHARS)) {
    // A slice can retain the original megabytes in V8. Flatten the bounded
    // preview before keeping it in a browser's reading cache.
    next = { ...next, output: output.slice(0, TOOL_OUTPUT_PREVIEW_CHARS).split('').join(''), outputDeferred: true };
  }
  if (!options.inputs) return next;
  if (!part.inputDeferred && longerThan(part.input, strict ? TOOL_INPUT_PREVIEW_CHARS : TOOL_INPUT_INLINE_CHARS)) {
    next = { ...next, input: inputPreview(part.input), inputDeferred: true };
  }
  const documents = part.documents;
  if (!part.documentsDeferred && documents && documents.length > 0 && (strict ? documentChars(documents) > 0 : documentChars(documents) > TOOL_DOCUMENTS_INLINE_CHARS)) {
    next = { ...next, documents: documents.map(documentStub), documentsDeferred: true };
  }
  return next;
}

/** Project snapshots only: long outputs of finished calls as their preview. */
export function previewToolOutputs(messages: readonly Message[]): Message[] {
  return messages.map(message => {
    let changed = false;
    const parts = message.parts.map(part => {
      if (part.type !== 'tool') return part;
      const next = previewToolPart(part);
      if (next !== part) changed = true;
      return next;
    });
    return changed ? { ...message, parts } : message;
  });
}

const DIFF_HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const DIFF_NO_NEWLINE = '\\ No newline at end of file';
const DIFF_GIT_HEADER = /^(?:index [\da-f]+\.\.[\da-f]+(?: \d+)?|(?:(?:old|new|new file|deleted file) mode) \d+|(?:dis)?similarity index \d+%|(?:rename|copy) (?:from|to) .+|Binary files .+ differ)$/;
const GIT_BINARY_HEADER = /^(?:literal|delta) (\d+)$/;
const APPLY_FILE_HEADER = /^\*\*\* (?:Add|Delete|Update) File: .+$/;
const PATCH_START = /^(?:diff --git |--- |\*\*\* Begin Patch\r?$)/gm;
const PATCH_MARKER = /^\*\*\* (?:Begin|End) Patch\r?$/gm;

export type ToolFamily = 'command' | 'edit' | 'write' | 'read' | 'search' | 'fetch' | 'web' | 'agent' | 'other';

/** Tool names, lowered and stripped of `_`, `-` and spaces, and the family each one is. */
const TOOL_FAMILY_BY_NAME: Record<string, ToolFamily> = {
  bash: 'command', shell: 'command', exec: 'command', execute: 'command', runshellcommand: 'command', command: 'command', powershell: 'command',
  edit: 'edit', multiedit: 'edit', strreplace: 'edit', strreplacebasededittool: 'edit', applypatch: 'edit', patch: 'edit', notebookedit: 'edit', replace: 'edit',
  write: 'write', writefile: 'write', create: 'write', createfile: 'write',
  read: 'read', readfile: 'read', view: 'read', cat: 'read', notebookread: 'read',
  grep: 'search', glob: 'search', search: 'search', find: 'search', ls: 'search', listdirectory: 'search', searchfiles: 'search',
  webfetch: 'fetch', fetch: 'fetch', readurl: 'fetch',
  websearch: 'web', googlesearch: 'web',
  task: 'agent', agent: 'agent',
};

function bodyOf(fields: Record<string, unknown>): string | null {
  if (typeof fields['content'] === 'string') return fields['content'];
  return typeof fields['contents'] === 'string' ? fields['contents'] : null;
}

/** Classify a tool call by its known name, falling back to the shape of its original input. */
export function toolFamily(name: string, fields: Record<string, unknown>): ToolFamily {
  const key = name.toLowerCase().replace(/[\s_-]/g, '');
  const named = TOOL_FAMILY_BY_NAME[key];
  if (named) return named;
  if (typeof fields['command'] === 'string' || Array.isArray(fields['command']) || typeof fields['cmd'] === 'string') return 'command';
  if ('old_string' in fields || 'new_string' in fields || Array.isArray(fields['edits'])) return 'edit';
  if (bodyOf(fields) !== null && (typeof fields['file_path'] === 'string' || typeof fields['path'] === 'string')) return 'write';
  if (typeof fields['url'] === 'string') return 'fetch';
  if (typeof fields['query'] === 'string') return 'web';
  if (typeof fields['pattern'] === 'string') return 'search';
  if ('grantRoot' in fields) return 'edit';
  return 'other';
}

/** File diff implied directly by an edit/write tool's original input fields, when no diff document is attached. */
export function toolInputDiff(name: string, input: unknown): Extract<ToolDocument, { kind: 'diff' }> | null {
  const fields = recordOf(input);
  if (!fields) return null;
  const family = toolFamily(name, fields);
  const path = typeof fields['file_path'] === 'string' && fields['file_path'] ? fields['file_path']
    : typeof fields['path'] === 'string' && fields['path'] ? fields['path']
    : typeof fields['notebook_path'] === 'string' && fields['notebook_path'] ? fields['notebook_path']
    : typeof fields['grantRoot'] === 'string' && fields['grantRoot'] ? fields['grantRoot']
    : '';
  if (!path) return null;
  if (family === 'edit' && (typeof fields['old_string'] === 'string' || typeof fields['new_string'] === 'string')) {
    return {
      kind: 'diff',
      path,
      oldText: typeof fields['old_string'] === 'string' ? fields['old_string'] : '',
      newText: typeof fields['new_string'] === 'string' ? fields['new_string'] : '',
    };
  }
  const body = bodyOf(fields);
  if (family === 'write' && body !== null) {
    return { kind: 'diff', path, oldText: '', newText: body };
  }
  return null;
}

function lineAt(value: string, pos: number): { text: string; next: number } | null {
  if (pos >= value.length) return null;
  const nl = value.indexOf('\n', pos);
  const end = nl === -1 ? value.length : nl;
  const next = nl === -1 ? value.length : nl + 1;
  const text = end > pos && value.charCodeAt(end - 1) === 13 ? value.slice(pos, end - 1) : value.slice(pos, end);
  return { text, next };
}

function hunkEndOffset(value: string, start: number): number {
  const head = lineAt(value, start);
  const header = head ? DIFF_HUNK.exec(head.text) : null;
  if (!head || !header) return start;
  let before = Number(header[1] ?? 1);
  let after = Number(header[2] ?? 1);
  let pos = head.next;
  while (before > 0 || after > 0) {
    const line = lineAt(value, pos);
    const prefix = line?.text[0];
    if (prefix === ' ' || prefix === '-') before--;
    if (prefix === ' ' || prefix === '+') after--;
    if (!line || (prefix !== ' ' && prefix !== '-' && prefix !== '+')) return start;
    if (before < 0 || after < 0) return start;
    pos = line.next;
    const peek = lineAt(value, pos);
    if (peek?.text === DIFF_NO_NEWLINE) pos = peek.next;
  }
  return pos;
}

/** Consume a `GIT binary patch` section (forward and optional reverse base85 hunks). */
function binaryPatchEndOffset(value: string, start: number): number {
  const head = lineAt(value, start);
  if (!head || head.text !== 'GIT binary patch') return start;
  let pos = head.next;
  let lastValid = start;
  for (let sections = 0; sections < 2; sections++) {
    const section = lineAt(value, pos);
    const header = section ? GIT_BINARY_HEADER.exec(section.text) : null;
    if (!section || !header) break;
    const expectedSize = Number(header[1]);
    let cur = section.next;
    const lines: string[] = [];
    let terminated = false;
    for (; ;) {
      const line = lineAt(value, cur);
      if (!line) break;
      if (line.text === '') { cur = line.next; terminated = true; break; }
      if (!isGitBase85Line(line.text)) return start;
      lines.push(line.text);
      cur = line.next;
    }
    if (!lines.length || !isCompleteGitBinaryHunk(lines, expectedSize, terminated)) return start;
    lastValid = cur;
    pos = cur;
    if (!terminated) break;
  }
  return lastValid;
}

/** Validate `apply_patch` file headers and hunk lines between `*** Begin Patch` and `*** End Patch`. */
function isValidApplyPatch(value: string, from: number, end: number): boolean {
  let pos = from;
  let files = 0;
  let mode: null | 'add' | 'delete' | 'update-head' | 'update-hunk' | 'update-eof' = null;
  let moved = false;
  let sawHunkLine = false;
  while (pos < end) {
    const line = lineAt(value, pos);
    if (!line) break;
    pos = line.next;
    const text = line.text;
    if (APPLY_FILE_HEADER.test(text)) {
      if (mode === 'update-head' && !moved) return false;
      if (mode === 'update-hunk' && !sawHunkLine) return false;
      files++;
      moved = false;
      sawHunkLine = false;
      mode = text.startsWith('*** Add File: ') ? 'add'
        : text.startsWith('*** Delete File: ') ? 'delete'
        : 'update-head';
      continue;
    }
    if (mode === 'add') {
      if (!text.startsWith('+')) return false;
      continue;
    }
    if (mode === 'delete') return false;
    if (mode === 'update-head') {
      if (!moved && text.startsWith('*** Move to: ') && text.length > '*** Move to: '.length) {
        moved = true;
        continue;
      }
      if (text === '') continue;
      if (text === '@@' || text.startsWith('@@ ')) {
        mode = 'update-hunk';
        sawHunkLine = false;
        continue;
      }
      const prefix = text[0];
      if (prefix === ' ' || prefix === '+' || prefix === '-') {
        mode = 'update-hunk';
        sawHunkLine = true;
        continue;
      }
      return false;
    }
    if (mode === 'update-hunk') {
      if (text === '@@' || text.startsWith('@@ ')) {
        if (!sawHunkLine) return false;
        sawHunkLine = false;
        continue;
      }
      if (text === '*** End of File') {
        if (!sawHunkLine) return false;
        mode = 'update-eof';
        continue;
      }
      const prefix = text[0];
      if (text === '' || prefix === ' ' || prefix === '+' || prefix === '-') {
        sawHunkLine = true;
        continue;
      }
      return false;
    }
    if (mode === 'update-eof') {
      if (text.trim() === '') continue;
      return false;
    }
    return false;
  }
  if (mode === 'update-head' && !moved) return false;
  if (mode === 'update-hunk' && !sawHunkLine) return false;
  return files > 0;
}

/**
 * Find the matching `*** End Patch` after `from` without crossing a newer
 * `*** Begin Patch` and verify the body follows `apply_patch` grammar, so
 * unclosed headers or diagnostic logs cannot leak into diffs and each byte is
 * scanned at most once across `extractPatches`.
 */
function findEndPatch(value: string, from: number): number {
  PATCH_MARKER.lastIndex = from;
  const match = PATCH_MARKER.exec(value);
  if (!match || match[0].startsWith('*** Begin')) return -1;
  if (!isValidApplyPatch(value, from, match.index)) return -1;
  const line = lineAt(value, match.index);
  return line ? line.next : -1;
}

function patchEnd(value: string, start: number): { end: number; kind: 'apply' | 'binary' | 'diff' } {
  const first = lineAt(value, start);
  if (!first) return { end: start, kind: 'diff' };
  if (first.text === '*** Begin Patch') {
    const end = findEndPatch(value, first.next);
    return { end: end === -1 ? start : end, kind: 'apply' };
  }
  let pos = start;
  const git = first.text.startsWith('diff --git ');
  if (git) {
    pos = first.next;
    for (; ;) {
      const line = lineAt(value, pos);
      if (!line || !DIFF_GIT_HEADER.test(line.text)) break;
      pos = line.next;
    }
    if (lineAt(value, pos)?.text === 'GIT binary patch') {
      const binEnd = binaryPatchEndOffset(value, pos);
      return { end: binEnd > pos ? binEnd : start, kind: 'binary' };
    }
  }
  const minus = lineAt(value, pos);
  const plus = minus ? lineAt(value, minus.next) : null;
  if (minus?.text.startsWith('--- ') && plus?.text.startsWith('+++ ')) {
    const firstHunk = plus.next;
    pos = hunkEndOffset(value, firstHunk);
    if (pos === firstHunk) return { end: start, kind: 'diff' };
    for (let next = hunkEndOffset(value, pos); next > pos; next = hunkEndOffset(value, pos)) pos = next;
    return { end: pos, kind: 'diff' };
  }
  return { end: git && pos > first.next ? pos : start, kind: 'diff' };
}

export function patchEndOffset(value: string, start: number): number {
  return patchEnd(value, start).end;
}

function extractPatches(value: string | null | undefined, keepRest: boolean): { patches: string[]; rest: string } {
  if (!value) return { patches: [], rest: '' };
  PATCH_START.lastIndex = 0;
  const patches: string[] = [];
  const rest: string[] = [];
  let cursor = 0;
  for (let match = PATCH_START.exec(value); match; match = PATCH_START.exec(value)) {
    const start = match.index;
    const { end, kind } = patchEnd(value, start);
    if (end === start) continue;
    if (keepRest && start > cursor) rest.push(value.slice(cursor, start));
    const raw = value.slice(start, end);
    let slice: string;
    if (kind === 'binary') {
      // Preserve or restore the terminating blank line required by `git apply` for binary hunks.
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      slice = raw.endsWith('\n\n') || raw.endsWith('\r\n\r\n') ? raw
        : raw.endsWith('\r\n') ? `${raw}\r\n`
        : raw.endsWith('\n') ? `${raw}\n`
        : `${raw}${eol}${eol}`;
    } else if (kind === 'apply') {
      slice = raw.replace(/\r?\n$/, '');
    } else {
      // Preserve exact diff line bytes (including `\r` on CRLF lines) instead of normalizing `\r\n`.
      slice = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    }
    patches.push(slice);
    cursor = end;
    PATCH_START.lastIndex = end;
  }
  if (!patches.length) return { patches, rest: keepRest ? value : '' };
  if (keepRest && cursor < value.length) rest.push(value.slice(cursor));
  return { patches, rest: keepRest ? rest.join('').replace(/\r\n/g, '\n').trim() : '' };
}

/** A hunk's counts distinguish a context line from an indented log after it. */
export function extractToolPatches(value: string | null | undefined): { patches: string[]; rest: string } {
  return extractPatches(value, true);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function diffOnlyInput(part: ToolPart): unknown {
  const fields = recordOf(part.input);
  if (fields) {
    const kept: Record<string, unknown> = {};
    if (typeof fields['command'] === 'string') {
      const { patches } = extractPatches(fields['command'], false);
      if (patches.length) kept['command'] = patches.join('\n\n');
    }
    if (Array.isArray(fields['changes'])) {
      const changes = fields['changes'].flatMap(entry => {
        const change = recordOf(entry);
        if (!change || typeof change['path'] !== 'string' || !change['path'] || typeof change['diff'] !== 'string') return [];
        const kindType = recordOf(change['kind'])?.['type'] ?? change['kind'];
        if (!change['diff'] && kindType !== 'add' && kindType !== 'delete') return [];
        return [{ path: change['path'], diff: change['diff'], ...(change['kind'] !== undefined ? { kind: change['kind'] } : {}) }];
      });
      if (changes.length) kept['changes'] = changes;
    }
    if (Object.keys(kept).length > 0) return kept;
  }
  const raw = typeof part.input === 'string' ? part.input : part.inputText;
  const { patches } = extractPatches(raw, false);
  return patches.length ? patches.join('\n\n') : null;
}

/**
 * Strip non-diff payloads from a tool call for `messages.toolPart` with
 * `diffsOnly: true` so large unrelated outputs, inputs or documents do not
 * breach `RPC_MAX_FRAME_BYTES`. Classifies edit/write inputs against the
 * original input shape before stripping fields, so removing `command` cannot
 * turn a command tool into a synthetic file write.
 */
export function projectToolDiffs(part: ToolPart): ToolPart {
  const base: ToolPart = {
    type: 'tool',
    toolId: part.toolId,
    name: part.name,
    input: null,
    output: null,
    status: part.status,
    ...(part.exitCode !== undefined ? { exitCode: part.exitCode } : {}),
    ...(part.startedAt !== undefined ? { startedAt: part.startedAt } : {}),
    ...(part.finishedAt !== undefined ? { finishedAt: part.finishedAt } : {}),
  };
  if (part.status !== 'done') return base;
  const documents = part.documents?.filter(doc => doc.kind === 'diff') ?? [];
  if (documents.length === 0 && typeof part.inputText !== 'string') {
    const inferred = toolInputDiff(part.name, part.input);
    if (inferred) documents.push(inferred);
  }
  const { patches } = extractPatches(part.output, false);
  return {
    ...base,
    input: diffOnlyInput(part),
    output: patches.length ? patches.join('\n\n') : null,
    ...(documents.length ? { documents } : {}),
  };
}

