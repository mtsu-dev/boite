/**
 * What `bun run dev:instance` decides before it starts a core on the Dev data:
 * where that data is, whether another process holds it, whether this branch's
 * journal schema matches it, and how a copy of it is made.
 */
import { Database } from 'bun:sqlite';
import { cpSync, existsSync, lstatSync, mkdirSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SCHEMA_VERSION } from '../../packages/core/src/journal/schema.ts';
import { dataDirName, defaultDataDir } from '../../packages/core/src/paths.ts';
import { lockFile } from '../../packages/core/src/platform/index.ts';

export const BRANCH_SCHEMA = SCHEMA_VERSION;

/** The Dev channel's data directory, and never anything else: a wrong name here would be the stable data. */
export function devDataDir(): string {
  const directory = defaultDataDir('dev');
  if (basename(directory) !== dataDirName('dev')) throw new Error(`expected a ${dataDirName('dev')} directory, got ${directory}`);
  return directory;
}

/** `user_version` of `<dataDir>/journal.db`, or null when there is no journal. */
export function journalSchema(dataDir: string): number | null {
  const file = join(dataDir, 'journal.db');
  if (!existsSync(file)) return null;
  try {
    const db = new Database(file, { readonly: true });
    try {
      return (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    } finally {
      db.close();
    }
  } catch {
    // A journal SQLite will not open read-only: the header still carries the version, big-endian at byte 60.
    const header = Buffer.alloc(64);
    const fd = openSync(file, 'r');
    try {
      if (readSync(fd, header, 0, 64, 0) < 64) return 0;
    } finally {
      closeSync(fd);
    }
    return header.readUInt32BE(60);
  }
}

export type SchemaState =
  /** No journal, or one no core has stamped yet. */
  | { kind: 'empty' }
  | { kind: 'same'; found: number }
  /** This branch migrates the data when it opens it. */
  | { kind: 'older'; found: number; branch: number }
  /** The data was written by a newer build: this branch's core refuses it. */
  | { kind: 'newer'; found: number; branch: number };

export function schemaState(dataDir: string, branch: number = BRANCH_SCHEMA): SchemaState {
  const found = journalSchema(dataDir);
  if (found === null || found === 0) return { kind: 'empty' };
  if (found === branch) return { kind: 'same', found };
  return found < branch ? { kind: 'older', found, branch } : { kind: 'newer', found, branch };
}

export interface Holder {
  pid: number | null;
  /** The address `core.json` names, when it names the same process. */
  url: string | null;
  version: string | null;
  /** The holder's command line, where the OS gives it (Linux). */
  command: string | null;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The address a `core.json` names, on loopback when the core listens on every interface. */
export function coreUrl(record: Record<string, unknown>): string | null {
  if (typeof record.port !== 'number') return null;
  const bound = typeof record.host === 'string' ? record.host : '127.0.0.1';
  const host = bound === '0.0.0.0' || bound === '::' ? '127.0.0.1' : bound;
  return `http://${host.includes(':') ? `[${host}]` : host}:${record.port}`;
}

/**
 * Who holds `<dataDir>/core.lock`, or null when nobody does. The OS lock is
 * probed and let go at once; nothing is written and the holder is never touched.
 */
export function lockHolder(dataDir: string): Holder | null {
  const file = join(dataDir, 'core.lock');
  if (!existsSync(file)) return null;
  const probe = lockFile(file);
  if (probe) {
    probe.release();
    return null;
  }
  const pid = readJson(file)?.pid;
  const core = readJson(join(dataDir, 'core.json'));
  const same = core !== null && typeof pid === 'number' && core.pid === pid;
  let command: string | null = null;
  if (typeof pid === 'number') {
    try {
      command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') || null;
    } catch {
      // No procfs here: the pid is all there is.
    }
  }
  return {
    pid: typeof pid === 'number' ? pid : null,
    url: same ? coreUrl(core) : null,
    version: same && typeof core.version === 'string' ? core.version : null,
    command,
  };
}

/** What a copy leaves behind: the lock and address of the core that owns the original, its logs and its browser profile. */
const NOT_COPIED = new Set(['core.lock', 'core.json', 'core.starting.json', 'logs', 'webview', 'journal.db', 'journal.db-wal', 'journal.db-shm']);

/**
 * A copy of the Dev data in `target`. The journal goes through `VACUUM INTO`,
 * which reads one consistent snapshot even while a core writes the original.
 */
export function copyDevData(source: string, target: string): void {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  cpSync(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => {
      if (path === source) return true;
      if (NOT_COPIED.has(basename(path)) && join(source, basename(path)) === path) return false;
      const kind = lstatSync(path);
      // A socket or a pipe a running core left there is not data.
      return kind.isFile() || kind.isDirectory() || kind.isSymbolicLink();
    },
  });
  const journal = join(source, 'journal.db');
  if (!existsSync(journal)) return;
  const db = new Database(journal, { readonly: true });
  try {
    db.run('VACUUM INTO ?', [join(target, 'journal.db')]);
  } finally {
    db.close();
  }
}

const RUN = 'bun run dev:instance';

export const messages = {
  held(dataDir: string, holder: Holder): string {
    const who = holder.command?.includes('main.ts')
      ? 'a core started from sources (another checkout\'s dev:instance, or a core someone runs by hand)'
      : 'the Boite Dev app or another Dev core';
    return [
      `The Dev data ${dataDir} is in use: ${who} holds its core.lock.`,
      `  holder   pid ${holder.pid ?? 'not written yet'}${holder.version ? `, version ${holder.version}` : ''}${holder.url ? `, ${holder.url}` : ''}`,
      ...(holder.command ? [`  command  ${holder.command}`] : []),
      'Nothing was started and the holder was left alone. Choose one:',
      `  ${RUN} --copy      run this branch on a copy of the Dev data, removed at stop`,
      `  ${RUN} stop        from the checkout that started it, when it is a dev:instance`,
      '  or ask the owner to quit Boite Dev, then run this again',
    ].join('\n');
  },
  older(dataDir: string, found: number, branch: number): string {
    return [
      `This branch's journal schema (${branch}) is newer than the Dev data's (${found}) in ${dataDir}.`,
      'Opening it migrates the Dev data for good: an older build, the installed Boite Dev included, may then refuse to open it.',
      'Nothing was started. Choose one:',
      `  ${RUN} --copy      safe: run on a copy of the Dev data in a temporary directory, removed at stop`,
      `  ${RUN} --migrate   migrate the real Dev data; only when the owner agreed`,
    ].join('\n');
  },
  newer(dataDir: string, found: number, branch: number): string {
    return [
      `The Dev data ${dataDir} has journal schema ${found}, and this branch reads up to ${branch}: its core would refuse to open it.`,
      'Nothing was started. Choose one:',
      '  merge or rebase onto the branch that wrote it, then run this again',
      `  ${RUN} --scratch   run on empty temporary data, removed at stop`,
    ].join('\n');
  },
  empty(dataDir: string): string {
    return [
      `No Dev data yet: ${dataDir} has no journal, so this instance starts empty (no account, no project).`,
      'The owner sets it up once, in the page this instance serves or in the Boite Dev app: sign in an agent or add a gateway provider, then add projects.',
      'It stays set up for every later build.',
    ].join('\n');
  },
  nothingToCopy(dataDir: string): string {
    return `--copy needs Dev data to copy, and ${dataDir} has no journal. Run without --copy to start on it, or with --scratch for temporary data.`;
  },
  quota(echo: boolean): string {
    return echo
      ? 'BOITE_ECHO=1 is set: the echo provider is in the model list and its turns cost nothing. A turn on any other model still spends the owner\'s real quota.'
      : 'This data holds the owner\'s real accounts: every turn spends real quota. Keep turns few and short, or start with --echo and pick the echo provider for flows that need no real model.';
  },
};
