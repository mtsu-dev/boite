import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPERIMENT_IDS, EXPERIMENT_STAGES, FEATURE_CUTS, buildKindOf, effectiveExperiments, experimentRefusal, experimentStartRefusal, featureCompiled, featureDefines, featureFlag, featureMarker, stageRuns, isReleaseVersion, listedExperiments, withFinished, type ClientPreferences, type ExperimentId } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';

const RELEASE = '2.0.0';
const NIGHTLY = '2.0.1-nightly.20261113.1';
const DEV = '2.0.0-beta.1';
/** The experiments finished and removed from the list since, as an older app still reports them. */
const GRADUATED = ['whip', 'debates'] as unknown as ExperimentId[];
const NIGHTLY_SWITCHES: ExperimentId[] = ['draft-backdrop', 'contacts', 'teams', 'auto-goal', 'session-import', 'background-compaction', 'device-stream'];
/** The finished features: on in every build, with no switch. */
const FINISHED = EXPERIMENT_IDS.filter(id => EXPERIMENT_STAGES[id] === 'release');
const report = (experiments: ExperimentId[]): ClientPreferences => ({ app: 'app-desktop-0001', language: 'en', experiments, labels: {} });

const cores: TestCore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of cores.splice(0)) await h.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function core(version: string, dataDir?: string): Promise<TestCore> {
  const h = await startTestCore({ version, agentDefaults: 'boot', ...(dataDir === undefined ? {} : { dataDir }) });
  cores.push(h);
  return h;
}
/** The desktop app of the machine: the one whose switches the core and the phones follow. */
const desktop = (h: TestCore) => connect(h.url, h.token, { client: { version: 'test', name: 'shell' } });

test('a version without a prerelease part is a Release; Nightly and Dev list the Nightly switches', () => {
  expect(['2.0.0', '0.1.1', '', null, undefined].map(isReleaseVersion)).toEqual([true, true, true, true, true]);
  expect(['2.0.0-nightly.20261111.1', '2.0.0-beta.1', '2.0.0-test.0'].map(isReleaseVersion)).toEqual([false, false, false]);

  // Every switch has a stage, and the sort is the one the docs state.
  expect(Object.keys(EXPERIMENT_STAGES).sort()).toEqual([...EXPERIMENT_IDS].sort());
  expect([RELEASE, NIGHTLY, DEV].map(version => listedExperiments(version))).toEqual([[], NIGHTLY_SWITCHES, NIGHTLY_SWITCHES]);

  // Finished features are on whatever a device stored, in every build; the experiment only where chosen and listed.
  for (const version of [RELEASE, NIGHTLY, DEV]) expect(effectiveExperiments([], version), version).toEqual(FINISHED);
  expect(effectiveExperiments([...GRADUATED, 'gone' as ExperimentId], RELEASE)).toEqual(FINISHED);
  expect([RELEASE, NIGHTLY, DEV].map(version => effectiveExperiments(['draft-backdrop'], version).includes('draft-backdrop'))).toEqual([false, true, true]);
});

test('a build has one of three kinds, read from its version', () => {
  expect(['2.0.0', '0.1.1', '', null, undefined].map(buildKindOf)).toEqual(['release', 'release', 'release', 'release', 'release']);
  expect(['2.0.0-nightly.20261111.1', '2.0.1-nightly.20261113.12', '2.0.0-nightly'].map(buildKindOf)).toEqual(['nightly', 'nightly', 'nightly']);
  // Any other prerelease is a build from source: the checkout's own version, a test core, a name that only starts like a nightly.
  expect(['2.0.0-beta.1', '2.0.0-test.0', '2.0.0-rc.1', '2.0.0-nightlyish.1'].map(buildKindOf)).toEqual(['dev', 'dev', 'dev', 'dev']);
  // A build has the features tagged at or below its kind.
  expect((['release', 'nightly', 'dev'] as const).map(kind => (['release', 'nightly', 'dev'] as const).filter(stage => stageRuns(stage, kind))))
    .toEqual([['release'], ['release', 'nightly'], ['release', 'nightly', 'dev']]);
});

test('a dev feature exists in a Dev build only, a nightly one in a Nightly and a Dev build', () => {
  // The real table with the Mochis tagged lower: once dev, once nightly.
  const id = 'resident-agents';
  const dev = { ...EXPERIMENT_STAGES, [id]: 'dev' } as const;
  const nightly = { ...EXPERIMENT_STAGES, [id]: 'nightly' } as const;

  expect(listedExperiments(DEV, dev)).toContain(id);
  expect(listedExperiments(NIGHTLY, dev)).not.toContain(id);
  expect(listedExperiments(RELEASE, dev)).not.toContain(id);
  expect(experimentRefusal(id, DEV, dev)).toBeNull();
  expect(experimentRefusal(id, NIGHTLY, dev)).toBe(`experiment.${id} runs in Dev builds only, and this machine runs a Nightly (${NIGHTLY}): it is still being built and no published build has it`);
  expect(experimentRefusal(id, RELEASE, dev)).toBe(`experiment.${id} runs in Dev builds only, and this machine runs a Release (${RELEASE}): it is still being built and no published build has it`);
  expect(experimentStartRefusal(id, NIGHTLY, dev)).toContain('runs in Dev builds only');

  expect(listedExperiments(DEV, nightly)).toContain(id);
  expect(listedExperiments(NIGHTLY, nightly)).toContain(id);
  expect(listedExperiments(RELEASE, nightly)).not.toContain(id);
  expect(experimentRefusal(id, NIGHTLY, nightly)).toBeNull();
  expect(experimentRefusal(id, DEV, nightly)).toBeNull();
  expect(experimentRefusal(id, RELEASE, nightly)).toBe(`experiment.${id} runs in Nightly and Dev builds only, and this machine runs a Release (${RELEASE}): switch the update channel to Nightly in Settings > Machines and updates to try it`);

  // A stored choice for a feature the build lacks is ignored, and still there for the build that has it.
  const chosen: ExperimentId[] = [id];
  expect(effectiveExperiments(chosen, DEV, dev)).toEqual([id]);
  expect(effectiveExperiments(chosen, NIGHTLY, nightly)).toEqual([id]);
  expect(effectiveExperiments(chosen, NIGHTLY, dev)).toEqual([]);
  expect(effectiveExperiments(chosen, RELEASE, nightly)).toEqual(effectiveExperiments([], RELEASE, nightly));
  expect(chosen).toEqual([id]);
  // A finished one has no switch left: its card is refused.
  expect(experimentRefusal(id, RELEASE)).toBe(`experiment.${id} is no longer an experiment: it is on in every build and has no switch`);
});

test('a build is compiled with one constant for its kind and one flag per tagged feature', () => {
  const dev = { ...EXPERIMENT_STAGES, 'resident-agents': 'dev' } as const;
  const nightly = { ...EXPERIMENT_STAGES, 'resident-agents': 'nightly' } as const;
  const flags = (on: boolean) => Object.fromEntries(NIGHTLY_SWITCHES.map(id => [featureFlag(id), String(on)]));
  expect(featureDefines(RELEASE, dev)).toEqual({ __BOITE_BUILD_KIND__: '"release"', __BOITE_HAS_RESIDENT_AGENTS__: 'false', ...flags(false) });
  expect(featureDefines(NIGHTLY, dev)).toEqual({ __BOITE_BUILD_KIND__: '"nightly"', __BOITE_HAS_RESIDENT_AGENTS__: 'false', ...flags(true) });
  expect(featureDefines(NIGHTLY, nightly)).toEqual({ __BOITE_BUILD_KIND__: '"nightly"', __BOITE_HAS_RESIDENT_AGENTS__: 'true', ...flags(true) });
  expect(featureDefines(DEV, dev)).toEqual({ __BOITE_BUILD_KIND__: '"dev"', __BOITE_HAS_RESIDENT_AGENTS__: 'true', ...flags(true) });
  expect(featureDefines(RELEASE)).toEqual({ __BOITE_BUILD_KIND__: '"release"', ...flags(false) });
  // From source nothing is compiled out, and a finished feature is in every bundle.
  expect(featureCompiled('resident-agents')).toBe(true);
  expect(featureCompiled('resident-agents', 'release')).toBe(true);
  // Only a feature above the release tag can be cut, and its marker is its own.
  for (const id of Object.keys(FEATURE_CUTS) as ExperimentId[]) expect(EXPERIMENT_STAGES[id], id).not.toBe('release');
  expect(featureMarker('resident-agents')).toBe('boite-feature:resident-agents');
});

test('a Release core can read teams and councils before any app reported', async () => {
  const h = await core(RELEASE);
  const owner = await h.connect();
  expect(h.core.clients.desktopExperiments()).toBeNull();
  expect((await owner.call('teams.list', {})).teams).toEqual([]);
  expect((await owner.call('council.list', {})).councils).toEqual([]);
  owner.close();
});

test('automatic goals follow the machine\'s own setting: off by default, on only when true, for prompts and goal track alike', async () => {
  const { startsAutoGoal } = await import('../src/composer-activity.ts');
  const long = 'x'.repeat(2000);
  expect(startsAutoGoal(long, {})).toBe(false);
  expect(startsAutoGoal(long, { autoGoals: true })).toBe(true);
  expect(startsAutoGoal(long, { autoGoals: true, autoGoalMinChars: 3000 })).toBe(false);
  expect(startsAutoGoal(long, { autoGoals: false })).toBe(false);
  const h = await core(NIGHTLY);
  const owner = await h.connect();
  const { threadId } = await echoThread(h, owner);
  expect(() => h.core.activity.track(threadId)).toThrow('goal track needs automatic goals, which are off on this machine');
  await owner.call('settings.set', { autoGoals: true });
  expect(() => h.core.activity.track(threadId)).toThrow('this conversation has no prompt of the user to track');
  await owner.call('settings.set', { autoGoals: false });
  expect(() => h.core.activity.track(threadId)).toThrow('goal track needs automatic goals, which are off on this machine');
  expect(await owner.call('settings.set', { autoGoals: 'yes' } as never).catch((error: Error) => error.message)).toContain('autoGoals must be a boolean');
  owner.close();
});

test('a Release refuses cards for finished and Nightly experiments, and still offers cache keepalive', async () => {
  const h = await core(RELEASE);
  const owner = await desktop(h);
  const { threadId } = await echoThread(h, owner);
  // A card needs a turn to sit under.
  const finished = owner.next('turn.finished', turn => turn.threadId === threadId, 10000);
  await owner.call('turns.start', { threadId, prompt: 'hello' });
  await finished;

  // The historic field and the chosen list: every feature is in force, whatever the app chose.
  // An older app still names the experiments since finished: the core drops them from its own reading, and
  // names every finished id back in both lists, for a phone older than it that still gates on them.
  expect(await owner.call('client.preferences', report(GRADUATED))).toEqual({ ok: true, desktop: withFinished(FINISHED), desktopChosen: withFinished([]) });
  const read = await owner.call('agent.settings', { threadId });
  // A Release lists no experiment, and says which builds have the one it is asked for.
  expect(read.settings.filter(setting => setting.key.startsWith('experiment.'))).toEqual([]);
  const asked = await owner.call('settings.request', { threadId, reason: 'Try the background', key: 'experiment.draft-backdrop', value: true }).catch((error: Error) => error.message);
  expect(asked).toContain(`experiment.draft-backdrop runs in Nightly and Dev builds only, and this machine runs a Release (${RELEASE})`);
  expect(read.settings.find(setting => setting.key === 'cacheKeepalive')).toMatchObject({ value: null, page: 'advanced', section: 'cache-keepalive' });

  expect(await owner.call('settings.request', { threadId, reason: 'Try the mochis', key: 'experiment.resident-agents', value: true }).catch((error: Error) => error.message)).toContain('no longer an experiment');
  expect(await owner.call('settings.request', { threadId, reason: 'Try the whip', key: 'experiment.whip', value: true }).then(() => 'accepted', (error: Error) => error.message)).not.toBe('accepted');
  owner.close();
});

test('a Nightly core keeps the experiment an app chose beside the finished features, and an agent reads it and asks for it', async () => {
  const h = await core(NIGHTLY);
  const owner = await desktop(h);
  const { threadId } = await echoThread(h, owner);
  // A card needs a turn to sit under.
  const finished = owner.next('turn.finished', turn => turn.threadId === threadId, 10000);
  await owner.call('turns.start', { threadId, prompt: 'hello' });
  await finished;
  expect(await owner.call('client.preferences', report([]))).toEqual({ ok: true, desktop: withFinished(FINISHED), desktopChosen: withFinished([]) });
  const read = await owner.call('agent.settings', { threadId });
  expect(read.settings.filter(setting => setting.key.startsWith('experiment.')).map(setting => [setting.key, setting.value])).toEqual([
    ['experiment.draft-backdrop', false], ['experiment.teams', false], ['experiment.session-import', false],
  ]);
  const { setting } = await owner.call('settings.request', { threadId, reason: 'Try the background', key: 'experiment.draft-backdrop', value: true });
  expect(setting).toMatchObject({ kind: 'change', key: 'experiment.draft-backdrop', value: true, previous: false });
  const stream = await owner.call('settings.request', { threadId, reason: 'Watch the phone', key: 'deviceStream', value: true });
  expect(stream.setting).toMatchObject({ kind: 'change', key: 'deviceStream', value: true, previous: false, page: 'experiments', section: 'device-stream' });
  expect(await owner.call('client.preferences', report(['draft-backdrop']))).toEqual({ ok: true, desktop: withFinished([...FINISHED, 'draft-backdrop']), desktopChosen: withFinished(['draft-backdrop']) });
  owner.close();
});

test('a Release save preserves the Nightly choice for an experimental setting', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-stages-'));
  dirs.push(dataDir);

  const nightly = await core(NIGHTLY, dataDir);
  let owner = await nightly.connect();
  await owner.call('settings.set', { deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 }, compactionByType: { bot: { autoCompact: null, backgroundCompaction: true } } });
  owner.close();
  await cores.pop()!.stop();

  const release = await core(RELEASE, dataDir);
  owner = await release.connect();
  await owner.call('settings.set', { deviceStream: false, compactionByType: { bot: { autoCompact: null, backgroundCompaction: false } } });
  expect(release.core.settings.stored()).toMatchObject({ deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 }, compactionByType: { bot: { backgroundCompaction: true } } });
  owner.close();
});

test('a Release core refuses new Contacts operations with contacts-off', async () => {
  const release = await core(RELEASE);
  const owner = await release.connect();
  // One call at a time: a rejection waits for no earlier answer before its handler is attached.
  for (const call of [
    () => owner.call('contacts.invite', {}),
    () => owner.call('contacts.join', { link: 'boite://contact/none' }),
    () => owner.call('contacts.update', { coreId: 'none', trusted: true }),
  ]) expect(await call().catch((error: unknown) => error)).toHaveProperty('rpc.data.reason', 'contacts-off');
  owner.close();
});
