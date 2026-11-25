import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../ids.ts';

export const WEBHOOK_TRIGGER_ID = /^agt_trigger_[0-9a-z]{20}$/;

/** The core is the only writer. Each replacement gives the complete file owner-only permissions. */
export class TriggerSecrets {
  readonly #path: string;
  #entries: ReadonlyMap<string, string> | null = null;

  constructor(dataDir: string) {
    this.#path = join(dataDir, 'mochi-trigger-secrets.json');
  }

  get(id: string): string | undefined { return this.#read().get(id); }

  set(id: string, secret: string | undefined): void {
    const entries = new Map(this.#read());
    if (entries.get(id) === secret) return;
    if (secret === undefined) entries.delete(id);
    else entries.set(id, secret);
    this.#write(entries);
  }

  prune(keep: ReadonlySet<string>): void {
    const entries = this.#read();
    const live = new Map([...entries].filter(([id]) => keep.has(id)));
    if (live.size !== entries.size) this.#write(live);
  }

  #read(): ReadonlyMap<string, string> {
    if (this.#entries) return this.#entries;
    try {
      const stat = lstatSync(this.#path);
      if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
        throw new Error('mochi-trigger-secrets.json: expected an owner-only regular file');
      }
      const data: unknown = JSON.parse(readFileSync(this.#path, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid secrets file');
      const entries = new Map<string, string>();
      for (const [id, secret] of Object.entries(data)) {
        if (!WEBHOOK_TRIGGER_ID.test(id) || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) {
          throw new Error('invalid secrets file');
        }
        entries.set(id, secret);
      }
      return this.#entries = entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.#entries = new Map();
      // A JSON parse error can quote part of the input, which contains secrets.
      throw new Error('mochi-trigger-secrets.json: cannot read the owner-only secrets file');
    }
  }

  #write(entries: ReadonlyMap<string, string>): void {
    const temporary = this.#path + '.' + newId('tmp-');
    try {
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(entries)), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.#path);
    } catch (error) {
      try { rmSync(temporary, { force: true }); }
      catch { /* Keep the original file error. */ }
      throw error;
    }
    this.#entries = entries;
  }
}
