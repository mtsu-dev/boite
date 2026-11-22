import { hostname } from 'node:os';
import { FIXTURE_PROMPT, type FixtureHeader, type ProviderName } from './fixture.ts';

/** A recorded turn before anonymization. */
export interface Fixture { provider: ProviderName; agentVersion: string; model: string; lines: unknown[] }

export interface Machine { home: string; temp: string; user: string; host?: string }

/** Ids an agent mints: replaced by others of the same length and alphabet, the same id always by the same one. */
const ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?:msg|toolu|srvtoolu|call|ses|prt|req|resp|rs|fc|ws|ctc|acc|thr|prj|turn)_[A-Za-z0-9]{6,}\b/g;
/** Opaque blobs the model service signs: reasoning signatures and encrypted reasoning. */
const OPAQUE_KEYS = new Set(['signature', 'encrypted_content', 'encryptedContent']);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Where a recorded project lived: a temporary folder named by `record.ts`. */
const PROJECT = /boite-transfer-[A-Za-z0-9]+/;
const CORE_DATA = /boite-core-[A-Za-z0-9]+/;

/** A deterministic stream of characters, so a re-recording of the same turn anonymizes the same way. */
function seeded(seed: number): (alphabet: string) => string {
  let state = seed >>> 0;
  return (alphabet) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // The high bits: an LCG's low ones repeat with a short period.
    return alphabet[(state >>> 16) % alphabet.length]!;
  };
}

function alphabetOf(char: string): string {
  if (/[0-9a-f]/.test(char)) return '0123456789abcdef';
  if (/[a-z]/.test(char)) return 'abcdefghijklmnopqrstuvwxyz0123456789';
  if (/[A-Z]/.test(char)) return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return /[0-9]/.test(char) ? '0123456789' : char;
}

type Holder = Record<string, unknown>;
interface Piece { holder: Holder; key: string }

const record = (value: unknown): Holder | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Holder : undefined);

/**
 * The text an agent streams in pieces, grouped by the block, item or message
 * it belongs to. A path or an id can be cut across two pieces, so each group
 * is anonymized whole.
 */
function streamed(provider: ProviderName, lines: unknown[]): Piece[][] {
  const groups = new Map<string, Piece[]>();
  let message = 0;
  const add = (group: string, holder: Holder | undefined, key: string) => {
    if (holder === undefined || typeof holder[key] !== 'string') return;
    const pieces = groups.get(group) ?? [];
    pieces.push({ holder, key });
    groups.set(group, pieces);
  };
  for (const line of lines) {
    const value = record(line);
    if (value === undefined) continue;
    if (provider === 'claude') {
      const event = record(value['event']);
      if (value['type'] !== 'stream_event' || event === undefined) continue;
      if (event['type'] === 'message_start') message += 1;
      const delta = record(event['delta']);
      if (event['type'] !== 'content_block_delta' || delta === undefined) continue;
      const key = ['text', 'partial_json', 'thinking'].find((name) => typeof delta[name] === 'string');
      if (key !== undefined) add(`${String(value['parent_tool_use_id'])}:${message}:${String(event['index'])}`, delta, key);
    } else if (provider === 'codex') {
      const params = record(value['params']);
      if (typeof value['method'] === 'string' && value['method'].endsWith('elta') && params !== undefined) add(`${value['method']}:${String(params['itemId'])}`, params, 'delta');
    } else {
      const update = record(record(value['params'])?.['update']);
      const kind = update?.['sessionUpdate'];
      if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') add(`${kind}:${message}`, record(update?.['content']), 'text');
      else message += 1;
    }
  }
  return [...groups.values()];
}

/** `text` cut into as many pieces as `lengths`, each in proportion to the length it replaces. */
function recut(text: string, lengths: number[]): string[] {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const out: string[] = [];
  let from = 0;
  let seen = 0;
  for (const [index, length] of lengths.entries()) {
    seen += length;
    let to = index === lengths.length - 1 ? text.length : Math.round((seen * text.length) / Math.max(total, 1));
    // Never between the two halves of a surrogate pair.
    if (to > from && to < text.length && /[�-�]/.test(text[to]!)) to -= 1;
    to = Math.max(to, from);
    out.push(text.slice(from, to));
    from = to;
  }
  return out;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every spelling of `path` a stream may hold: as written, with forward slashes, and with a lower-case drive. */
function spellings(path: string): string[] {
  const forward = path.replace(/\\/g, '/');
  const lower = (value: string) => value.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
  // A path quoted inside a command line keeps its backslashes doubled.
  const doubled = path.replaceAll('\\', '\\\\');
  const variants = [doubled, lower(doubled), path, forward, lower(path), lower(forward), forward.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)];
  return [...new Set(variants)].filter((value) => value.length > 3).sort((a, b) => b.length - a.length);
}

/**
 * The fixture lines `record.ts` writes: a header, then `fixture.lines` with
 * the recording machine taken out. The project folder becomes `/workspace`,
 * the core's data folder `/data`, the temporary folder `/tmp`, the home folder
 * `/home/user`, the account name `user`, every e-mail `user@example.com`, each
 * minted id another of its length and each signed blob a seeded one.
 */
export function anonymize(fixture: Fixture, machine: Machine): unknown[] {
  const next = seeded(20261122);
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  const swap = (id: string): string => {
    let kept = ids.get(id);
    if (kept === undefined) {
      const cut = id.indexOf('_');
      const prefix = cut > 0 && !id.includes('-') ? id.slice(0, cut + 1) : '';
      // Two ids never share a stand-in: the driver tells a thread, a turn and an item apart by them.
      do kept = prefix + [...id.slice(prefix.length)].map((char) => (char === '-' ? '-' : next(alphabetOf(char)))).join('');
      while (taken.has(kept));
      ids.set(id, kept);
      taken.add(kept);
    }
    return kept;
  };
  const host = machine.host ?? hostname();
  const roots: [RegExp, string][] = [];
  const project = (text: string): string => {
    for (;;) {
      const found = new RegExp(`(?:[A-Za-z]:)?[^"'\\s]*?${PROJECT.source}`).exec(text);
      if (!found) return text;
      text = text.split(found[0]).join('/workspace');
    }
  };
  for (const [path, to] of [[machine.temp, '/tmp'], [machine.home, '/home/user']] as const) {
    for (const spelling of spellings(path)) roots.push([new RegExp(escapeRegExp(spelling), 'gi'), to]);
  }
  const text = (value: string): string => {
    let out = project(value).replace(new RegExp(`(?:[A-Za-z]:)?[^"'\\s]*?${CORE_DATA.source}`, 'g'), '/data');
    for (const [pattern, to] of roots) out = out.replace(pattern, to);
    // The shell an agent runs commands in, wherever it is installed.
    out = out.replace(/(?:[A-Za-z]:|\/home\/user)[^"'\n]{0,160}?[\\/]+(pwsh|powershell|cmd|bash)\.exe/gi, (_, shell: string) => `/usr/bin/${shell.toLowerCase()}`);
    // What follows a placeholder root reads as a POSIX path.
    out = out.replace(/(\/(?:data|tmp|home\/user|workspace))((?:\\+[^\\"'\s]+)+)/g, (_, root: string, rest: string) => root + rest.replace(/\\+/g, '/'));
    // The host first: its name often holds the account name.
    if (host.length >= 3) out = out.replace(new RegExp(`\\b${escapeRegExp(host)}\\b`, 'gi'), 'host');
    if (machine.user.length >= 3) out = out.replace(new RegExp(`\\b${escapeRegExp(machine.user)}\\b`, 'gi'), 'user');
    return out.replace(EMAIL, 'user@example.com').replace(ID, swap);
  };
  // Streamed pieces are anonymized as one text, then cut again; the walk leaves them be.
  const done = new WeakMap<Holder, Set<string>>();
  for (const pieces of streamed(fixture.provider, fixture.lines)) {
    const whole = text(pieces.map(({ holder, key }) => holder[key] as string).join(''));
    const cut = recut(whole, pieces.map(({ holder, key }) => (holder[key] as string).length));
    for (const [index, { holder, key }] of pieces.entries()) {
      holder[key] = cut[index];
      done.set(holder, (done.get(holder) ?? new Set<string>()).add(key));
    }
  }
  const walk = (value: unknown, key = '', parent?: Holder): unknown => {
    if (typeof value === 'string') {
      if (parent !== undefined && done.get(parent)?.has(key)) return value;
      if (OPAQUE_KEYS.has(key) && value.length > 0) return [...value].map((char) => next(alphabetOf(char))).join('');
      return text(value);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [text(name), walk(item, name, value as Holder)]));
    }
    return value;
  };
  const header: FixtureHeader = { fixture: 1, provider: fixture.provider, agentVersion: fixture.agentVersion, model: fixture.model, prompt: FIXTURE_PROMPT };
  return [header, ...fixture.lines.map((line) => walk(line))];
}

/** What no fixture may hold, each with the reason: a test reads every fixture against it. */
export const FORBIDDEN: [RegExp, string][] = [
  [/[A-Za-z]:[\\/]+Users[\\/]/i, 'a Windows home folder'],
  [/\/Users\/[^/\s"]+/, 'a macOS home folder'],
  [/\/home\/(?!user\b)[^/\s"]+/, 'a Linux home folder other than /home/user'],
  [/AppData/i, 'a Windows profile path'],
  [/boite-(?:transfer|core)-/, 'a recording folder'],
  [/[A-Za-z0-9._%+-]+@(?!example\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an e-mail address'],
  [/\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a key or token'],
  [/\b(?:access|refresh|id)_token\b/i, 'a token field'],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/, 'a bearer credential'],
];

/** `bun anonymize.ts <provider>...`: runs a fixture through again, after a rule was added. */
if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { homedir, tmpdir } = await import('node:os');
  const { fixturePath, readFixture } = await import('./fixture.ts');
  for (const provider of process.argv.slice(2) as ProviderName[]) {
    const { header, lines } = readFixture(provider, readFileSync(fixturePath(provider), 'utf8'));
    const again = anonymize({ provider, agentVersion: header.agentVersion, model: header.model, lines }, { home: homedir(), temp: tmpdir(), user: process.env.USERNAME ?? process.env.USER ?? '' });
    writeFileSync(fixturePath(provider), `${again.map((line) => JSON.stringify(line)).join('\n')}\n`);
    console.log(`${provider}: ${again.length - 1} lines`);
  }
}
