import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { androidBunPin, androidServerBundle } from '../bin/server-bundle.ts';
import { thrown } from './settle.ts';

const termux = join(import.meta.dir, '../../../apps/android-server/termux');

test('the Android bundle holds the core scripts, the UI and a standalone controller, and names the Bun the installer pins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boite-android-bundle-'));
  try {
    const dist = join(dir, 'dist');
    const ui = join(dir, 'ui');
    mkdirSync(join(dist, 'cli'), { recursive: true });
    mkdirSync(join(ui, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'main.js'), 'export {};');
    writeFileSync(join(dist, 'core-1a2b.js'), 'export {};');
    // The executables `build:core:exe` compiles for the desktop runner have no place on a phone.
    writeFileSync(join(dist, 'boite-core'), 'ELF');
    writeFileSync(join(dist, 'boite-core-linux-x64'), 'ELF');
    writeFileSync(join(ui, 'index.html'), '<!doctype html>');
    writeFileSync(join(ui, 'assets', 'app.js'), '');

    const files = unzipSync(await androidServerBundle(dist, ui, termux, '2.0.0-nightly.20261025.1'));
    expect(Object.keys(files).sort()).toEqual([
      'boite-server.ts', 'core/core-1a2b.js', 'core/main.js', 'core/shipped/echo-login.ts', 'managed-update.ts', 'server-release.json', 'ui/assets/app.js', 'ui/index.html',
    ]);
    const controller = join(dir, 'boite-server.ts');
    writeFileSync(controller, files['boite-server.ts']!);
    const result = Bun.spawnSync([process.execPath, controller, 'version', '--json'], {
      env: { ...process.env, BOITE_SERVER_HOME: dir }, stderr: 'pipe',
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ ok: true, version: null });
    expect(Buffer.from(files['managed-update.ts']!).equals(readFileSync(join(termux, 'managed-update.ts')))).toBe(true);
    const pin = androidBunPin(readFileSync(join(termux, 'install.sh'), 'utf8'));
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(Buffer.from(files['server-release.json']!).toString())).toEqual({ version: '2.0.0-nightly.20261025.1', bun: pin });

    rmSync(join(dist, 'main.js'));
    expect(await thrown(androidServerBundle(dist, ui, termux, '2.0.0'))).toThrow('main.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
