import { expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thrown } from '../../../packages/core/test/settle.ts';
import { runManagedUpdate, type ManagedUpdatePlan } from './managed-update.ts';

// A real ZIP with bun-linux-aarch64-android/bun containing "fixture-runtime".
const archive = Buffer.from('UEsDBBQAAAAAAA2cZF2APKMTDwAAAA8AAAAdAAAAYnVuLWxpbnV4LWFhcmNoNjQtYW5kcm9pZC9idW5maXh0dXJlLXJ1bnRpbWVQSwECFAAUAAAAAAANnGRdgDyjEw8AAAAPAAAAHQAAAAAAAAAAAAAAAAAAAAAAYnVuLWxpbnV4LWFhcmNoNjQtYW5kcm9pZC9idW5QSwUGAAAAAAEAAQBLAAAASgAAAAAA', 'base64');

test('cancelling during a Bun change cannot remove the runtime archive or staging of its retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'boite-runtime-retry-')).replaceAll('\\', '/');
  const previousHome = process.env.BOITE_SERVER_HOME;
  const previousPath = process.env.PATH;
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let fetcher: ReturnType<typeof spyOn> | undefined;
  try {
    mkdirSync(`${root}/runtime`);
    // Keep the real private function, its downloader and its unzip commands in an isolated controller.
    const controller = `${root}/controller.ts`;
    writeFileSync(controller, readFileSync(join(import.meta.dir, 'boite-server.ts'), 'utf8') + '\nexport { ensureRuntime };\n');
    process.env.BOITE_SERVER_HOME = root;
    const { ensureRuntime } = await import(controller) as { ensureRuntime(bun: { version: string; sha256: string }, say: (text: string) => void): Promise<string> };
    if (previousHome === undefined) delete process.env.BOITE_SERVER_HOME; else process.env.BOITE_SERVER_HOME = previousHome;
    if (process.platform === 'win32') process.env.PATH = `C:/Program Files/Git/usr/bin;${previousPath}`;
    fetcher = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: string | URL | Request) => {
      expect(String(input)).toContain('bun-v9.9.9/bun-linux-aarch64-android.zip');
      return new Response(new ReadableStream<Uint8Array>({ start(stream) { streams.push(stream); } }));
    }, { preconnect: fetch.preconnect }));
    const runtime = { version: '9.9.9', sha256: createHash('sha256').update(archive).digest('hex') };
    const start = (id: string) => {
      const directory = `${root}/${id}`;
      mkdirSync(directory);
      writeFileSync(`${directory}/admitted`, id);
      const work = runManagedUpdate(directory, { id, version: '2.0.0', channel: 'nightly' } as ManagedUpdatePlan, {
        validate: () => {}, find: async () => ({ version: '2.0.0', url: '', signature: '' }),
        prepare: async () => { await ensureRuntime(runtime, () => {}); return { staging: `${directory}/stage` }; },
        activate: async () => {},
      });
      return { directory, work };
    };
    const first = start('first');
    for (let i = 0; i < 100 && streams.length < 1; i++) await Bun.sleep(5);
    expect(streams.length).toBe(1);
    await Bun.sleep(1); // Let download open its output before starting the second preparation.
    writeFileSync(`${first.directory}/cancelled`, '');
    const retry = start('retry');
    for (let i = 0; i < 100 && streams.length < 2; i++) await Bun.sleep(5);
    expect(streams.length).toBe(2);
    await Bun.sleep(1);
    streams[0]!.enqueue(archive); streams[0]!.close();
    expect(await first.work).toBe('cancelled');
    streams[1]!.enqueue(archive); streams[1]!.close();
    expect(await retry.work).toBe('installed');
    expect(readFileSync(`${root}/runtime/bun-9.9.9/bun`, 'utf8')).toBe('fixture-runtime');
    expect(readdirSync(`${root}/downloads`)).toEqual([]);
    expect(readdirSync(`${root}/runtime`)).toEqual(['bun-9.9.9']);
    expect(existsSync(`${retry.directory}/ready`)).toBe(true);
  } finally {
    fetcher?.mockRestore();
    if (previousHome === undefined) delete process.env.BOITE_SERVER_HOME; else process.env.BOITE_SERVER_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(['digest', 'extract', 'stream', 'signature', 'local'])('failed %s preparation removes only its own download and extraction', async (failure) => {
  const root = mkdtempSync(join(tmpdir(), 'boite-runtime-failure-')).replaceAll('\\', '/');
  const previousHome = process.env.BOITE_SERVER_HOME;
  const previousPath = process.env.PATH;
  let fetcher: ReturnType<typeof spyOn> | undefined;
  try {
    const controller = `${root}/controller.ts`;
    writeFileSync(controller, readFileSync(join(import.meta.dir, 'boite-server.ts'), 'utf8') + '\nexport { ensureRuntime, prepareRelease };\n');
    process.env.BOITE_SERVER_HOME = root;
    const { ensureRuntime, prepareRelease } = await import(controller);
    if (previousHome === undefined) delete process.env.BOITE_SERVER_HOME; else process.env.BOITE_SERVER_HOME = previousHome;
    if (process.platform === 'win32') process.env.PATH = `C:/Program Files/Git/usr/bin;${previousPath}`;
    mkdirSync(`${root}/downloads`);
    mkdirSync(`${root}/releases`);
    writeFileSync(`${root}/downloads/other-worker.zip`, 'keep');
    mkdirSync(`${root}/downloads/other-worker.zip.tmp`);
    mkdirSync(`${root}/releases/.staging-other-worker`);
    const wrongEntry = Buffer.from(archive);
    // Extraction succeeds but chmod cannot find the runtime: exercises cleanup after unzip.
    const entry = 'bun-linux-aarch64-android/bun';
    for (let offset = wrongEntry.indexOf(entry); offset !== -1; offset = wrongEntry.indexOf(entry, offset + entry.length)) {
      wrongEntry.write('bad-linux-aarch64-android/bun', offset);
    }
    let bytes = archive;
    let brokenStream = false;
    fetcher = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response(
      brokenStream ? new ReadableStream({ start(stream) { stream.enqueue(archive.subarray(0, 10)); stream.error(new Error('download interrupted')); } }) : bytes,
    ), { preconnect: fetch.preconnect }));
    if (['digest', 'extract', 'stream'].includes(failure)) {
      bytes = failure === 'extract' ? wrongEntry : archive;
      brokenStream = failure === 'stream';
      const digest = failure === 'digest' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex');
      expect(await thrown(ensureRuntime({ version: '9.9.9', sha256: digest }, () => {}))).toThrow(failure === 'digest' ? 'hashes to' : failure === 'extract' ? 'ENOENT' : 'download interrupted');
    } else if (failure === 'signature') {
      expect(await thrown(prepareRelease({ offer: { version: '2.0.0', url: 'https://fixture.invalid/bundle.zip', signature: 'invalid' } }, () => {}))).toThrow('not a Minisign packet');
    } else {
      const local = `${root}/local.zip`;
      writeFileSync(local, archive);
      expect(await thrown(prepareRelease({ bundle: local }, () => {}))).toThrow('server-release.json');
      expect(readFileSync(local)).toEqual(archive);
    }
    expect(readdirSync(`${root}/downloads`).sort()).toEqual(['other-worker.zip', 'other-worker.zip.tmp']);
    expect(readdirSync(`${root}/releases`)).toEqual(['.staging-other-worker']);
  } finally {
    fetcher?.mockRestore();
    if (previousHome === undefined) delete process.env.BOITE_SERVER_HOME; else process.env.BOITE_SERVER_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});
