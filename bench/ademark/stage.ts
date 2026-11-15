/**
 * The fixed part of a run: ADEMark's replay server, the logging proxy in front
 * of it (or in front of the real API for the token tests), and a fresh copy of
 * the arena repository the agents work in.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from '../../tests/e2e/lib/cdp.ts';
import { type CaptureLine, type Proxy, startProxy } from './proxy.ts';
import { until } from './lib.ts';

export interface Stage {
  /** What `ANTHROPIC_BASE_URL` is set to for the app under test. */
  url: string;
  /** Every request the app sent so far. */
  capture(): CaptureLine[];
  /** Milliseconds since the last answer ended, 0 while one is still on its way. */
  quietMs(): number;
  stop(): Promise<void>;
}

/** ADEMark's checkout: `ADEMARK_DIR`, cloned from https://github.com/zqkra/ademark. */
export function harnessDir(): string {
  const dir = process.env.ADEMARK_DIR ?? '';
  if (dir === '' || !existsSync(join(dir, 'bench', 'replay', 'server.ts'))) {
    throw new Error(`ADEMARK_DIR must name a checkout of https://github.com/zqkra/ademark (bench/replay/server.ts): ${dir === '' ? 'it is not set' : dir}`);
  }
  return dir;
}

function readCapture(log: string): CaptureLine[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as CaptureLine);
}

/** The replay server behind the proxy: Track A, where no model answers. */
export async function startReplayStage(out: string): Promise<Stage> {
  const harness = harnessDir();
  mkdirSync(out, { recursive: true });
  const port = await freePort();
  const replay = Bun.spawn(['bun', '--preload', join(import.meta.dir, 'clock-shim.ts'), join(harness, 'bench', 'replay', 'server.ts'), '--port', String(port), '--sessions', join(harness, 'bench', 'replay', 'sessions'), '--log', join(out, 'replay.jsonl')], { stdout: 'ignore', stderr: 'inherit' });
  const upstream = `http://127.0.0.1:${port}`;
  const up = await until(async () => fetch(upstream).then(() => true, () => false), 10_000, 50);
  if (!up) {
    replay.kill();
    throw new Error(`the replay server never answered on ${upstream}`);
  }
  const log = join(out, 'capture.jsonl');
  const proxy: Proxy = startProxy({ port: await freePort(), upstream, log, replayKeys: true });
  return {
    url: proxy.url,
    capture: () => readCapture(log),
    quietMs: () => proxy.quietMs(),
    async stop(): Promise<void> {
      await proxy.stop();
      replay.kill();
      await replay.exited;
    },
  };
}

/** The real API behind the proxy: Tracks B and C. The upstream is the `ANTHROPIC_BASE_URL` of this shell, or Anthropic's. */
export async function startLiveStage(out: string): Promise<Stage> {
  mkdirSync(out, { recursive: true });
  const log = join(out, 'capture.jsonl');
  const proxy = startProxy({ port: await freePort(), upstream: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', log });
  return { url: proxy.url, capture: () => readCapture(log), quietMs: () => proxy.quietMs(), stop: () => proxy.stop() };
}

/** A fresh arena at `to`, committed, as every ADEMark test starts from. */
export function freshArena(to: string): string {
  // A run that reuses an output folder starts from the pristine arena again.
  rmSync(to, { recursive: true, force: true });
  cpSync(join(harnessDir(), 'arena'), to, { recursive: true });
  const git = (...args: string[]): void => {
    const done = Bun.spawnSync(['git', ...args], { cwd: to, stdout: 'ignore', stderr: 'pipe' });
    if (done.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${to}: ${done.stderr.toString()}`);
  };
  git('init', '--quiet', '--initial-branch=main');
  git('add', '-A');
  // The arena's commit must not depend on the machine having a git identity.
  git('-c', 'user.name=ademark', '-c', 'user.email=ademark@example.invalid', 'commit', '--quiet', '-m', 'arena');
  return to;
}
