import { expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startTestCore, echoThread, waitFor } from './harness.ts';
import { thrown } from './settle.ts';
import { androidServerUpdates } from '../src/platform/android-server-update.ts';
import { runCli } from '../src/cli.ts';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'boite-android-update-'));
  const state = { stops: 0, plan: '', busy: true, error: '', available: true, ready: true };
  const androidPlatform = {
    inspect: async () => ({ root, controller: join(root, 'boite-server.ts'), executable: process.execPath, channel: 'nightly' as const }),
    check: async () => {
      if (state.error) throw new Error(state.error);
      return state.available ? { version: '2.0.0-nightly.20261104', channel: 'nightly' as const } : null;
    },
    launch: async (_run: unknown, _installation: unknown, plan: string) => { state.plan = plan; if (state.ready) writeFileSync(join(dirname(plan), 'ready'), ''); },
  };
  const h = await startTestCore({ onShutdown: () => { state.stops++; }, serverUpdates: { androidPlatform, pollMs: 5 } });
  Object.defineProperty(h.core.updates, 'busy', { get: () => state.busy, configurable: true });
  return { root, state, h, stop: async () => { await h.stop(); rmSync(root, { force: true, recursive: true }); } };
}

test('Android update checks use the controller channel and surface current and controller errors', async () => {
  const f = await fixture();
  try {
    const c = await f.h.connect();
    expect(await c.call('core.updateStatus', { refresh: true })).toMatchObject({ mode: 'android', channel: 'nightly', phase: 'available', version: '2.0.0-nightly.20261104' });
    f.state.available = false;
    expect((await c.call('core.updateStatus', { refresh: true })).phase).toBe('current');
    f.state.error = 'controller: signed manifest is invalid';
    expect(await c.call('core.updateStatus', { refresh: true })).toMatchObject({ phase: 'error', error: f.state.error });
    expect(f.state.stops).toBe(0);
  } finally { await f.stop(); }
});

test('Android prepares before admission, rejects another version, cancels and hands busy turns over after agent updates', async () => {
  const f = await fixture();
  try {
    const c = await f.h.connect();
    await c.call('core.updateStatus', { refresh: true });
    expect(await thrown(c.call('core.updateInstall', { version: '2.0.0-nightly.OTHER' }))).toThrow('version');
    f.state.ready = false;
    await c.call('core.updateInstall', { version: '2.0.0-nightly.20261104' });
    await waitFor(() => Boolean(f.state.plan));
    expect(f.h.core.serverUpdates.snapshot().phase).toBe('downloading');
    expect(f.state.stops).toBe(0);
    const cancelled = dirname(f.state.plan);
    expect((await c.call('core.updateCancel', {})).phase).toBe('available');
    expect(existsSync(join(cancelled, 'cancelled'))).toBe(true);
    f.state.ready = true;
    const thread = await echoThread(f.h, c, 'Android handoff');
    await c.call('turns.start', { threadId: thread.threadId, prompt: '[sleep:60000] running' });
    await c.call('core.updateInstall', { version: '2.0.0-nightly.20261104' });
    await waitFor(() => f.h.core.serverUpdates.snapshot().phase === 'waiting');
    expect(f.state.stops).toBe(0);
    const plan = JSON.parse(readFileSync(f.state.plan, 'utf8'));
    expect(plan).toMatchObject({ version: '2.0.0-nightly.20261104', channel: 'nightly' });
    f.state.busy = false;
    await waitFor(() => f.h.core.serverUpdates.snapshot().phase === 'installing');
    expect(readFileSync(join(dirname(f.state.plan), 'admitted'), 'utf8')).toBe(plan.id);
    expect(f.h.core.journal.getSetting('restart-handoff')).toBeDefined();
    await waitFor(() => f.state.stops === 1, 15000);
  } finally { await f.stop(); }
});

test('owner CLI installs the offered Android version', async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.h.dataDir, 'core.json'), JSON.stringify({ port: f.h.server.port, host: '127.0.0.1', token: f.h.token }));
    let out = ''; let err = '';
    const code = await runCli(['server', 'update', '--data-dir', f.h.dataDir, '--json'], { cwd: f.root, env: {}, out: text => { out += text; }, err: text => { err += text; } });
    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(out)).toMatchObject({ mode: 'android', phase: 'downloading', version: '2.0.0-nightly.20261104' });
    await f.h.core.serverUpdates.cancel();
  } finally { await f.stop(); }
});

test('Android platform detects both core environments, uses release controller after old bootstrap and rejects inconsistent paths and incomplete checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'boite-android-detect-'));
  try {
    const release = join(root, 'releases', '1.0.0');
    mkdirSync(join(release, 'ui'), { recursive: true });
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'bun'), 'runtime');
    symlinkSync(release, join(root, 'current'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(root, 'config.json'), JSON.stringify({ channel: 'nightly' }));
    writeFileSync(join(root, 'boite-server.ts'), '// old controller, no managed commands');
    writeFileSync(join(release, 'boite-server.ts'), 'export const MANAGED_UPDATE_PROTOCOL = 1;');
    writeFileSync(join(release, 'managed-update.ts'), '// signed companion');
    const env = { BOITE_DATA_DIR: join(root, 'data'), BOITE_CLI_DIR: join(root, 'cli'), BOITE_UI_DIR: join(release, 'ui') };
    for (const marked of [false, true]) {
      const platform = androidServerUpdates({ ...env, ...(marked ? { BOITE_ANDROID_SERVER_ROOT: root } : {}) });
      const install = await platform.inspect(join(root, 'data'));
      expect(install).toMatchObject({ root, channel: 'nightly', controller: join(release, 'boite-server.ts') });
      const commands: string[][] = [];
      expect(await platform.check(async (_cmd, args) => { commands.push(args); return JSON.stringify({ ok: true, version: '1.0.0', available: '2.0.0', channel: 'stable', managedUpdate: 1 }); }, install!, '1.0.0')).toEqual({ version: '2.0.0', channel: 'stable' });
      expect(install!.channel).toBe('stable');
      expect(commands[0]).toEqual([install!.controller, 'update', '--check', '--json']);
      const answer = { ok: true, version: '1.0.0', channel: 'nightly', managedUpdate: 1 };
      expect(await thrown(platform.check(async () => JSON.stringify(answer), install!, '1.0.0'))).toThrow('available');
      expect(await platform.check(async () => JSON.stringify({ ...answer, available: null }), install!, '1.0.0')).toBeNull();
    }
    expect(await thrown(androidServerUpdates(env).inspect(join(root, 'wrong')))).toThrow('BOITE_DATA_DIR');
    rmSync(join(release, 'managed-update.ts'));
    expect(await thrown(androidServerUpdates(env).inspect(join(root, 'data')))).toThrow('missing managed-update.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Android detection failures become a visible status error and cannot install', async () => {
  const h = await startTestCore({ serverUpdates: { androidPlatform: { inspect: async () => { throw new Error('controller missing managed updates support'); }, check: async () => null, launch: async () => {} } } });
  try {
    const c = await h.connect();
    expect(await c.call('core.updateStatus', { refresh: true })).toMatchObject({ phase: 'error', error: 'controller missing managed updates support' });
    expect(await thrown(c.call('core.updateInstall', { version: '2.0.0' }))).toThrow('version');
  } finally { await h.stop(); }
});

test('Android update policy blocks checks and installation before launching any worker', async () => {
  const f = await fixture();
  try {
    const c = await f.h.connect();
    await c.call('core.updateStatus', { refresh: true });
    const policy = spyOn(f.h.core.policy, 'update').mockReturnValue('off');
    try {
      expect(await thrown(c.call('core.updateStatus', { refresh: true }))).toThrow('updates.server');
      expect(await thrown(c.call('core.updateInstall', { version: '2.0.0-nightly.20261104' }))).toThrow('updates.server');
      expect(f.state.plan).toBe('');
      expect(f.state.stops).toBe(0);
    } finally { policy.mockRestore(); }
  } finally { await f.stop(); }
});

test('a restored core reads a worker result written after startup and clears an old failure after success', async () => {
  const f = await fixture();
  try {
    const c = await f.h.connect();
    writeFileSync(join(f.h.dataDir, 'server-update-result.json'), JSON.stringify({ error: 'new core failed; previous version runs again' }));
    expect(await c.call('core.updateStatus', {})).toMatchObject({ phase: 'error', error: 'new core failed; previous version runs again' });
    writeFileSync(join(f.h.dataDir, 'server-update-result.json'), JSON.stringify({ error: null }));
    expect(await c.call('core.updateStatus', {})).toMatchObject({ phase: 'idle', error: null });
  } finally { await f.stop(); }
});

test('Android controller JSON failures keep their deciding error in RPC status', async () => {
  const h = await startTestCore({ serverUpdates: { androidPlatform: {
    inspect: async () => ({ root: '', executable: process.execPath, controller: '', channel: 'nightly' }),
    check: async run => { await run(process.execPath, ['-e', 'console.log(JSON.stringify({ok:false,error:"the signed Android manifest is missing"}));process.exit(1)']); return null; },
    launch: async () => {},
  } } });
  try {
    const c = await h.connect();
    const status = await c.call('core.updateStatus', { refresh: true });
    expect(status.phase).toBe('error');
    expect(status.error).toContain('the signed Android manifest is missing');
  } finally { await h.stop(); }
});
