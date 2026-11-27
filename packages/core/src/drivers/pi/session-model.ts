import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isRecord } from '../stdio.ts';
import { VIRTUAL_API } from './protocol.ts';

/**
 * What a session branch records about its model, as `<provider>/<id>`.
 * `model` is the newest `model_change`, or the model of the newest answer.
 * `router` is the `model_change` before that answer when it names another
 * model: pi resumes on it while it is a registered virtual model, which
 * answers through physical ones.
 */
export interface SessionModel { model: string; router: string | null }

const READ_LIMIT = 256;
const read = new Map<string, { stamp: string; model: SessionModel | null }>();

/**
 * The model pi resumes a session on when no `--model` is given (pi 1.6.1
 * `getBranchSelection` in core/virtual-models.js, used by `createAgentSession`
 * only when the branch holds a message). The file is the one pi opens for
 * `--session-id` and `--session-dir` from `cwd`. Null without a readable
 * session or a model in it. The answer is kept until the file changes.
 */
export function sessionModelOf(dir: string, sessionId: string, cwd: string): SessionModel | null {
  try {
    const path = resumedFile(dir, sessionId, cwd);
    if (path === null) return null;
    const stat = statSync(path);
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const known = read.get(path);
    if (known?.stamp === stamp) return known.model;
    const model = branchModel(branchOf(readFileSync(path, 'utf8')));
    read.delete(path);
    read.set(path, { stamp, model });
    if (read.size > READ_LIMIT) read.delete(read.keys().next().value!);
    return model;
  } catch {
    return null;
  }
}

/**
 * The folder pi sees as `process.cwd()` when started in `cwd`, which it writes
 * in a session header and matches a resumed one against: Linux and macOS
 * resolve symbolic links, Windows keeps the path it was given.
 */
export function piProcessCwd(cwd: string): string {
  if (process.platform === 'win32') return win32.resolve(cwd);
  try {
    return realpathSync(cwd);
  } catch {
    return posix.resolve(cwd);
  }
}

/**
 * Whether the folder's own pi settings (`.pi/settings.json`, read by pi when it
 * trusts the project) may choose the model a new session starts on, which the
 * account's probe, run elsewhere, cannot see: pi 1.6.1 `findInitialModel` takes
 * `enabledModels` first, then `defaultProvider` and `defaultModel`.
 */
export function projectPicksModel(cwd: string): boolean {
  try {
    const settings: unknown = JSON.parse(readFileSync(join(piProcessCwd(cwd), '.pi', 'settings.json'), 'utf8'));
    return isRecord(settings) && (settings['defaultModel'] !== undefined || settings['defaultProvider'] !== undefined
      || (Array.isArray(settings['enabledModels']) && settings['enabledModels'].length > 0));
  } catch {
    return false;
  }
}

/**
 * pi 1.6.1 `SessionManager.findById` with a session directory of its own: the
 * first `.jsonl` file, in directory order, whose header has this id and pi's `cwd`.
 */
function resumedFile(dir: string, sessionId: string, cwd: string): string | null {
  const paths = process.platform === 'win32' ? win32 : posix;
  const key = (path: string) => process.platform === 'win32' ? paths.resolve(path).toLowerCase() : paths.resolve(path);
  const wanted = key(piProcessCwd(cwd));
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const path = join(dir, name);
    const header = headerOf(path);
    if (header?.['id'] === sessionId && typeof header['cwd'] === 'string' && header['cwd'] !== '' && key(header['cwd']) === wanted) return path;
  }
  return null;
}

const HEADER_SCAN = 1024 * 1024;

/** pi's discovery header: the first non-blank line that parses, if it is a session. */
function headerOf(path: string): Record<string, unknown> | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(4096);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    for (let scanned = 0; scanned < HEADER_SCAN;) {
      const length = readSync(fd, buffer, 0, Math.min(buffer.length, HEADER_SCAN - scanned), null);
      const ended = length === 0;
      scanned += length;
      pending += ended ? decoder.end() : decoder.write(buffer.subarray(0, length));
      const lines = pending.split('\n');
      pending = ended ? '' : lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry: unknown;
        try { entry = JSON.parse(line); } catch { continue; }
        return isRecord(entry) && entry['type'] === 'session' && typeof entry['id'] === 'string' ? entry : null;
      }
      if (ended) return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The entries from the root to the last one, skipping lines pi would skip. */
function branchOf(text: string): Record<string, unknown>[] {
  const entries = new Map<string, Record<string, unknown>>();
  let leaf: unknown = null;
  for (const line of text.split('\n')) {
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    if (isRecord(entry) && entry['type'] !== 'session' && typeof entry['id'] === 'string') {
      entries.set(entry['id'], entry);
      leaf = entry['id'];
    }
  }
  const branch: Record<string, unknown>[] = [];
  for (const seen = new Set<unknown>(); typeof leaf === 'string' && !seen.has(leaf);) {
    seen.add(leaf);
    const entry = entries.get(leaf);
    if (entry === undefined) break;
    branch.unshift(entry);
    leaf = entry['parentId'];
  }
  return branch;
}

function branchModel(branch: Record<string, unknown>[]): SessionModel | null {
  if (!branch.some(entry => entry['type'] === 'message')) return null;
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]!;
    const change = changeOf(entry);
    if (change) return { model: change, router: null };
    const message = isRecord(entry['message']) ? entry['message'] : null;
    // A failed routing leaves the virtual model on its message; pi skips it.
    if (entry['type'] !== 'message' || message?.['role'] !== 'assistant' || message['api'] === VIRTUAL_API) continue;
    const answered = typeof message['provider'] === 'string' && typeof message['model'] === 'string' ? `${message['provider']}/${message['model']}` : null;
    if (answered === null) return null;
    let router: string | null = null;
    for (let before = index - 1; before >= 0 && router === null; before--) router = changeOf(branch[before]!);
    return { model: answered, router: router === answered ? null : router };
  }
  return null;
}

function changeOf(entry: Record<string, unknown>): string | null {
  return entry['type'] === 'model_change' && typeof entry['provider'] === 'string' && typeof entry['modelId'] === 'string'
    ? `${entry['provider']}/${entry['modelId']}` : null;
}
