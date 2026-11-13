import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPERIMENT_IDS, EXPERIMENT_STAGES, effectiveExperiments, experimentalSettingRefusal, holdExperimentalSettings, isReleaseVersion, listedExperiments, type ClientPreferences, type ExperimentId, type Settings } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';

const RELEASE = '2.0.0';
const NIGHTLY = '2.0.1-nightly.20261113.1';
const EXPERIMENTAL: ExperimentId[] = ['whip', 'contacts', 'auto-goal', 'teams', 'debates'];
const report = (experiments: ExperimentId[]): ClientPreferences => ({ app: 'app-desktop-0001', language: 'en', experiments, labels: {} });

const cores: TestCore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of cores.splice(0)) await h.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function core(version: string, dataDir?: string): Promise<TestCore> {
  const h = await startTestCore({ version, ...(dataDir === undefined ? {} : { dataDir }) });
  cores.push(h);
  return h;
}
/** The desktop app of the machine: the one whose switches the core and the phones follow. */
const desktop = (h: TestCore) => connect(h.url, h.token, { client: { version: 'test', name: 'shell' } });

test('a version without a prerelease part is a Release, and only the other builds list experiments', () => {
  expect(['2.0.0', '0.1.1', '', null, undefined].map(isReleaseVersion)).toEqual([true, true, true, true, true]);
  expect(['2.0.0-nightly.20261111.1', '2.0.0-beta.1', '2.0.0-test.0'].map(isReleaseVersion)).toEqual([false, false, false]);

  // Every switch has a stage, and the sort is the one the docs state.
  expect(Object.keys(EXPERIMENT_STAGES).sort()).toEqual([...EXPERIMENT_IDS].sort());
  expect(listedExperiments(NIGHTLY)).toEqual(['whip', 'contacts', 'auto-goal', 'teams', 'debates']);
  expect(listedExperiments(RELEASE)).toEqual([]);

  // Finished features are on whatever a device stored; an experiment only where experiments run.
  expect(effectiveExperiments([], RELEASE)).toEqual(['theme-grain', 'session-import', 'prompt-cache', 'resident-agents', 'recording-indicators', 'pinned-quotas']);
  expect(effectiveExperiments(EXPERIMENTAL, RELEASE)).toEqual(effectiveExperiments([], RELEASE));
  expect(effectiveExperiments(['whip', 'gone'], NIGHTLY)).toEqual(['theme-grain', 'session-import', 'prompt-cache', 'resident-agents', 'whip', 'recording-indicators', 'pinned-quotas']);

  // A Release refuses to turn an experimental setting on, never to turn one off.
  expect(experimentalSettingRefusal({ deviceStream: true }, RELEASE)?.key).toBe('deviceStream');
  expect(experimentalSettingRefusal({ compactionByType: { thread: { backgroundCompaction: true } } } as never, RELEASE)?.key).toBe('backgroundCompaction');
  expect(experimentalSettingRefusal({ deviceStream: false, backgroundCompaction: false, cacheKeepalive: null }, RELEASE)).toBeNull();
  expect(experimentalSettingRefusal({ deviceStream: true }, NIGHTLY)).toBeNull();
  expect(holdExperimentalSettings<Partial<Settings>>({ deviceStream: true, shortAnswers: true }, RELEASE)).toEqual({ deviceStream: false, shortAnswers: true });
  expect(holdExperimentalSettings<Partial<Settings>>({ deviceStream: true }, NIGHTLY)).toEqual({ deviceStream: true });
});

test('a Release core runs no experiment an app reports, refuses the card for one and names the Nightly channel', async () => {
  const h = await core(RELEASE);
  const owner = await desktop(h);
  const { threadId } = await echoThread(h, owner);
  // A card needs a turn to sit under.
  const finished = owner.next('turn.finished', turn => turn.threadId === threadId, 10000);
  await owner.call('turns.start', { threadId, prompt: 'hello' });
  await finished;

  // The historic field stays what is in force, as an app from before the stages reads it; the chosen list rides beside it for the phones that keep it.
  expect(await owner.call('client.preferences', report(EXPERIMENTAL))).toEqual({ ok: true, desktop: effectiveExperiments([], RELEASE), desktopChosen: EXPERIMENTAL });
  expect(h.core.clients.current()!.experiments).not.toContain('whip');
  expect(h.core.council.enabled()).toBe(false);

  const read = await owner.call('agent.settings', { threadId });
  expect(read.settings.filter(setting => setting.key.startsWith('experiment.'))).toEqual([]);

  const asked = await owner.call('settings.request', { threadId, reason: 'Try the whip', key: 'experiment.whip', value: true }).catch((error: Error) => error.message);
  expect(asked).toContain('experiment.whip runs in Nightly builds only, and this machine runs a Release (2.0.0)');
  expect(asked).toContain('Settings > Version > Updates');
  expect(await owner.call('settings.request', { threadId, reason: 'x', key: 'experiment.resident-agents', value: true }).catch((error: Error) => error.message)).toContain('no longer an experiment');
  expect(await owner.call('settings.request', { threadId, reason: 'x', key: 'deviceStream', value: true }).catch((error: Error) => error.message)).toContain('deviceStream is an experiment');
  expect(await owner.call('questions.list', { threadId })).toEqual([]);
  owner.close();
});

test('a Nightly core keeps the experiments an app chose beside the finished features', async () => {
  const h = await core(NIGHTLY);
  const owner = await desktop(h);
  const { threadId } = await echoThread(h, owner);
  // A card needs a turn to sit under.
  const finished = owner.next('turn.finished', turn => turn.threadId === threadId, 10000);
  await owner.call('turns.start', { threadId, prompt: 'hello' });
  await finished;
  expect(await owner.call('client.preferences', report(['teams', 'debates']))).toEqual({ ok: true, desktop: effectiveExperiments(['teams', 'debates'], NIGHTLY), desktopChosen: ['teams', 'debates'] });
  expect(h.core.council.enabled()).toBe(true);
  const read = await owner.call('agent.settings', { threadId });
  expect(read.settings.filter(setting => setting.key.startsWith('experiment.')).map(setting => [setting.key, setting.value])).toEqual([
    ['experiment.whip', false], ['experiment.contacts', false], ['experiment.auto-goal', false], ['experiment.teams', true], ['experiment.debates', true],
  ]);
  const { setting } = await owner.call('settings.request', { threadId, reason: 'Try the whip', key: 'experiment.whip', value: true });
  expect(setting).toMatchObject({ kind: 'change', key: 'experiment.whip', value: true, previous: false });
  owner.close();
});

test('a Release reads the experimental settings as off, refuses to turn one on, and a Nightly finds the saved choice again', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-stages-'));
  dirs.push(dataDir);

  const nightly = await core(NIGHTLY, dataDir);
  let owner = await nightly.connect();
  const chosen = await owner.call('settings.set', { deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 } });
  expect(chosen).toMatchObject({ deviceStream: true, backgroundCompaction: true });
  expect(chosen.cacheKeepalive).not.toBeNull();
  const keepalive = chosen.cacheKeepalive;
  owner.close();
  await cores.pop()!.stop();

  const release = await core(RELEASE, dataDir);
  owner = await release.connect();
  expect(await owner.call('settings.get', {})).toMatchObject({ deviceStream: false, backgroundCompaction: false, cacheKeepalive: null });
  expect(release.core.settings.get().deviceStream).toBe(false);
  expect(await owner.call('settings.set', { deviceStream: true }).catch((error: Error) => error.message)).toContain('deviceStream is an experiment: it runs in Nightly builds only, and this machine runs a Release (2.0.0)');
  // An ordinary setting still saves, and an experiment sent as off is not refused: it is left as stored.
  expect(await owner.call('settings.set', { shortAnswers: true, deviceStream: false })).toMatchObject({ shortAnswers: true, deviceStream: false });
  expect(release.core.settings.stored().deviceStream).toBe(true);
  // The group's settings home may hold one on: the copy is stored without a refusal and stays off here.
  const followed = await owner.call('settings.follow', { patch: { backgroundCompaction: true, muteAgents: false } as never });
  expect(followed).toMatchObject({ backgroundCompaction: false, muteAgents: false });
  expect(release.core.settings.stored().backgroundCompaction).toBe(true);
  owner.close();
  await cores.pop()!.stop();

  const back = await core(NIGHTLY, dataDir);
  owner = await back.connect();
  const again = await owner.call('settings.get', {});
  expect(again).toMatchObject({ backgroundCompaction: true, deviceStream: true, muteAgents: false });
  expect(again.cacheKeepalive).toEqual(keepalive);
  owner.close();
});

test('a Release that saves a compaction limit, or the values it reads, leaves every hidden experiment as a Nightly stored it', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-stages-'));
  dirs.push(dataDir);
  const rule = { tokens: 200_000, moments: ['turn-end' as const] };

  const nightly = await core(NIGHTLY, dataDir);
  let owner = await nightly.connect();
  await owner.call('settings.set', {
    deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 },
    compactionByType: { agent: { autoCompact: rule, backgroundCompaction: true }, bot: { autoCompact: null, backgroundCompaction: true } },
  });
  owner.close();
  await cores.pop()!.stop();

  const release = await core(RELEASE, dataDir);
  owner = await release.connect();
  const read = await owner.call('settings.get', {});
  expect(read.compactionByType).toEqual({ agent: { autoCompact: rule, backgroundCompaction: false }, bot: { autoCompact: null, backgroundCompaction: false } });
  // The app's `compactionPatch`: the map as read, with one type's limit changed and a type customized for the first time.
  const saved = await owner.call('settings.set', { compactionByType: {
    ...read.compactionByType,
    agent: { ...read.compactionByType!.agent!, autoCompact: { ...rule, tokens: 150_000 } },
    subagent: { autoCompact: null, backgroundCompaction: false },
  } });
  expect(saved.compactionByType!.agent).toEqual({ autoCompact: { ...rule, tokens: 150_000 }, backgroundCompaction: false });
  // A save that hands back what this build reads is no choice either.
  await owner.call('settings.set', { cacheKeepalive: read.cacheKeepalive, deviceStream: read.deviceStream, backgroundCompaction: read.backgroundCompaction });
  expect(release.core.settings.stored()).toMatchObject({
    deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 },
    compactionByType: { agent: { backgroundCompaction: true }, bot: { backgroundCompaction: true }, subagent: { backgroundCompaction: true } },
  });
  // What the machine stores, for the copy to a machine that follows it: never the masked read.
  expect(await owner.call('settings.get', { stored: true })).toMatchObject({ cacheKeepalive: { hours: 2 }, compactionByType: { bot: { autoCompact: null, backgroundCompaction: true } } });
  owner.close();
  await cores.pop()!.stop();

  const back = await core(NIGHTLY, dataDir);
  owner = await back.connect();
  expect(await owner.call('settings.get', {})).toMatchObject({
    deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 },
    compactionByType: { agent: { autoCompact: { ...rule, tokens: 150_000 }, backgroundCompaction: true }, bot: { autoCompact: null, backgroundCompaction: true }, subagent: { autoCompact: null, backgroundCompaction: true } },
  });
  owner.close();
});

test('a Release core refuses the Contacts calls that start something and still reads and removes what exists', async () => {
  const release = await core(RELEASE);
  const owner = await release.connect();
  const refusal = 'experiment.contacts runs in Nightly builds only, and this machine runs a Release (2.0.0)';
  expect(await owner.call('contacts.invite', {}).then(() => 'accepted', (error: Error) => error.message)).toContain(refusal);
  expect(await owner.call('contacts.join', { link: 'boite://contact/none' }).then(() => 'accepted', (error: Error) => error.message)).toContain(refusal);
  expect(await owner.call('contacts.grant', { coreId: 'none', projectId: 'none' as never }).then(() => 'accepted', (error: Error) => error.message)).toContain(refusal);
  expect(await owner.call('contacts.decide', { id: 'none', accept: true }).then(() => 'accepted', (error: Error) => error.message)).toContain(refusal);
  expect(await owner.call('contacts.update', { coreId: 'none', trusted: true }).then(() => 'accepted', (error: Error) => error.message)).toContain(refusal);
  // Reading, cancelling and refusing are how a person cleans up: they answer as on a Nightly.
  expect((await owner.call('contacts.get', {})).contacts).toEqual([]);
  expect(await owner.call('contacts.cancelInvites', {})).toEqual({ cancelled: 0 });
  expect(await owner.call('contacts.decide', { id: 'none', accept: false }).then(() => 'accepted', (error: Error) => error.message)).not.toContain('Nightly');
  owner.close();
});
