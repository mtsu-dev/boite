import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
 * only when the branch holds a message). Null without a readable session or a
 * model in it. The answer is kept until the file changes.
 */
export function sessionModelOf(dir: string, sessionId: string): SessionModel | null {
  try {
    const name = readdirSync(dir).find(entry => entry.endsWith(`_${sessionId}.jsonl`));
    if (name === undefined) return null;
    const path = join(dir, name);
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
