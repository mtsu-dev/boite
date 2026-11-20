/**
 * `usage.history` over a synthetic journal: 1,800 threads in 40 projects and
 * TURNS finished turns (default 110,000) spread over SPAN_DAYS (default 100),
 * ten messages each, 2.5% of them copied to `removed_turn_usage`. Prints the
 * first open (the migrations), then each range read cold (the file's pages
 * dropped from the OS cache, Linux) and warm (median of 5).
 *
 * bun bench/usage-history.ts [--root <checkout>] [--dir <dir>]
 *
 * `--root` measures another checkout's core on the same rows: the rows are
 * written into a journal that core creates. `--dir` keeps the journal there
 * (about 1.3 GB at the default size); otherwise it goes to a temporary folder
 * that is removed at the end.
 */
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
const root = resolve(option('--root') ?? join(import.meta.dir, '..'));
const kept = option('--dir');
const dir = kept ?? mkdtempSync(join(tmpdir(), 'boite-usage-bench-'));
mkdirSync(dir, { recursive: true });
const file = join(dir, 'journal.db');

type JournalModule = typeof import('../packages/core/src/journal.ts');
type UsageModule = typeof import('../packages/core/src/usage.ts');
const { Journal } = await import(`${root}/packages/core/src/journal.ts`) as JournalModule;
const { usageHistory } = await import(`${root}/packages/core/src/usage.ts`) as UsageModule;

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-19T18:00:00Z');
const SPAN = Number(process.env.SPAN_DAYS ?? 100);
const START = NOW - SPAN * DAY;
const TURNS = Number(process.env.TURNS ?? 110_000);
const BUCKETS_SINCE = NOW - 37 * DAY;

let seed = 42;
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
let serial = 0;
const id = (prefix: string) => `${prefix}${(serial++).toString(36).padStart(10, '0')}`;
const POOL = Array.from({ length: 70_000 }, () => 'abcdefghij klmnopqrstuvwxyz,.ABCDE\n'[Math.floor(random() * 37)]).join('');
const text = (length: number) => { const at = Math.floor(random() * (POOL.length - length)); return POOL.slice(at, at + length); };

const PROVIDERS = [
  { id: 'claude', weight: 0.55, models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'] },
  { id: 'codex', weight: 0.35, models: ['gpt-6', 'gpt-6-codex', 'gpt-6-mini'] },
  { id: 'opencode', weight: 0.07, models: ['kimi-k3', 'glm-5'] },
  { id: 'pi', weight: 0.03, models: ['claude-sonnet-5-5'] },
];
const providerOf = () => { let left = random(); for (const provider of PROVIDERS) if ((left -= provider.weight) < 0) return provider; return PROVIDERS[0]!; };

function usageOf(provider: string, finished: number): string | null {
  if (random() < 0.05) return null;
  const buckets = finished >= BUCKETS_SINCE ? { buckets: 1 } : {};
  if (provider === 'claude' || provider === 'pi') {
    const cacheWrite = Math.round(random() * 20_000);
    return JSON.stringify({
      inputTokens: Math.round(2 + random() * 60), outputTokens: Math.round(200 + random() * 5000),
      cacheReadTokens: Math.round(20_000 + random() * 180_000), cacheWriteTokens: cacheWrite,
      ...(finished >= BUCKETS_SINCE && random() < 0.5 ? { cacheWriteHourTokens: cacheWrite } : {}),
      ...buckets, costUsdEquivalent: Math.round(random() * 150_000) / 100_000,
    });
  }
  return JSON.stringify({
    inputTokens: Math.round(1000 + random() * 9000), outputTokens: Math.round(100 + random() * 3000),
    cacheReadTokens: Math.round(random() * 120_000), cacheWriteTokens: 0, ...buckets, costUsdEquivalent: null,
  });
}

/** Writes the rows straight into a journal the measured core created, then lets it open the file. */
async function generate(): Promise<number> {
  new Journal(file, { onError: () => {} }).close();
  const db = new Database(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF');
  const columns = db.query("SELECT name, type, \"notnull\" AS required, dflt_value AS fallback FROM pragma_table_info('threads')").all() as { name: string; type: string; required: number; fallback: string | null }[];
  const projects = Array.from({ length: 40 }, () => id('prj_'));
  const insertProject = db.query('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)');
  for (const project of projects) insertProject.run(project, project, `/home/u/${project}`, START);
  const named = ['id', 'project_id', 'title', 'provider_id', 'account_id', 'model', 'cwd', 'permission_mode', 'status', 'unread', 'archived', 'created_at', 'updated_at'];
  const written = columns.filter((column) => named.includes(column.name) || (column.required && column.fallback === null)).map((column) => column.name);
  const insertThread = db.query(`INSERT INTO threads (${written.join(', ')}) VALUES (${written.map(() => '?').join(', ')})`);
  const threads: { id: string; provider: (typeof PROVIDERS)[number]; model: string; start: number; end: number }[] = [];
  db.transaction(() => {
    for (let index = 0; index < 1800; index++) {
      const provider = providerOf();
      const start = START + random() * SPAN * DAY;
      const end = Math.min(NOW, start + 3_600_000 - Math.log(1 - random()) * 6 * DAY);
      const thread = { id: id('thr_'), provider, model: pick(provider.models), start, end };
      threads.push(thread);
      const values: Record<string, unknown> = {
        id: thread.id, project_id: pick(projects), title: `Thread ${index}`, provider_id: provider.id, account_id: `acc_${provider.id}`, model: thread.model,
        cwd: '/home/u/work', permission_mode: 'bypass', status: 'idle', unread: 0, archived: random() < 0.6 ? 1 : 0, created_at: Math.round(start), updated_at: Math.round(end),
      };
      insertThread.run(...written.map((name) => values[name] ?? (columns.find((column) => column.name === name)!.type.includes('INT') ? 0 : '')) as never[]);
    }
  })();
  const byDay: (typeof threads)[] = Array.from({ length: SPAN + 1 }, () => []);
  for (const thread of threads) for (let day = Math.floor((thread.start - START) / DAY); day <= Math.floor((thread.end - START) / DAY); day++) byDay[day]?.push(thread);
  const times = Array.from({ length: TURNS }, () => Math.round(START + random() * SPAN * DAY)).sort((a, b) => a - b);
  const insertTurn = db.query(`INSERT INTO turns (id, thread_id, status, queued_at, started_at, finished_at, usage, error, execution, checkpoint, queue_hold, agent_totals, quiet, switched)
    VALUES (?, ?, 'done', ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, 0, NULL)`);
  const insertMessage = db.query('INSERT INTO messages (id, thread_id, turn_id, role, parts, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertRemoved = db.query('INSERT INTO removed_turn_usage (finished_at, provider_id, model, usage) VALUES (?, ?, ?, ?)');
  for (let from = 0; from < TURNS; from += 2000) {
    db.transaction(() => {
      for (const finished of times.slice(from, from + 2000)) {
        const day = byDay[Math.floor((finished - START) / DAY)]!;
        const live = day.filter((thread) => thread.start <= finished && thread.end >= finished);
        const thread = live.length > 0 ? pick(live) : day.length > 0 ? pick(day) : pick(threads);
        const started = finished - Math.round(5_000 + random() * 600_000);
        const turnId = id('turn_');
        const model = random() < 0.1 ? pick(thread.provider.models) : thread.model;
        const execution = finished < START + 20 * DAY && random() < 0.5 ? null : JSON.stringify({ providerId: thread.provider.id, accountId: `acc_${thread.provider.id}`, model, effort: 'high' });
        for (let index = 0; index < 10; index++) {
          const parts = JSON.stringify([{ type: 'text', text: text(Math.min(60_000, Math.round(150 - Math.log(1 - random()) * 500))) }]);
          insertMessage.run(id('msg_'), thread.id, turnId, index === 0 ? 'user' : 'assistant', parts, 'complete', started + index * 1000);
        }
        insertTurn.run(turnId, thread.id, started - 200, started, finished, usageOf(thread.provider.id, finished), execution);
        if (random() < 0.025) insertRemoved.run(finished, thread.provider.id, model, usageOf(thread.provider.id, finished));
      }
    })();
  }
  // A core with `usage_slots` keeps them in its writers; rows written past them are summed once, as its migration does.
  const slots = `${root}/packages/core/src/journal/usage-slots.ts`;
  if (existsSync(slots)) {
    const { rebuildUsageSlots } = await import(slots) as typeof import('../packages/core/src/journal/usage-slots.ts');
    const at = performance.now();
    db.transaction(() => rebuildUsageSlots(db))();
    print({ slotsBuildMs: Math.round(performance.now() - at) });
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); ANALYZE');
  const bytes = (db.query('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()').get() as { bytes: number }).bytes;
  db.close();
  return bytes;
}

/** Drops the journal's clean pages from the OS cache (Linux, no root), so the next read comes from disk. */
function evict(): boolean {
  const paths = [file, `${file}-wal`, `${file}-shm`].filter((path) => existsSync(path));
  const script = 'import os,sys\nfor p in sys.argv[1:]:\n  f=os.open(p,os.O_RDONLY);os.fsync(f);os.posix_fadvise(f,0,0,os.POSIX_FADV_DONTNEED);os.close(f)';
  return process.platform === 'linux' && spawnSync('python3', ['-I', '-c', script, ...paths]).status === 0;
}

function dayEdges(days: number): number[] {
  const start = new Date(NOW);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return Array.from({ length: days + 1 }, (_, index) => { const edge = new Date(start); edge.setDate(start.getDate() + index); return edge.getTime(); });
}

const protocols: Record<string, string> = { claude: 'claude-sdk', codex: 'codex-appserver', opencode: 'acp', pi: 'pi' };
const print = (data: object) => console.log(JSON.stringify(data));
try {
  print({ date: new Date().toISOString(), bun: Bun.version, platform: process.platform, root });
  if (!existsSync(file)) print({ turns: TURNS, days: SPAN, bytes: await generate() });
  const cold = evict();
  let at = performance.now();
  const journal = new Journal(file, { onError: () => {} });
  print({ firstOpenMs: Math.round(performance.now() - at) });
  const core = { journal, providers: new Map(Object.entries(protocols).map(([provider, protocol]) => [provider, { id: provider, protocol }])) } as never;
  const read = (days: number) => (usageHistory(core, dayEdges(days)).rows as { turns: number }[]).reduce((sum, row) => sum + row.turns, 0);
  for (const days of [7, 30, 90]) {
    if (cold) evict();
    at = performance.now();
    const turns = read(days);
    const firstMs = Math.round(performance.now() - at);
    const runs = Array.from({ length: 5 }, () => { const start = performance.now(); read(days); return performance.now() - start; }).sort((a, b) => a - b);
    print({ days, turns, [cold ? 'coldMs' : 'firstMs']: firstMs, warmMedianMs: Math.round(runs[2]!) });
  }
  journal.close();
} finally {
  if (kept === undefined) rmSync(dir, { recursive: true, force: true });
}
