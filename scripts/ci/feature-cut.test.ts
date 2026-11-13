import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPERIMENT_IDS, EXPERIMENT_STAGES, FEATURE_CUTS, featureDefines, featureFlag, featureMarker, type ExperimentId } from '../../packages/contracts/src/experiments.ts';
import { describe, scanBundle, type Cuts } from './feature-cut.ts';
import { FEATURE_DIRECTORIES, FEATURE_MODULES, STAYS } from './feature-modules.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A bundle directory holding these files. */
function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'boite-feature-cut-test-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

// Whip stands for a dev feature and teams for a nightly one; both cut from both bundles.
const stages = { ...EXPERIMENT_STAGES, whip: 'dev', teams: 'nightly' } as const;
const cuts: Cuts = { whip: { ui: true, core: true }, teams: { ui: true, core: false } };
const whip = `mark("${featureMarker('whip')}")`;
const teams = `const m="${featureMarker('teams')}"`;

test('a bundle that holds exactly the features of its kind passes, for each of the three kinds', () => {
  expect(scanBundle(bundle({ 'index.html': '<html>', 'assets/app.js': 'boot()' }), 'ui', 'release', cuts, stages)).toEqual([]);
  expect(scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/teams.js': teams }), 'ui', 'nightly', cuts, stages)).toEqual([]);
  expect(scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/teams.js': teams, 'assets/whip.js': whip }), 'ui', 'dev', cuts, stages)).toEqual([]);
  // The core side reads its own column: teams is not cut from the core, so its marker says nothing there.
  expect(scanBundle(bundle({ 'main.js': `boot();${teams}` }), 'core', 'release', cuts, stages)).toEqual([]);
});

test('a planted leak fails: a dev feature in a Nightly or a Release, a nightly feature in a Release', () => {
  const nightly = scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/teams.js': teams, 'assets/chunk-9f.js': `a();${whip};b()` }), 'ui', 'nightly', cuts, stages);
  expect(nightly).toEqual([{ side: 'ui', kind: 'nightly', feature: 'whip', problem: 'leak', files: ['assets/chunk-9f.js'] }]);
  expect(describe(nightly[0]!, stages)).toBe('ui bundle (nightly): holds "boite-feature:whip" in assets/chunk-9f.js, but whip is tagged dev. Something imports its code outside its lazy entry (docs/internals/experiments.md#out-of-the-build)');

  const release = scanBundle(bundle({ 'index.html': `<script>${teams}</script>`, 'assets/app.js': whip }), 'ui', 'release', cuts, stages);
  expect(release.map(finding => [finding.feature, finding.problem, finding.files])).toEqual([['whip', 'leak', ['assets/app.js']], ['teams', 'leak', ['index.html']]]);

  expect(scanBundle(bundle({ 'main.js': 'boot()', 'cli-abc.js': whip }), 'core', 'release', cuts, stages).map(finding => finding.problem)).toEqual(['leak']);
});

test('a bundle that lost the marker of a feature it must hold fails too, and so does an empty directory', () => {
  const lost = scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/whip.js': whip }), 'ui', 'dev', cuts, stages);
  expect(lost).toEqual([{ side: 'ui', kind: 'dev', feature: 'teams', problem: 'lost', files: [] }]);
  expect(describe(lost[0]!, stages)).toContain('"boite-feature:teams" is nowhere');
  // The compressed copies and binary assets are not read: a marker is looked for in text.
  expect(() => scanBundle(bundle({ 'assets/app.js.br': 'x', 'assets/font.woff2': 'x' }), 'ui', 'release', cuts, stages)).toThrow('holds no bundle');
});

test('every feature declared cut writes its marker and its flag in the sources, and nothing writes the marker of another', () => {
  const root = join(import.meta.dir, '..', '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  /** Where each cut feature's marker and gate live: the module its lazy entry loads, and that entry. */
  const places: Partial<Record<ExperimentId, { ui?: { marker: string[]; entry: string }; core?: { marker: string[]; entry: string } }>> = {
    whip: { ui: { marker: ['packages/ui/src/components/WhipButton.svelte'], entry: 'packages/ui/src/lib/whip-entry.svelte.ts' } },
    debates: {
      ui: { marker: ['packages/ui/src/components/council/CouncilSalon.svelte', 'packages/ui/src/components/council/CouncilCard.svelte'], entry: 'packages/ui/src/lib/council-entry.ts' },
      // (the card's own gated import is in lib/deferred-parts.ts, which the salon's modules import: checked below)
      // (the store and the RPC methods have their own entry, core/src/council-entry.ts: checked below)
      core: { marker: ['packages/core/src/council/cli.ts', 'packages/core/src/council/store.ts', 'packages/core/src/council/rpc.ts'], entry: 'packages/core/src/delegate-cli.ts' },
    },
    contacts: { ui: { marker: ['HomePage', 'ContactsRail', 'ContactRows', 'ContactRequestNotice', 'ContactInboxRows', 'SidebarContacts'].map((name) => `packages/ui/src/components/home/${name}.svelte`).concat(['SharedThreadDialog', 'SharedProjectThreads', 'SharedProjectDialog'].map((name) => `packages/ui/src/components/shared/${name}.svelte`)), entry: 'packages/ui/src/lib/contacts-entry.ts' } },
    teams: {
      ui: { marker: ['teams/TeamChat', 'teams/TeamDialog', 'teams/TeamHeader', 'TeamCard'].map((name) => `packages/ui/src/components/${name}.svelte`), entry: 'packages/ui/src/lib/teams-entry.ts' },
      core: { marker: ['packages/core/src/teams/store.ts', 'packages/core/src/teams/rpc.ts', 'packages/core/src/team-cli.ts'], entry: 'packages/core/src/teams-entry.ts' },
    },
    'auto-goal': { ui: { marker: ['packages/ui/src/components/AutoGoalSetting.svelte'], entry: 'packages/ui/src/lib/auto-goal-entry.ts' }, core: { marker: ['packages/core/src/auto-goal.ts'], entry: 'packages/core/src/auto-goal-entry.ts' } },
  };
  expect(Object.keys(places).sort()).toEqual(Object.keys(FEATURE_CUTS).sort());
  for (const [id, cut] of Object.entries(FEATURE_CUTS) as [ExperimentId, { ui: boolean; core: boolean }][]) {
    for (const side of ['ui', 'core'] as const) {
      const place = places[id]?.[side];
      expect(place !== undefined, `${id} ${side}`).toBe(cut[side]);
      if (!place) continue;
      for (const file of place.marker) expect(read(file), file).toContain(featureMarker(id));
      // The gate is the flag written in full, in the entry itself: nothing less folds.
      expect(read(place.entry), place.entry).toContain(`typeof ${featureFlag(id)} === 'undefined' || ${featureFlag(id)}`);
      expect(existsSync(join(root, place.entry))).toBe(true);
    }
  }
  for (const id of ['debates', 'contacts', 'teams'] as const) expect(read('packages/ui/src/lib/deferred-parts.ts')).toContain(`typeof ${featureFlag(id)} === 'undefined' || ${featureFlag(id)}`);
  expect(read('packages/core/src/council-entry.ts')).toContain(`typeof ${featureFlag('debates')} === 'undefined' || ${featureFlag('debates')}`);
  // The contracts file names no marker in full, or every bundle would hold them all.
  const contracts = read('packages/contracts/src/experiments.ts');
  for (const id of EXPERIMENT_IDS) expect(contracts, id).not.toContain(featureMarker(id));
});

test('the UI build and the core build define the kind and the flags of the stamped version', async () => {
  const { default: config } = await import('../../packages/ui/vite.config.ts');
  const version = (JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  expect((config as { define?: Record<string, string> }).define).toMatchObject(featureDefines(version));
  // The bundle and the compiled sidecar both pass the same flags.
  const { defineFlags } = await import('../../packages/core/bin/defines.ts');
  expect(defineFlags('2.0.0')).toEqual(Object.entries(featureDefines('2.0.0')).flatMap(([name, value]) => ['--define', `${name}=${value}`]));
  for (const script of ['build.ts', 'compile.ts']) expect(readFileSync(join(import.meta.dir, '..', '..', 'packages', 'core', 'bin', script), 'utf8'), script).toContain('defineFlags(');
});

test('every module of a cut feature calls markFeature with its marker, and no file of a feature directory is unaccounted for', () => {
  const root = join(import.meta.dir, '..', '..');
  expect(Object.keys(FEATURE_MODULES).sort()).toEqual(Object.keys(FEATURE_CUTS).sort());
  for (const [id, sides] of Object.entries(FEATURE_MODULES) as [ExperimentId, { ui: string[]; core: string[] }][]) {
    for (const side of ['ui', 'core'] as const) {
      expect(sides[side].length > 0, `${id} ${side}`).toBe(FEATURE_CUTS[id]![side]);
      for (const file of sides[side]) expect(readFileSync(join(root, file), 'utf8'), file).toContain(`markFeature('${featureMarker(id)}');`);
    }
  }
  for (const [id, directories] of Object.entries(FEATURE_DIRECTORIES) as [ExperimentId, string[]][]) {
    const listed = new Set([...FEATURE_MODULES[id]!.ui, ...FEATURE_MODULES[id]!.core]);
    for (const directory of directories) {
      for (const name of readdirSync(join(root, directory))) {
        const file = `${directory}/${name}`;
        if (/\.test\.ts$/.test(name) || !/\.(?:ts|svelte)$/.test(name)) continue;
        expect(listed.has(file) || file in STAYS, `${file} is in the directory of ${id}: list it in feature-modules.ts, or in STAYS with its reason`).toBe(true);
      }
    }
  }
});

test('a core module imported directly, outside its entry, is a leak the scan sees in a real Release bundle', async () => {
  const root = join(import.meta.dir, '..', '..');
  // What a careless change does: a static import of one name of a cut module. The bundler keeps the code and drops every unused export.
  const leaks: [ExperimentId, string, string][] = [
    ['teams', 'packages/core/src/teams/store.ts', 'TeamStore'],
    ['debates', 'packages/core/src/council/store.ts', 'CouncilStore'],
    ['auto-goal', 'packages/core/src/auto-goal.ts', 'autoGoal'],
  ];
  for (const [id, file, name] of leaks) {
    const dir = bundle({ 'entry.ts': `import { ${name} } from ${JSON.stringify(join(root, file))};\n(globalThis as Record<string, unknown>).leaked = ${name};\n` });
    const outdir = join(dir, 'out');
    const built = await Bun.build({ entrypoints: [join(dir, 'entry.ts')], target: 'bun', define: featureDefines('2.0.0'), minify: true, splitting: true, outdir });
    expect(built.success, id).toBe(true);
    expect(scanBundle(outdir, 'core', 'release').filter(finding => finding.feature === id).map(finding => finding.problem), `${id}: ${file} imported directly`).toEqual(['leak']);
  }
}, 60_000);
