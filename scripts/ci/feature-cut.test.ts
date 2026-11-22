import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPERIMENT_IDS, EXPERIMENT_STAGES, FEATURE_CUTS, featureDefines, featureFlag, featureMarker, type ExperimentId, type FeatureStage } from '../../packages/contracts/src/experiments.ts';
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

// Two stand-in ids, so the scan is tried on a dev feature cut from both bundles beside a nightly one cut from the UI.
const WHIP = 'whip' as unknown as ExperimentId;
const TEAMS = 'teams' as unknown as ExperimentId;
const stages: Record<ExperimentId, FeatureStage> = { ...EXPERIMENT_STAGES, [WHIP]: 'dev', [TEAMS]: 'nightly' };
const cuts: Cuts = { [WHIP]: { ui: true, core: true }, [TEAMS]: { ui: true, core: false } };
const whip = `mark("${featureMarker(WHIP)}")`;
const teams = `const m="${featureMarker(TEAMS)}"`;

test('a bundle that holds exactly the features of its kind passes, for each of the three kinds', () => {
  expect(scanBundle(bundle({ 'index.html': '<html>', 'assets/app.js': 'boot()' }), 'ui', 'release', cuts, stages)).toEqual([]);
  expect(scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/teams.js': teams }), 'ui', 'nightly', cuts, stages)).toEqual([]);
  expect(scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/teams.js': teams, 'assets/whip.js': whip }), 'ui', 'dev', cuts, stages)).toEqual([]);
  // The core side reads its own column: teams is not cut from the core, so its marker says nothing there.
  expect(scanBundle(bundle({ 'main.js': `boot();${teams}` }), 'core', 'release', cuts, stages)).toEqual([]);
});

test('a planted leak fails: a dev feature in a Nightly or a Release, a nightly feature in a Release', () => {
  const nightly = scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/teams.js': teams, 'assets/chunk-9f.js': `a();${whip};b()` }), 'ui', 'nightly', cuts, stages);
  expect(nightly).toEqual([{ side: 'ui', kind: 'nightly', feature: WHIP, problem: 'leak', files: ['assets/chunk-9f.js'] }]);
  expect(describe(nightly[0]!, stages)).toBe('ui bundle (nightly): holds "boite-feature:whip" in assets/chunk-9f.js, but whip is tagged dev. Something imports its code outside its lazy entry (docs/internals/experiments.md#out-of-the-build)');

  const release = scanBundle(bundle({ 'index.html': `<script>${teams}</script>`, 'assets/app.js': whip }), 'ui', 'release', cuts, stages);
  expect(release.map(finding => [finding.feature, finding.problem, finding.files])).toEqual([['whip', 'leak', ['assets/app.js']], ['teams', 'leak', ['index.html']]]);

  expect(scanBundle(bundle({ 'main.js': 'boot()', 'cli-abc.js': whip }), 'core', 'release', cuts, stages).map(finding => finding.problem)).toEqual(['leak']);
});

test('a bundle that lost the marker of a feature it must hold fails too, and so does an empty directory', () => {
  const lost = scanBundle(bundle({ 'assets/app.js': 'boot()', 'assets/whip.js': whip }), 'ui', 'dev', cuts, stages);
  expect(lost).toEqual([{ side: 'ui', kind: 'dev', feature: TEAMS, problem: 'lost', files: [] }]);
  expect(describe(lost[0]!, stages)).toContain('"boite-feature:teams" is nowhere');
  // The compressed copies and binary assets are not read: a marker is looked for in text.
  expect(() => scanBundle(bundle({ 'assets/app.js.br': 'x', 'assets/font.woff2': 'x' }), 'ui', 'release', cuts, stages)).toThrow('holds no bundle');
});

test('the five finished features left the registry, their lazy entries load with no flag, and the contracts name no marker', () => {
  const root = join(import.meta.dir, '..', '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  // Every build holds the five: nothing reads their stage, so they are no experiment ids any more.
  for (const id of ['whip', 'debates', 'contacts', 'teams', 'auto-goal']) {
    expect(EXPERIMENT_IDS as readonly string[], id).not.toContain(id);
    expect((FEATURE_CUTS as Record<string, unknown>)[id], id).toBeUndefined();
  }
  const entries = [
    'packages/ui/src/lib/whip-entry.svelte.ts',
    'packages/ui/src/lib/council-entry.ts',
    'packages/core/src/council-entry.ts',
    'packages/core/src/delegate-cli.ts',
    'packages/ui/src/lib/contacts-entry.ts',
    'packages/ui/src/lib/teams-entry.ts',
    'packages/core/src/teams-entry.ts',
    'packages/core/src/auto-goal-entry.ts',
    'packages/ui/src/lib/deferred-parts.ts',
  ];
  for (const entry of entries) expect(read(entry), entry).not.toContain('__BOITE_HAS_');
  // The contracts file names no marker in full, or every bundle would hold them all.
  const contracts = read('packages/contracts/src/experiments.ts');
  for (const id of EXPERIMENT_IDS) expect(contracts, id).not.toContain(featureMarker(id));
});

test('every feature declared cut has one lazy entry that writes its flag in full', () => {
  const root = join(import.meta.dir, '..', '..');
  /** The entry of each cut feature, by bundle: the only module that imports the feature's code. */
  const entries: Partial<Record<ExperimentId, { ui?: string; core?: string }>> = {
    'draft-backdrop': { ui: 'packages/ui/src/lib/backdrop-entry.svelte.ts' },
  };
  expect(Object.keys(entries).sort()).toEqual(Object.keys(FEATURE_CUTS).sort());
  for (const [id, cut] of Object.entries(FEATURE_CUTS) as [ExperimentId, { ui: boolean; core: boolean }][]) {
    for (const side of ['ui', 'core'] as const) {
      const entry = entries[id]?.[side];
      expect(entry !== undefined, `${id} ${side}`).toBe(cut[side]);
      if (!entry) continue;
      expect(existsSync(join(root, entry)), entry).toBe(true);
      // The gate is the flag written in full, in the entry itself: nothing less folds.
      expect(readFileSync(join(root, entry), 'utf8'), entry).toContain(`typeof ${featureFlag(id)} === 'undefined' || ${featureFlag(id)}`);
    }
  }
});

test('the UI build and the core build define the kind and the flags of the stamped version', async () => {
  const root = join(import.meta.dir, '..', '..');
  const { default: config } = await import('../../packages/ui/vite.config.ts');
  const { defineFlags } = await import('../../packages/core/bin/defines.ts');
  const { buildKindOf } = await import('../../packages/contracts/src/experiments.ts');
  const uiVersion = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
  for (const mode of ['production', 'mobile']) expect(config({ command: 'build', mode }).define).toMatchObject(featureDefines(uiVersion));

  // The compiled sidecar still invokes the Bun CLI.
  expect(defineFlags('2.0.0')).toEqual(Object.entries(featureDefines('2.0.0')).flatMap(([name, value]) => ['--define', `${name}=${value}`]));
  const core = join(root, 'packages', 'core');
  expect(readFileSync(join(core, 'bin', 'compile.ts'), 'utf8')).toContain('defineFlags(');

  // Record the defines passed to each real Bun.build in a fresh process.
  const dir = bundle({ 'report-defines.ts': `
    const build = Bun.build;
    Bun.build = (options) => {
      console.log('defines: ' + JSON.stringify(options.define ?? null));
      return build(options);
    };
  ` });
  const coreVersion = (JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')) as { version: string }).version;
  const override = buildKindOf(coreVersion) === 'nightly' ? '0.0.0' : '0.0.0-nightly.20260101.1';
  for (const { version, args } of [{ version: coreVersion, args: [] }, { version: override, args: ['--version', override] }]) {
    const child = Bun.spawn([
      process.execPath, '--preload', join(dir, 'report-defines.ts'), join(core, 'bin', 'build.ts'),
      '--outdir', join(dir, 'out'), ...args,
    ], { cwd: core, stdout: 'pipe', stderr: 'inherit', windowsHide: true, timeout: 30_000 });
    const stdout = await child.stdout.text();
    expect(await child.exited, stdout).toBe(0);
    const defineLines = stdout.split('\n').filter(line => line.startsWith('defines: '));
    expect(defineLines.length, stdout).toBeGreaterThan(0);
    for (const line of defineLines) expect(JSON.parse(line.slice('defines: '.length)), version).toEqual(featureDefines(version));
  }
}, 65_000);

/** The sources of the UI and the core, as paths from the root. */
function sources(root: string, directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(root, path);
    return /\.(?:ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

test('every module of a cut feature calls markFeature with its marker, no other module calls it, and no file of a feature directory is unaccounted for', () => {
  const root = join(import.meta.dir, '..', '..');
  expect(Object.keys(FEATURE_MODULES).sort()).toEqual(Object.keys(FEATURE_CUTS).sort());
  for (const [id, sides] of Object.entries(FEATURE_MODULES) as [ExperimentId, { ui: string[]; core: string[] }][]) {
    for (const side of ['ui', 'core'] as const) {
      expect(sides[side].length > 0, `${id} ${side}`).toBe(FEATURE_CUTS[id]![side]);
      for (const file of sides[side]) expect(readFileSync(join(root, file), 'utf8'), file).toContain(`markFeature('${featureMarker(id)}');`);
    }
  }
  // A marker left in a module of a feature that is no longer cut would make the scan read it as a leak the day the feature is cut again.
  const listed = new Set(Object.values(FEATURE_MODULES).flatMap((sides) => [...sides!.ui, ...sides!.core]));
  const marking = [...sources(root, 'packages/ui/src'), ...sources(root, 'packages/core/src')].filter((file) => readFileSync(join(root, file), 'utf8').includes("markFeature('boite-feature:"));
  expect(marking.filter((file) => !listed.has(file))).toEqual([]);
  for (const [id, directories] of Object.entries(FEATURE_DIRECTORIES) as [ExperimentId, string[]][]) {
    const own = new Set([...FEATURE_MODULES[id]!.ui, ...FEATURE_MODULES[id]!.core]);
    for (const directory of directories) {
      for (const name of readdirSync(join(root, directory))) {
        const file = `${directory}/${name}`;
        if (name.endsWith('.test.ts') || !/\.(?:ts|svelte)$/.test(name)) continue;
        expect(own.has(file) || file in STAYS, `${file} is in the directory of ${id}: list it in feature-modules.ts, or in STAYS with its reason`).toBe(true);
      }
    }
  }
});

test('a cut module imported directly, outside its entry, is a leak the scan sees in a real Release bundle, and one behind its flag is not', async () => {
  const contracts = JSON.stringify(join(import.meta.dir, '..', '..', 'packages', 'contracts', 'src', 'experiments.ts'));
  // Resident agents stand for a nightly feature cut from the core, as the five were before they finished: featureDefines writes flags for registered ids only.
  const id: ExperimentId = 'resident-agents';
  const nightly: Record<ExperimentId, FeatureStage> = { ...EXPERIMENT_STAGES, [id]: 'nightly' };
  const cut: Cuts = { [id]: { ui: false, core: true } };
  const module = `import { markFeature } from ${contracts};\nexport class TeamStore { size() { return 1; } }\nmarkFeature('${featureMarker(id)}');\n`;
  // What a careless change does: a static import of one name of a cut module. The bundler keeps the code and drops every unused export.
  const direct = `import { TeamStore } from './store.ts';\n(globalThis as Record<string, unknown>).leaked = TeamStore;\n`;
  // What an entry does: the flag written in full before the require, folded and dropped in a Release.
  const gated = `declare const ${featureFlag(id)}: boolean | undefined;\n(globalThis as Record<string, unknown>).store = typeof ${featureFlag(id)} === 'undefined' || ${featureFlag(id)} ? require('./store.ts') : null;\n`;
  const found: Record<string, string[]> = {};
  for (const [name, entry] of [['direct', direct], ['gated', gated]] as const) {
    const dir = bundle({ 'store.ts': module, 'entry.ts': entry });
    const outdir = join(dir, 'out');
    const built = await Bun.build({ entrypoints: [join(dir, 'entry.ts')], target: 'bun', define: featureDefines('2.0.0', nightly), minify: true, splitting: true, outdir });
    expect(built.success, name).toBe(true);
    found[name] = scanBundle(outdir, 'core', 'release', cut, nightly).map((finding) => `${finding.feature} ${finding.problem}`);
  }
  expect(found).toEqual({ direct: ['resident-agents leak'], gated: [] });
}, 60_000);
