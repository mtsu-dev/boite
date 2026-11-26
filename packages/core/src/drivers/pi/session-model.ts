import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from '../stdio.ts';

const read = new Map<string, { stamp: string; model: string | null }>();

/**
 * The model pi resumes a session on when no `--model` is given, as
 * `<provider>/<id>`: walking back from the last entry, the newest
 * `model_change` or assistant answer on that branch (pi 1.6.1
 * `getBranchSelection`). Null without a readable session or a model in it.
 * The answer is kept until the file changes.
 */
export function sessionModelOf(dir: string, sessionId: string): string | null {
  let path: string;
  try {
    const name = readdirSync(dir).find(entry => entry.endsWith(`_${sessionId}.jsonl`));
    if (name === undefined) return null;
    path = join(dir, name);
    const stat = statSync(path);
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const known = read.get(path);
    if (known?.stamp === stamp) return known.model;
    const entries = new Map<string, Record<string, unknown>>();
    let leaf: unknown = null;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      if (isRecord(entry) && entry['type'] !== 'session' && typeof entry['id'] === 'string') {
        entries.set(entry['id'], entry);
        leaf = entry['id'];
      }
    }
    let model: string | null = null;
    for (const seen = new Set<unknown>(); typeof leaf === 'string' && !seen.has(leaf);) {
      seen.add(leaf);
      const entry = entries.get(leaf);
      if (entry === undefined) break;
      const message = isRecord(entry['message']) ? entry['message'] : {};
      const [provider, id] = entry['type'] === 'model_change' ? [entry['provider'], entry['modelId']]
        : message['role'] === 'assistant' ? [message['provider'], message['model']] : [];
      if (typeof provider === 'string' && typeof id === 'string') { model = `${provider}/${id}`; break; }
      leaf = entry['parentId'];
    }
    read.set(path, { stamp, model });
    return model;
  } catch {
    return null;
  }
}
