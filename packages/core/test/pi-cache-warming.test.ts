import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectedProviderApi } from './fixtures/protected-provider-api.ts';
import { startTestCore, startTurn, waitFor } from './harness.ts';

// Point at the installed package's bin entry (Pi 1.5.2+). This uses a local
// endpoint, a synthetic key and a fresh profile even if the machine has Pi.
const cli = process.env['BOITE_TEST_PI_CACHE_CLI'];

describe.skipIf(!cli)('native Pi prompt cache', () => {
  test.each([{}, { cacheWarming: 'idle' }])('idle requests follow the profile (%j)', async (settings) => {
    const harness = await startTestCore({ settings: { warmProcessMinutes: 5 } });
    const api = protectedProviderApi('claude', []);
    try {
      const config = join(harness.dataDir, 'pi-config');
      const projectDir = join(harness.dataDir, 'project');
      mkdirSync(config);
      mkdirSync(projectDir);
      const settingsPath = join(config, 'settings.json');
      const profileSettings = JSON.stringify(settings);
      writeFileSync(settingsPath, profileSettings);
      writeFileSync(join(config, 'models.json'), JSON.stringify({
        providers: {
          fixture: {
            api: 'anthropic-messages', baseUrl: api.url, apiKey: 'synthetic-pi-key',
            models: [{
              id: 'cache-fixture', name: 'Cache fixture',
              // Make the single reported input token worth refreshing on the
              // local endpoint. Pi refreshes this TTL after one second.
              cost: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 1_000_000 },
              promptCache: { short: 11, long: 11 },
            }],
          },
        },
      }));
      const provider = harness.core.providers.require('pi');
      provider.auth = { kind: 'none' };
      provider.models = [{ id: 'fixture/cache-fixture', name: 'Cache fixture', default: true }];
      for (const profile of Object.values(provider.profiles)) {
        if (!profile) continue;
        profile.executable = [{ kind: 'file', value: Bun.which('node')! }];
        profile.launch = { args: [cli!, '--mode', 'rpc', '--no-approve'] };
        profile.env = { PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1' };
      }
      const client = await harness.connect();
      const project = await client.call('projects.add', { path: projectDir });
      const account = await client.call('accounts.add', { providerId: 'pi', label: 'Synthetic Pi', useDefaultLocation: true });
      const { id: threadId } = await client.call('threads.create', {
        projectId: project.id, providerId: 'pi', accountId: account.id, model: 'fixture/cache-fixture',
      });
      await client.call('threads.subscribe', { threadId });
      const { finished } = await startTurn(client, threadId, 'Reply with a short greeting.', 10_000);
      expect(await finished).toMatchObject({ status: 'done' });
      expect(api.requests).toHaveLength(1);
      if (settings.cacheWarming === 'idle') {
        await waitFor(() => api.requests.length >= 2);
        expect(api.requests[1]).toMatchObject({ max_tokens: 1 });
      } else {
        await Bun.sleep(2_000);
        expect(api.requests).toHaveLength(1);
      }
      expect(harness.core.procs.liveCount(threadId)).toBe(1);
      // Pi may add its own settings during the turn. It may never be configured
      // to warm in idle by Boite, and an owner's choice must be preserved.
      expect(JSON.parse(readFileSync(settingsPath, 'utf8')).cacheWarming).toBe(settings.cacheWarming);
    } finally {
      await harness.stop();
      api.stop();
    }
  }, 15_000);
});
