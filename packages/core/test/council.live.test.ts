import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { COUNCIL_AUTHOR, COUNCIL_OWNER, COUNCIL_SYSTEM } from '@boite/contracts';
import { removeDir, startTestCore, waitFor } from './harness.ts';

/**
 * Opt-in: one round with real models on the installed agents, through a Douane
 * gateway. It spends that gateway's subscriptions. `BOITE_E2E_COUNCIL_PROXY_URL`
 * is the gateway's API URL, `BOITE_E2E_COUNCIL_PROXY_KEY` its key and
 * `BOITE_E2E_COUNCIL_MODELS` the members, comma separated. Antigravity cannot run
 * behind a gateway, and a fresh data directory has no sign-in for it, so Gemini
 * comes through a gateway route here. The folder is not a repository.
 */
const GATEWAY = process.env['BOITE_E2E_COUNCIL_PROXY_URL'] ?? '';
const KEY = process.env['BOITE_E2E_COUNCIL_PROXY_KEY'] ?? '';
const MODELS = (process.env['BOITE_E2E_COUNCIL_MODELS'] ?? 'claude/claude-opus-5-5,codex/gpt-6.1-sol,codex/antigravity/gemini-4-argon-high').split(',');
const ROUND_MS = 10 * 60_000;
const run = process.env['BOITE_E2E_COUNCIL'] === '1' && GATEWAY.length > 0 ? test : test.skip;

run('three real models review a plan alone, read-only, in a folder without git, and each gives a score', async () => {
  const origin = GATEWAY.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const harness = await startTestCore({ settings: { subscriptionProxy: { enabled: true, kind: 'douane', baseUrl: GATEWAY, dashboardUrl: `${origin}/admin/#quotas` } } });
  const folder = mkdtempSync(join(tmpdir(), 'boite-council-'));
  try {
    writeFileSync(join(folder, 'plan.md'), 'Keep the app language in one settings key, read once at startup. A change asks for a restart.\n');
    const owner = await harness.connect();
    if (KEY.length > 0) await owner.call('subscriptionProxy.key', { key: KEY });
    await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: ['debates'], labels: {} });
    const project = await owner.call('projects.add', { path: folder, name: 'plain' });
    const accounts = await owner.call('accounts.list', {});
    const { id: threadId } = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: accounts.find(entry => entry.providerId === 'echo')!.id, title: 'A plan' });

    const started = Date.now();
    const { id: councilId } = await owner.call('council.start', { threadId, request: 'Review the plan in plan.md, in three sentences at most.', models: MODELS, timeoutMinutes: 8 });
    await waitFor(() => harness.core.council.get({ councilId }).council.status === 'waiting', ROUND_MS);
    const { council, posts } = await owner.call('council.get', { councilId });
    const { table } = await owner.call('council.table', { councilId });

    console.log(`round took ${Math.round((Date.now() - started) / 1000)} s`);
    console.log(`warnings: ${JSON.stringify(council.warnings)}`);
    console.log(council.members.map(member => `${member.name}: effort ${member.effort ?? 'none'}, read-only ${member.readOnly}, scores ${JSON.stringify(member.scores)}`).join('\n'));
    console.log(posts.filter(post => ![COUNCIL_AUTHOR, COUNCIL_OWNER].includes(post.author)).map(post => `--- ${post.author === COUNCIL_SYSTEM ? 'system' : council.members.find(member => member.id === post.author)?.name}\n${post.text}`).join('\n'));
    console.log(table);

    expect(council.members.map(member => member.scores.length)).toEqual(MODELS.map(() => 1));
    for (const member of council.members) expect(member.scores[0]).toBeNumber();
    // Read-only held: the folder holds what it held, and no repository came of it.
    expect(readdirSync(folder)).toEqual(['plan.md']);
    expect(table).toContain('Rounds: 1');
    await waitFor(() => harness.core.council.get({ councilId }).council.delivered, 60_000);
  } finally {
    await harness.stop();
    await removeDir(folder);
  }
}, ROUND_MS + 90_000);
