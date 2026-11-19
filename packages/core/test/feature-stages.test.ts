import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPERIMENT_IDS, EXPERIMENT_STAGES, FEATURE_CUTS, buildKindOf, effectiveExperiments, experimentRefusal, experimentStartRefusal, featureCompiled, featureDefines, featureMarker, stageRuns, isReleaseVersion, listedExperiments, type ClientPreferences, type ExperimentId } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';

const RELEASE = '2.0.0';
const NIGHTLY = '2.0.1-nightly.20261113.1';
const DEV = '2.0.0-beta.1';
const GRADUATED: ExperimentId[] = ['whip', 'contacts', 'auto-goal', 'teams', 'debates'];
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

test('a version without a prerelease part is a Release, and no build lists a switch while every feature is finished', () => {
  expect(['2.0.0', '0.1.1', '', null, undefined].map(isReleaseVersion)).toEqual([true, true, true, true, true]);
  expect(['2.0.0-nightly.20261111.1', '2.0.0-beta.1', '2.0.0-test.0'].map(isReleaseVersion)).toEqual([false, false, false]);

  // Every switch has a stage, and the sort is the one the docs state.
  expect(Object.keys(EXPERIMENT_STAGES).sort()).toEqual([...EXPERIMENT_IDS].sort());
  for (const version of [RELEASE, NIGHTLY, DEV]) expect(listedExperiments(version), version).toEqual([]);

  // Finished features are on whatever a device stored, in every build.
  for (const version of [RELEASE, NIGHTLY, DEV]) expect(effectiveExperiments([], version), version).toEqual([...EXPERIMENT_IDS]);
  expect(effectiveExperiments(['whip', 'gone'], RELEASE)).toEqual([...EXPERIMENT_IDS]);
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
  // The real table with one feature of each tag: whip stands for a dev feature, teams for a nightly one.
  const stages = { ...EXPERIMENT_STAGES, whip: 'dev', teams: 'nightly' } as const;

  expect(listedExperiments(DEV, stages)).toContain('whip');
  expect(listedExperiments(NIGHTLY, stages)).not.toContain('whip');
  expect(listedExperiments(RELEASE, stages)).not.toContain('whip');
  expect(experimentRefusal('whip', DEV, stages)).toBeNull();
  expect(experimentRefusal('whip', NIGHTLY, stages)).toBe(`experiment.whip runs in Dev builds only, and this machine runs a Nightly (${NIGHTLY}): it is still being built and no published build has it`);
  expect(experimentRefusal('whip', RELEASE, stages)).toBe(`experiment.whip runs in Dev builds only, and this machine runs a Release (${RELEASE}): it is still being built and no published build has it`);
  expect(experimentStartRefusal('whip', NIGHTLY, stages)).toContain('runs in Dev builds only');

  expect(listedExperiments(DEV, stages)).toContain('teams');
  expect(listedExperiments(NIGHTLY, stages)).toContain('teams');
  expect(listedExperiments(RELEASE, stages)).not.toContain('teams');
  expect(experimentRefusal('teams', NIGHTLY, stages)).toBeNull();
  expect(experimentRefusal('teams', DEV, stages)).toBeNull();
  expect(experimentRefusal('teams', RELEASE, stages)).toBe(`experiment.teams runs in Nightly and Dev builds only, and this machine runs a Release (${RELEASE}): switch the update channel to Nightly in Settings > Machines and updates to try it`);

  // A stored choice for a feature the build lacks is ignored, and still there for the build that has it.
  const chosen = ['whip', 'teams'];
  expect(effectiveExperiments(chosen, DEV, stages)).toEqual(expect.arrayContaining(['whip', 'teams']));
  expect(effectiveExperiments(chosen, NIGHTLY, stages)).toContain('teams');
  expect(effectiveExperiments(chosen, NIGHTLY, stages)).not.toContain('whip');
  expect(effectiveExperiments(chosen, RELEASE, stages)).toEqual(effectiveExperiments([], RELEASE, stages));
  expect(chosen).toEqual(['whip', 'teams']);
});

test('a build is compiled with one constant for its kind and one flag per tagged feature', () => {
  const stages = { ...EXPERIMENT_STAGES, whip: 'dev', teams: 'nightly' } as const;
  expect(featureDefines(RELEASE, stages)).toMatchObject({ __BOITE_BUILD_KIND__: '"release"', __BOITE_HAS_WHIP__: 'false', __BOITE_HAS_TEAMS__: 'false' });
  expect(featureDefines(NIGHTLY, stages)).toMatchObject({ __BOITE_BUILD_KIND__: '"nightly"', __BOITE_HAS_WHIP__: 'false', __BOITE_HAS_TEAMS__: 'true' });
  expect(featureDefines(DEV, stages)).toMatchObject({ __BOITE_BUILD_KIND__: '"dev"', __BOITE_HAS_WHIP__: 'true', __BOITE_HAS_TEAMS__: 'true' });
  // A finished feature has no flag: nothing of it is ever cut.
  expect(Object.keys(featureDefines(RELEASE))).toEqual(['__BOITE_BUILD_KIND__']);
  // From source nothing is compiled out, and a finished feature is in every bundle.
  expect(featureCompiled('whip')).toBe(true);
  expect(featureCompiled('whip', 'release')).toBe(true);
  expect(featureCompiled('theme-grain', 'release')).toBe(true);
  // Only a feature above the release tag can be cut, and its marker is its own.
  for (const id of Object.keys(FEATURE_CUTS) as ExperimentId[]) expect(EXPERIMENT_STAGES[id], id).not.toBe('release');
  expect(featureMarker('whip')).toBe('boite-feature:whip');
});

test('a Release core has every feature on before any app reported, as after a restart: teams, the council and goal track answer', async () => {
  const h = await core(RELEASE);
  const owner = await h.connect();
  const { threadId } = await echoThread(h, owner);
  expect(h.core.clients.desktopExperiments()).toBeNull();
  expect((await owner.call('teams.list', {})).teams).toEqual([]);
  expect((await owner.call('council.list', {})).councils).toEqual([]);
  // The thread holds no prompt yet: goal track gets that far, past any switch.
  expect(() => h.core.activity.track(threadId)).toThrow('this conversation has no prompt of the user to track');
  owner.close();
});

test('automatic goals follow the machine\'s own setting: on by default, off for prompts and goal track alike', async () => {
  const { startsAutoGoal } = await import('../src/composer-activity.ts');
  const long = 'x'.repeat(2000);
  expect(startsAutoGoal(long, {})).toBe(true);
  expect(startsAutoGoal(long, { autoGoals: true, autoGoalMinChars: 3000 })).toBe(false);
  expect(startsAutoGoal(long, { autoGoals: false })).toBe(false);
  const h = await core(RELEASE);
  const owner = await h.connect();
  const { threadId } = await echoThread(h, owner);
  await owner.call('settings.set', { autoGoals: false });
  expect(() => h.core.activity.track(threadId)).toThrow('goal track needs automatic goals, which the owner turned off on this machine');
  expect(await owner.call('settings.set', { autoGoals: 'yes' } as never).catch((error: Error) => error.message)).toContain('autoGoals must be a boolean');
  owner.close();
});

test('a former experiment\'s card says it is finished, and the former experimental settings take a card like any other', async () => {
  const h = await core(RELEASE);
  const owner = await desktop(h);
  const { threadId } = await echoThread(h, owner);
  // A card needs a turn to sit under.
  const finished = owner.next('turn.finished', turn => turn.threadId === threadId, 10000);
  await owner.call('turns.start', { threadId, prompt: 'hello' });
  await finished;

  // The historic field and the chosen list: every feature is in force, whatever the app chose.
  expect(await owner.call('client.preferences', report(GRADUATED))).toEqual({ ok: true, desktop: [...EXPERIMENT_IDS], desktopChosen: GRADUATED });
  const read = await owner.call('agent.settings', { threadId });
  expect(read.settings.filter(setting => setting.key.startsWith('experiment.'))).toEqual([]);
  expect(read.settings.find(setting => setting.key === 'cacheKeepalive')).toMatchObject({ value: null, page: 'advanced', section: 'cache-keepalive' });

  expect(await owner.call('settings.request', { threadId, reason: 'Try the whip', key: 'experiment.whip', value: true }).catch((error: Error) => error.message)).toContain('no longer an experiment');
  const { setting } = await owner.call('settings.request', { threadId, reason: 'Watch the phone', key: 'deviceStream', value: true });
  expect(setting).toMatchObject({ kind: 'change', key: 'deviceStream', value: true, previous: false, page: 'advanced', section: 'device-stream' });
  owner.close();
});

test('a setting a Nightly turned on while it was an experiment stays on in a Release, which saves it like any other', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-stages-'));
  dirs.push(dataDir);

  const nightly = await core(NIGHTLY, dataDir);
  let owner = await nightly.connect();
  await owner.call('settings.set', { deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 }, compactionByType: { bot: { autoCompact: null, backgroundCompaction: true } } });
  owner.close();
  await cores.pop()!.stop();

  const release = await core(RELEASE, dataDir);
  owner = await release.connect();
  expect(await owner.call('settings.get', {})).toMatchObject({ deviceStream: true, backgroundCompaction: true, cacheKeepalive: { hours: 2 }, compactionByType: { bot: { backgroundCompaction: true } } });
  expect(await owner.call('settings.set', { deviceStream: false })).toMatchObject({ deviceStream: false });
  expect(release.core.settings.stored().deviceStream).toBe(false);
  expect(await owner.call('settings.set', { deviceStream: true })).toMatchObject({ deviceStream: true });
  owner.close();
});

test('a Release core lets Contacts start something', async () => {
  const release = await core(RELEASE);
  const owner = await release.connect();
  for (const call of [
    owner.call('contacts.invite', {}),
    owner.call('contacts.join', { link: 'boite://contact/none' }),
    owner.call('contacts.update', { coreId: 'none', trusted: true }),
  ]) expect(await call.then(() => 'accepted', (error: Error) => error.message)).not.toContain('Nightly');
  owner.close();
});
