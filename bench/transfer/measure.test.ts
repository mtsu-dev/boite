import { afterEach, expect, test } from 'bun:test';
import { codexReplay, REPLAY_PAUSE_EVERY } from '../../packages/core/test/fixtures/replay.ts';
import { fixturePath } from './fixture.ts';
import { measureProvider } from './measure.ts';

afterEach(() => { delete process.env['REPLAY_PAUSE_MS']; });

// A slower agent or runner spaces the same output differently. CI compares the
// numbers with main's, measured on another runner, so they may follow the
// output's order and nothing else. 1.1 s outlasts every pacing timer: the
// socket's 250 ms text cap and the 1 s beat of a running Codex command, which
// the first pause lands in.
test.each(['codex', 'opencode'] as const)('%s measures the same when its agent pauses mid-turn', async (provider) => {
  if (provider === 'codex') expect(codexReplay(fixturePath('codex')).notifications[REPLAY_PAUSE_EVERY - 1]).toMatchObject({ method: 'item/commandExecution/outputDelta' });
  const steady = await measureProvider(provider);
  process.env['REPLAY_PAUSE_MS'] = '1100';
  expect(await measureProvider(provider)).toEqual(steady);
  // A later fake agent in the same process runs its own script, on the real clock.
  expect(process.env[provider === 'codex' ? 'CODEX_FAKE_REPLAY' : 'ACP_FAKE_REPLAY']).toBeUndefined();
  expect(Date.now()).toBeGreaterThan(Date.UTC(2026, 0, 2));
}, 60_000);
