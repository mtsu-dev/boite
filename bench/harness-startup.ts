/**
 * How long each installed harness takes from a sent prompt to its first word,
 * through a real core on a fresh data directory and the agents' own logins.
 * Every run is a new thread, the case a user meets when a draft is sent: the
 * thread does not exist until then, so nothing was prepared for it.
 *
 *   BOITE_BENCH_HARNESS=1 bun run bench/harness-startup.ts [--runs 3] [--providers codex,claude] [--ab-titles] [--verbose] [--core <main.ts>]
 *
 * `--core` measures another checkout's core instead of this one's.
 * `--ab-titles` adds a row per harness where the echo provider writes the
 * titles, so the first turn runs without the title call beside it.
 * Providers and variants take turns inside each run, in reverse order every
 * other run, so a load spike or a warm cache lands on all of them. Each run spends one short turn per row on the
 * provider's account.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { MessagePart, ProviderId } from '../packages/contracts/src/index.ts';
import { connect } from '../packages/core/src/client.ts';
import { removeDirectory, startCore } from '../tests/e2e/lib/core.ts';
import { CORE_COMMAND } from './boite2.ts';
import { median } from './lib/report.ts';

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const RUNS = Number(flag('runs', '3'));
const WANTED = flag('providers', '').split(',').filter((id) => id.length > 0);
const VERBOSE = process.argv.includes('--verbose');
const CORE_MAIN = flag('core', '');
const PROMPT = 'Reply with exactly the word: ok';
const TURN_TIMEOUT_MS = 180_000;

if (process.env.BOITE_BENCH_HARNESS !== '1') throw new Error('set BOITE_BENCH_HARNESS=1: every run spends a turn on the real agents');

interface Run {
  /** turns.start sent to the start of the agent's own process, not a helper the core runs. */
  spawnMs: number;
  /** turns.start sent to the first word of the answer's text, reasoning left out. */
  firstWordMs: number;
  totalMs: number;
  /** Processes the thread started during the turn, the title call's included. */
  processes: number;
}

const variants: { name: string; titleModel: { providerId: ProviderId; model: string } | null }[] = [{ name: 'default', titleModel: null }];
if (process.argv.includes('--ab-titles')) variants.push({ name: 'echo titles', titleModel: { providerId: 'echo' as ProviderId, model: 'echo' } });

const core = await startCore({ command: CORE_MAIN === '' ? CORE_COMMAND : ['bun', 'run', CORE_MAIN], env: { BOITE_HOST_AGENTS: '1', BOITE_BENCH_HARNESS: '1' } });
const client = await connect(core.url, core.token, { client: { name: 'bench', version: '0' } });
const directory = mkdtempSync(join(tmpdir(), 'boite-bench-harness-'));
const results = new Map<string, Run[]>();
try {
  const project = await client.call('projects.add', { path: directory, name: 'bench' });
  const accounts = await client.call('accounts.list', {});
  const executables = new Map((await client.call('providers.list', {})).loaded.map((provider) => [provider.id, provider.executable]));
  const providers = [...new Set(accounts.filter((account) => account.status === 'ok' && account.providerId !== 'echo').map((account) => account.providerId))]
    .filter((id) => WANTED.length === 0 || WANTED.includes(id));
  if (providers.length === 0) throw new Error('no logged-in agent on this machine');
  console.log(`[bench] ${providers.join(', ')} x ${variants.map((variant) => variant.name).join(', ')}; ${RUNS} runs`);

  for (let index = 0; index < RUNS; index += 1) {
    for (const providerId of providers) {
      // Every other run plays the variants backwards: the row after a pause
      // starts on colder caches than the one right behind it.
      for (const variant of index % 2 === 0 ? variants : [...variants].reverse()) {
        const account = accounts.find((entry) => entry.providerId === providerId && entry.status === 'ok');
        if (account === undefined) continue;
        await client.call('settings.set', { titleModel: variant.titleModel });
        const thread = await client.call('threads.create', {
          projectId: project.id,
          providerId: providerId as ProviderId,
          accountId: account.id,
          permissionMode: 'bypassPermissions',
        });
        await client.call('threads.subscribe', { threadId: thread.id });
        const executable = executables.get(providerId as ProviderId) ?? null;
        // The type of each part of the thread's messages, to tell answer text from reasoning.
        const parts = new Map<string, string>();
        let processes = 0;
        let firstSpawn = 0;
        let firstWord = 0;
        let sentAt = 0;
        // A text part may come whole, with no delta after it.
        const written = (part: MessagePart): void => {
          if (firstWord === 0 && part.type === 'text' && part.text.trim().length > 0) firstWord = performance.now();
        };
        const offStarted = client.on('message.started', (message) => {
          if (message.threadId !== thread.id || message.role !== 'assistant') return;
          message.parts.forEach((part, at) => { parts.set(`${message.id}:${at}`, part.type); written(part); });
        });
        const offPart = client.on('message.part', (event) => {
          if (event.threadId !== thread.id) return;
          parts.set(`${event.messageId}:${event.partIndex}`, event.part.type);
          written(event.part);
        });
        // The turn's other processes still running, the title call's included: the next row waits for none.
        const live = new Set<number>();
        let gone = (): void => undefined;
        const offExited = client.on('process.exited', (record) => {
          if (record.threadId !== thread.id) return;
          live.delete(record.pid);
          if (live.size === 0) gone();
        });
        const offProcess = client.on('process.started', (record) => {
          if (record.threadId !== thread.id) return;
          processes += 1;
          // By name: the core may run the program an npm launcher on PATH stands for, not the launcher itself.
          const own = executable !== null && basename(record.exe) === basename(executable);
          // The first is the session, which stays warm until the archive; the title's and the helpers' end alone.
          if (firstSpawn === 0 && own) firstSpawn = performance.now();
          else live.add(record.pid);
          if (VERBOSE) console.log(`  +${Math.round(performance.now() - sentAt)} ms ${(record.commandLine ?? record.exe).slice(0, 110)}`);
        });
        const offDelta = client.on('message.delta', (event) => {
          if (event.threadId !== thread.id || firstWord !== 0 || event.text.trim().length === 0) return;
          // A delta to a part not announced yet is the text a message opens with.
          if ((parts.get(`${event.messageId}:${event.partIndex}`) ?? 'text') === 'text') firstWord = performance.now();
        });
        let lastEvent = '';
        const offAny = VERBOSE ? client.onAny((name, payload) => {
          const of = (payload as { threadId?: unknown; id?: unknown } | null);
          if (of?.threadId !== thread.id && of?.id !== thread.id) return;
          if (name === lastEvent && name.endsWith('delta')) return;
          lastEvent = name;
          const said = name === "core.log" ? ` ${String((payload as { message?: unknown }).message ?? "").slice(0, 140)}` : "";
          console.log(`  +${Math.round(performance.now() - sentAt)} ms event ${name}${said}`);
        }) : () => undefined;
        const finished = client.next('turn.finished', (turn) => turn.threadId === thread.id, TURN_TIMEOUT_MS);
        sentAt = performance.now();
        await client.call('turns.start', { threadId: thread.id, prompt: PROMPT });
        const turn = await finished;
        const totalMs = performance.now() - sentAt;
        offDelta();
        offAny();
        offProcess();
        offStarted();
        offPart();
        if (turn.error !== null) console.log(`[bench] ${providerId} run ${index + 1} failed: ${turn.error}`);
        const run: Run = {
          spawnMs: firstSpawn === 0 ? Number.NaN : firstSpawn - sentAt,
          firstWordMs: firstWord === 0 ? Number.NaN : firstWord - sentAt,
          totalMs,
          processes,
        };
        const row = `${providerId}, ${variant.name}`;
        results.set(row, [...(results.get(row) ?? []), run]);
        console.log(`${row} run ${index + 1}: spawn ${Math.round(run.spawnMs)} ms, first word ${Math.round(run.firstWordMs)} ms, done ${Math.round(run.totalMs)} ms, ${run.processes} processes`);
        // The title call may still run: let it end before the next row starts.
        await Promise.race([new Promise<void>((resolve) => { gone = resolve; if (live.size === 0) resolve(); }), Bun.sleep(TURN_TIMEOUT_MS)]);
        offExited();
        await client.call('threads.archive', { threadId: thread.id }).catch(() => undefined);
      }
    }
  }
} finally {
  client.close();
  await core.stop();
  await removeDirectory(directory);
}

const load = await Bun.file('/proc/loadavg').text().catch(() => '');
console.log(`\n${new Date().toISOString().slice(0, 10)}, ${RUNS} runs, medians, new threads, prompt "${PROMPT}"${load ? `, load average at the end ${load.split(' ').slice(0, 3).join(' ')}` : ''}`);
console.log('| harness | to spawn | to first word | to done | processes |\n| --- | ---: | ---: | ---: | ---: |');
for (const [row, runs] of results) {
  const of = (pick: (run: Run) => number) => {
    const values = runs.map(pick).filter((value) => !Number.isNaN(value));
    return values.length === 0 ? 'n/a' : `${Math.round(median(values))}`;
  };
  console.log(`| ${row} | ${of((run) => run.spawnMs)} ms | ${of((run) => run.firstWordMs)} ms | ${of((run) => run.totalMs)} ms | ${of((run) => run.processes)} |`);
}
