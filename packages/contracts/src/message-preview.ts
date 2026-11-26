import type { Message, MessagePart, ToolDocument } from './index';

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
const PATCH_START = /^(?:diff --git |--- |\*\*\* Begin Patch\r?$)/gm;
const PATCH_END = /^\*\*\* End Patch\r?$/gm;
const NON_CHANGE_TOOL_NAMES = new Set([
  'bash', 'shell', 'exec', 'execute', 'runshellcommand', 'command', 'powershell',
  'read', 'readfile', 'view', 'cat', 'notebookread',
  'grep', 'glob', 'search', 'find', 'ls', 'listdirectory', 'searchfiles',
  'webfetch', 'fetch', 'readurl',
]);
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'grantRoot'] as const;

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

/** Find the next `*** End Patch` end offset at or after `from`, advancing monotonically. */
function findEndPatch(value: string, from: number): number {
  PATCH_END.lastIndex = from;
  const match = PATCH_END.exec(value);
  if (!match) return -1;
  const line = lineAt(value, match.index);
  return line ? line.next : -1;
}

export function patchEndOffset(value: string, start: number, cachedEndPatch?: { pos: number }): number {
  const first = lineAt(value, start);
  if (!first) return start;
  if (first.text === '*** Begin Patch') {
    if (cachedEndPatch) {
      if (cachedEndPatch.pos === -1) return start;
      if (cachedEndPatch.pos < first.next) cachedEndPatch.pos = findEndPatch(value, first.next);
      return cachedEndPatch.pos === -1 ? start : cachedEndPatch.pos;
    }
    const end = findEndPatch(value, first.next);
    return end === -1 ? start : end;
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
  }
  const minus = lineAt(value, pos);
  const plus = minus ? lineAt(value, minus.next) : null;
  if (minus?.text.startsWith('--- ') && plus?.text.startsWith('+++ ')) {
    const firstHunk = plus.next;
    pos = hunkEndOffset(value, firstHunk);
    if (pos === firstHunk) return start;
    for (let next = hunkEndOffset(value, pos); next > pos; next = hunkEndOffset(value, pos)) pos = next;
    return pos;
  }
  return git && pos > first.next ? pos : start;
}

function extractPatches(value: string | null | undefined, keepRest: boolean): { patches: string[]; rest: string } {
  if (!value) return { patches: [], rest: '' };
  PATCH_START.lastIndex = 0;
  const endPatch = { pos: -2 };
  const patches: string[] = [];
  const rest: string[] = [];
  let cursor = 0;
  for (let match = PATCH_START.exec(value); match; match = PATCH_START.exec(value)) {
    const start = match.index;
    const end = patchEndOffset(value, start, endPatch);
    if (end === start) continue;
    if (keepRest && start > cursor) rest.push(value.slice(cursor, start));
    const slice = value.slice(start, end).replace(/\r?\n$/, '');
    patches.push(slice.includes('\r') ? slice.replace(/\r\n/g, '\n') : slice);
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

function diffOnlyInput(part: ToolPart, hasDiffDocs: boolean): unknown {
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
        if (!change || typeof change['path'] !== 'string' || typeof change['diff'] !== 'string' || !change['diff']) return [];
        return [{ path: change['path'], diff: change['diff'], ...(change['kind'] !== undefined ? { kind: change['kind'] } : {}) }];
      });
      if (changes.length) kept['changes'] = changes;
    }
    if (!hasDiffDocs && !NON_CHANGE_TOOL_NAMES.has(part.name.toLowerCase().replace(/[\s_-]/g, ''))) {
      const hasPath = PATH_KEYS.some(key => typeof fields[key] === 'string' && fields[key]);
      const hasEdit = typeof fields['old_string'] === 'string' || typeof fields['new_string'] === 'string';
      const hasWrite = typeof fields['content'] === 'string' || typeof fields['contents'] === 'string';
      if (hasPath && (hasEdit || hasWrite)) {
        for (const key of PATH_KEYS) if (typeof fields[key] === 'string' && fields[key]) kept[key] = fields[key];
        if (typeof fields['old_string'] === 'string') kept['old_string'] = fields['old_string'];
        if (typeof fields['new_string'] === 'string') kept['new_string'] = fields['new_string'];
        if (typeof fields['content'] === 'string') kept['content'] = fields['content'];
        if (typeof fields['contents'] === 'string') kept['contents'] = fields['contents'];
      }
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
 * breach `RPC_MAX_FRAME_BYTES`.
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
  const { patches } = extractPatches(part.output, false);
  return {
    ...base,
    input: diffOnlyInput(part, documents.length > 0),
    output: patches.length ? patches.join('\n\n') : null,
    ...(documents.length ? { documents } : {}),
  };
}

