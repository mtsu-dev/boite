import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAcpDriver } from '../src/drivers/acp.ts';
import { setDriver } from '../src/drivers/index.ts';
import { openCodeServerReachable } from '../src/providers/opencode.ts';
import { removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';

let harness: TestCore | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await harness?.stop();
  harness = undefined;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

/** BoiteOS's layout: `agents/bin/opencode2` links to `agents/shim`, the real CLI sits elsewhere. */
function shimLayout(): { root: string; shim: string; linked: string; real: string } {
  const root = mkdtempSync(join(tmpdir(), 'boite-shim-'));
  dirs.push(root);
  mkdirSync(join(root, 'agents', 'bin'), { recursive: true });
  const shim = join(root, 'agents', 'shim');
  writeFileSync(shim, '#!/bin/sh\n', { mode: 0o755 });
  const linked = join(root, 'agents', 'bin', 'opencode2');
  symlinkSync('../shim', linked);
  const real = join(root, 'opencode2');
  writeFileSync(real, '#!/bin/sh\n', { mode: 0o755 });
  return { root, shim, linked, real };
}

test('only an OpenCode 2 behind the BoiteOS agent shim counts as out of reach', () => {
  const { shim, linked, real } = shimLayout();
  expect(openCodeServerReachable(linked, shim)).toBe(false);
  expect(openCodeServerReachable(shim, shim)).toBe(false);
  expect(openCodeServerReachable(real, shim)).toBe(true);
  // Without BoiteOS there is no shim, and every OpenCode 2 keeps its native server.
  expect(openCodeServerReachable(real, join(shim, 'missing'))).toBe(true);
});

test('OpenCode 2 through the BoiteOS shim answers over ACP when its server port is out of reach', async () => {
  const { root, shim, linked } = shimLayout();
  const launches = join(root, 'launches.log');
  const fixture = join(import.meta.dir, 'fixtures/opencode2-server.ts');
  // The shim runs the CLI in a thread's network namespace: a server it starts
  // reports a loopback port the core cannot connect to.
  writeFileSync(shim, [
    '#!/bin/sh',
    `echo "$*" >> ${JSON.stringify(launches)}`,
    'case " $* " in *" serve "*) echo \'{"url":"http://127.0.0.1:9"}\'; exec cat >/dev/null;; esac',
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)} "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  const driver = createAcpDriver({ loadSdk: () => import('@agentclientprotocol/sdk/unstable'), agentShim: shim });
  const restore = setDriver('acp', driver);
  try {
    harness = await startTestCore();
    const owner = await harness.connect();
    const profile = { executable: [{ kind: 'file' as const, value: linked }], detect: {}, isolation: {}, launch: { args: ['acp'] } };
    Object.assign(harness.core.providers.require('opencode-v2'), { auth: { kind: 'none' }, env: {}, profiles: { windows: profile, linux: profile, macos: profile } });
    await owner.call('providers.setEnabled', { providerId: 'opencode-v2', enabled: true });
    const account = await owner.call('accounts.add', { providerId: 'opencode-v2', label: 'Fixture' });
    const project = await owner.call('projects.add', { path: harness.dataDir, name: 'Fixture' });
    const thread = await owner.call('threads.create', { projectId: project.id, accountId: account.id, providerId: 'opencode-v2' });
    await owner.call('turns.start', { threadId: thread.id, prompt: 'ping' });
    await waitFor(() => ['done', 'error', 'stopped'].includes(harness!.core.threads.get(thread.id).turns.at(-1)?.status ?? ''), 20_000);
    const current = harness.core.threads.get(thread.id);
    expect(current.turns.at(-1)?.status).toBe('done');
    expect(current.messages.some(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text.length > 0))).toBe(true);
    expect(readFileSync(launches, 'utf8').trim().split('\n').every(line => line.split(' ')[0] === 'acp')).toBe(true);
  } finally {
    driver.shutdown?.();
    restore();
  }
}, 30_000);
