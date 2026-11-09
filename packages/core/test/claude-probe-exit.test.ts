import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Options, SDKUserMessage, SpawnOptions as SdkSpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Account } from '@boite/contracts';
import { createClaudeDriver, readClaudeQuota } from '../src/drivers/claude.ts';
import type { QueryFn } from '../src/drivers/claude/query.ts';
import { setDriver } from '../src/drivers/index.ts';
import { withQuotaProbe } from '../src/quotas.ts';
import { scriptedClaude, startTestCore, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';

let harness: TestCore;
beforeEach(async () => { harness = await startTestCore(); scriptedClaude(harness); });
afterEach(async () => { await harness.stop(); });

/**
 * A CLI that found its login expired: the server has already rotated the
 * refresh token, the new one reaches the disk 800 ms later, under the lock the
 * real CLI takes. It exits once its stdin ended and the write is done.
 */
const REFRESHING_CLI = `
const fs = require('node:fs');
const dir = process.env.CLAUDE_CONFIG_DIR;
fs.mkdirSync(dir + '/.oauth_refresh.lock');
let refreshed = false, ended = false;
const done = () => { if (refreshed && ended) process.exit(0); };
setTimeout(() => {
  fs.writeFileSync(dir + '/.credentials.json', JSON.stringify({ claudeAiOauth: { refreshToken: 'rotated' } }));
  fs.rmdirSync(dir + '/.oauth_refresh.lock');
  refreshed = true; done();
}, 800);
process.stdin.on('end', () => { ended = true; done(); });
process.stdin.resume();
`;

/** The SDK's side: the CLI answers the read before its refresh ends, and an ended prompt stream closes its stdin. */
const queryFn = ((input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
  const child = input.options.spawnClaudeCodeProcess!({
    command: process.execPath, args: ['-e', REFRESHING_CLI], cwd: input.options.cwd, env: input.options.env, signal: new AbortController().signal,
  } as SdkSpawnOptions);
  void (async () => { for await (const _ of input.prompt) { /* a read sends no prompt */ } child.stdin.end(); })();
  return {
    supportedModels: () => Promise.resolve([{ value: 'claude-opus-5', displayName: 'Opus 5', description: '' }]),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => Promise.resolve({ rate_limits_available: true, rate_limits: {} }),
    close: () => { child.stdin.end(); },
  };
}) as unknown as QueryFn;

function refreshedLogin(account: Account): string | null {
  const dir = account.isolationDir!;
  if (existsSync(join(dir, '.oauth_refresh.lock'))) return 'refresh lock left behind';
  const file = join(dir, '.credentials.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { claudeAiOauth: { refreshToken: string } }).claudeAiOauth.refreshToken : null;
}

test('the model probe and the quota read let a CLI finish refreshing the login before it is stopped', async () => {
  // A Claude Desktop user signs in through Boite: the login lives in an isolated account.
  const account = harness.core.accounts.add({ providerId: 'claude', label: 'Claude' });
  const restore = setDriver('claude-sdk', createClaudeDriver({ loadQuery: () => Promise.resolve(queryFn) }));
  const client = await harness.connect();
  const owner = `probe:claude:${account.id}`;
  try {
    const probe = await client.call('providers.probe', { providerId: 'claude', accountId: account.id });
    expect(probe.models.map(model => model.id)).toEqual(['claude-opus-5']);
    await waitFor(() => harness.core.procs.liveCount(owner) === 0, 5000);
    expect(refreshedLogin(account)).toBe('rotated');
  } finally {
    await harness.core.procs.stopAndWait(owner);
    restore();
  }

  const quotaAccount = harness.core.accounts.add({ providerId: 'claude', label: 'Claude 2' });
  await withQuotaProbe(harness.core, quotaAccount, 'claude', ctx => readClaudeQuota(ctx, { loadQuery: () => Promise.resolve(queryFn) }));
  expect(refreshedLogin(quotaAccount)).toBe('rotated');
});

test('a read whose process never exits is still stopped once its grace ends', async () => {
  const account = harness.core.accounts.add({ providerId: 'claude', label: 'Claude' });
  const owner = `quota:${account.id}`;
  const operation = harness.core.accounts.operations.open(account.id, 'claude', owner, () => undefined);
  operation.spawnChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: account.isolationDir! });
  operation.letExit(200);
  const started = Date.now();
  await operation.close();
  expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  expect(harness.core.procs.liveCount(owner)).toBe(0);
});
