import { expect, test } from 'bun:test';
import { CORE_ALL, PORTABLE_ALL } from './changes.ts';
import { ADVISORY, compareRuleset, jobChecks, loadWorkflow, requiredChecks, shardJobs, workflowChecks, type Job, type Workflow } from './required-checks.ts';

const files = [...new Bun.Glob('*.yml').scanSync(`${import.meta.dir}/../../.github/workflows`)].sort();

// A ruleset that requires these names blocks every pull request once one
// is renamed, so a rename fails here first: update the ruleset with it.
test('a pull request reports the same fixed check names whichever jobs run', () => {
  const names = requiredChecks(files);
  for (const name of names) expect(name).not.toContain('${{');
  expect(names).toEqual([
    'Android / apk',
    'Android server / apk',
    'Build UI',
    // Bundle size is reported but advisory (ADVISORY in required-checks.ts).
    // Written out, not derived from CORE_ALL or PORTABLE_ALL: renaming a runner
    // renames a required check too.
    'Core tests (Linux arm64)',
    'Core tests (Linux x64) 1/2',
    'Core tests (Linux x64) 2/2',
    'Core tests (Windows x64) 1/2',
    'Core tests (Windows x64) 2/2',
    'Core tests (macOS arm64)',
    'Core tests (macOS x64)',
    'Desktop / Linux arm64',
    'Desktop / Linux x64',
    'Desktop / macOS arm64',
    'Desktop / macOS x64',
    'Desktop / Windows x64',
    'Desktop / Windows x64 Rust tests',
    'E2E 1/5',
    'E2E 2/5',
    'E2E 3/5',
    'E2E 4/5',
    'E2E 5/5',
    'E2E type check',
    'Native Windows protection',
    'PR title',
    'Plan',
    'Repository checks',
    'Server / verify server (amd64)',
    'Server / verify server (arm64)',
    'Stress fixtures',
    'Telemetry relay tests',
    'Type checks and UI tests 1/2',
    'UI tests 2/2',
  ].sort());
  // labeler.yml runs the base's workflow through pull_request_target.
  // An advisory name that no job reports any more is a stale exception.
  const reported = ['ci.yml', 'mobile.yml'].flatMap((file) => workflowChecks(file));
  for (const name of ADVISORY) expect(reported).toContain(name);
});

test('every job a needs chain runs through is in the list, so a skip after a failed dependency comes with a failed check', () => {
  const names = requiredChecks(files);
  const ci = loadWorkflow('ci.yml');
  const shards = shardJobs(ci.jobs);
  for (const [id, job] of Object.entries(ci.jobs)) {
    for (const need of [job.needs ?? []].flat()) {
      // A shard reports through the job that runs after it whatever its result.
      if (shards.get(need) === id) continue;
      for (const check of jobChecks('ci.yml', need, ci.jobs[need]!)) expect(names).toContain(check);
    }
  }
});

// The Intel Mac's core suite runs in two shards, past the 15 minutes of one
// job, under the one name the ruleset already requires (docs/internals/ci.md#check-names).
test('a sharded check reports through one job of its name, which fails unless every shard passed', () => {
  const ci = loadWorkflow('ci.yml');
  const shards = shardJobs(ci.jobs);
  expect([...shards]).toEqual([['core-macos-x64-1', 'macos-x64-core'], ['core-macos-x64-2', 'macos-x64-core']]);
  type Step = { run?: string; env?: Record<string, string> };
  const job = ci.jobs['macos-x64-core'] as Job & { steps: Step[] };
  expect(job.name).toBe('Core tests (macOS x64)');
  expect(job.needs).toEqual(['changes', 'core-macos-x64-1', 'core-macos-x64-2']);
  // It runs whenever its shards do, after them, even when one failed, timed out or was cancelled.
  for (const shard of ['core-macos-x64-1', 'core-macos-x64-2']) expect(job.if).toBe(`\${{ !cancelled() && ${ci.jobs[shard]!.if} }}`);
  expect(job.steps).toHaveLength(1);
  const [step] = job.steps;
  expect(step!.env).toEqual({ RESULTS: '${{ needs.core-macos-x64-1.result }} ${{ needs.core-macos-x64-2.result }}' });
  const exit = (results: string) => Bun.spawnSync(['bash', '-c', step!.run!], { env: { PATH: process.env.PATH, RESULTS: results }, stdout: 'pipe', stderr: 'pipe' }).exitCode;
  expect(exit('success success')).toBe(0);
  // A failed, timed out (cancelled), skipped or missing shard fails the check.
  for (const results of ['failure success', 'success failure', 'cancelled success', 'success cancelled', 'skipped success', 'success skipped', 'success', '']) {
    expect(exit(results), results).not.toBe(0);
  }
  // The shards themselves are left out of the ruleset; the names stay those pinned above.
  const names = requiredChecks(files);
  expect(names).toContain('Core tests (macOS x64)');
  for (const name of ['Core tests (macOS x64) 1/2', 'Core tests (macOS x64) 2/2']) expect(names).not.toContain(name);
});

test('only a job after every result, named as its shards, covers them', () => {
  const load = (jobs: Workflow['jobs']) => () => ({ on: { pull_request: null }, jobs });
  const shard = (name: string) => ({ name, needs: 'plan', if: "needs.plan.outputs.a == 'true'" });
  const after = "${{ !cancelled() && needs.plan.outputs.a == 'true' }}";
  expect(requiredChecks(['x.yml'], load({ plan: { name: 'Plan' }, a1: shard('A 1/2'), a2: shard('A 2/2'), a: { name: 'A', needs: ['plan', 'a1', 'a2'], if: after } })))
    .toEqual(['A', 'Plan']);
  // A job that skips after a failed shard, or names other jobs, covers nothing.
  expect(requiredChecks(['x.yml'], load({ plan: { name: 'Plan' }, a1: shard('A 1/2'), a: { name: 'A', needs: ['plan', 'a1'], if: "needs.plan.outputs.a == 'true'" } })))
    .toEqual(['A', 'A 1/2', 'Plan']);
  expect(requiredChecks(['x.yml'], load({ plan: { name: 'Plan' }, b: shard('B 1/2'), c: shard('A tests'), a: { name: 'A', needs: ['plan', 'b', 'c'], if: after } })))
    .toEqual(['A', 'A tests', 'B 1/2', 'Plan']);
});

// A pull request runs the Linux checks and skips the rest, which passes the
// ruleset; the merge group runs them for real (docs/internals/ci.md#pull-request-runs).
// So only the plan may skip a job: a condition on the event or the draft flag
// would let a group skip it too, and pass.
test('only the plan decides which jobs run, the same way for a pull request and a merge group', () => {
  const ci = loadWorkflow('ci.yml') as Workflow & { on: { pull_request: unknown } };
  // The default activity types: a draft run already reports what a ready one would.
  expect(ci.on.pull_request).toBeNull();
  const changes = ci.jobs.changes as Job & { env?: unknown; steps: { env?: Record<string, string> }[] };
  expect(JSON.stringify(changes)).not.toContain('draft');
  for (const [id, job] of Object.entries(ci.jobs)) {
    expect(JSON.stringify({ name: job.name, if: job.if }), id).not.toContain('draft');
    if (id === 'changes' || id === 'ruleset' || job.uses) continue;
    // The repository checks run on every change, beside the plan.
    if (id === 'checks') {
      expect(job.if).toBeUndefined();
      expect(job.needs).toBeUndefined();
      continue;
    }
    // Bundle size compares a pull request with its base: the queue skips it.
    if (id === 'size') {
      expect(job.if).toBe("github.event_name == 'pull_request' && needs.changes.outputs.size == 'true'");
      continue;
    }
    // A sharded check's own job runs after its shards, on the same plan output.
    const plan = shardJobs(ci.jobs).has(id) || ![...shardJobs(ci.jobs).values()].includes(id) ? job.if : /^\$\{\{ !cancelled\(\) && (.*) \}\}$/.exec(job.if ?? '')?.[1];
    expect(plan, id).toStartWith('needs.changes.outputs.');
    expect(job.if, id).not.toContain('github.');
  }
  for (const id of ['desktop', 'server', 'android', 'android-server']) {
    const caller = ci.jobs[id] as Job & { with: { enabled: string } };
    expect(caller.with.enabled).toStartWith('${{ needs.changes.outputs.');
    // The called jobs follow their inputs alone.
    for (const [inner, job] of Object.entries(loadWorkflow(caller.uses!.split('/').at(-1)!).jobs)) {
      expect(job.if ?? '', `${id} / ${inner}`).not.toContain('github.');
    }
  }
});

test('main compares the names with the live rules in a job no other job needs', () => {
  const ci = loadWorkflow('ci.yml');
  const ruleset = ci.jobs.ruleset as Job & { steps: { run?: string }[] };
  expect(ruleset.needs).toBeUndefined();
  expect(ruleset.if).toBe("github.event_name != 'pull_request'");
  expect(ruleset.steps.map((step) => step.run)).toContain('bun scripts/ci/required-checks.ts --live');
  for (const job of Object.values(ci.jobs)) expect([job.needs ?? []].flat()).not.toContain('ruleset');
  expect(requiredChecks(files)).not.toContain('Ruleset check names');
});

test('matrix jobs and computed names are refused', () => {
  const load = (jobs: Workflow['jobs']) => () => ({ on: { pull_request: null }, jobs });
  expect(() => requiredChecks(['x.yml'], load({ a: { name: 'Core tests (${{ matrix.name }})' } }))).toThrow('computed name');
  expect(() => requiredChecks(['x.yml'], load({ a: { name: 'Core', strategy: { matrix: { os: ['a', 'b'] } } } }))).toThrow('matrix');
  expect(() => requiredChecks(['x.yml'], load({ a: { name: 'A' }, b: { name: 'A' } }))).toThrow('reported twice');
  expect(() => requiredChecks(['x.yml'], load({ a: { name: "${{ github.event.pull_request.draft && 'A (draft)' || 'A' }}" } }))).toThrow('computed name');
  expect(requiredChecks(['x.yml'], load({ a: { name: 'A', if: "github.event_name != 'pull_request'" } }))).toEqual([]);
  expect(requiredChecks(['x.yml'], () => ({ on: { push: null }, jobs: { a: {} } }))).toEqual([]);
});

// changes.ts picks the runners and platforms; each written-out job must run
// on the one it names, or a selected leg would skip without a failure.
test('each core job runs one shard of its CORE_ALL runner when coreRunners lists it', () => {
  const jobs = Object.entries(loadWorkflow('ci.yml').jobs).filter(([id]) => id.startsWith('core-'));
  expect(jobs.map(([, job]) => ({ os: job['runs-on'], name: job.name, shard: job.env?.BOITE_TEST_SHARD })))
    .toEqual(CORE_ALL.flatMap((runner) => runner.shards
      ? Array.from({ length: runner.shards }, (_, index) => ({ os: runner.os, name: `Core tests (${runner.name}) ${index + 1}/${runner.shards}`, shard: `${index + 1}/${runner.shards}` }))
      : [{ os: runner.os, name: `Core tests (${runner.name})`, shard: undefined }]));
  for (const [, job] of jobs) {
    expect(job.if).toBe(`needs.changes.outputs.core == 'true' && contains(needs.changes.outputs.coreRunners, '"os":"${job['runs-on']}"')`);
  }
  // The quoted label cannot match a longer one.
  const pr = JSON.stringify(CORE_ALL.filter((runner) => runner.os !== 'ubuntu-24.04'));
  expect(pr.includes('"os":"ubuntu-24.04"')).toBe(false);
  expect(pr.includes('"os":"ubuntu-24.04-arm"')).toBe(true);
});

test('protection changes run the native fixtures in their own job beside the Windows core shards', () => {
  const ci = loadWorkflow('ci.yml');
  const changes = ci.jobs.changes as Job & { outputs: Record<string, string> };
  expect(changes.outputs.nativeWindows).toBe('${{ steps.filter.outputs.nativeWindows }}');
  type Step = { id?: string; name?: string; if?: string; run?: string; env?: Record<string, string> };
  const job = ci.jobs['native-windows'] as Job & { 'timeout-minutes': number; steps: Step[] };
  expect(job['runs-on']).toBe('windows-2025');
  expect(job.if).toBe(`needs.changes.outputs.core == 'true' && needs.changes.outputs.nativeWindows == 'true' && contains(needs.changes.outputs.coreRunners, '"os":"windows-2025"')`);
  expect(job['timeout-minutes']).toBe(25);
  const helper = job.steps.find(step => step.name === 'Build userspace native helper')!;
  const native = job.steps.find(step => step.name === 'Native Windows protected tools')!;
  const prepare = job.steps.find(step => step.name === 'Prepare synthetic native providers')!;
  const providers = job.steps.find(step => step.name === 'Native Windows provider and shared scopes')!;
  expect(helper.id).toBe('native_helper');
  expect(prepare).toMatchObject({id: 'native_providers', if: "${{ !cancelled() && steps.native_helper.outcome == 'success' }}"});
  expect(providers.if).toBe("${{ !cancelled() && steps.native_providers.outcome == 'success' }}");
  expect(providers.env).toMatchObject({BOITE_TEST_NATIVE_EXECUTION: '1', BOITE_DIAGNOSE_JOB_EVENTS: '1'});
  expect(providers.run).toContain("@('protected-tool.exe', 'protected-tool-mingw.exe')");
  expect(providers.run).toContain('bun test packages/core/test/protected-muse.test.ts --timeout 120000');
  expect(helper.if).toBe("runner.os == 'Windows' && needs.changes.outputs.nativeWindows == 'true'");
  // A failed helper build stops the matrices that need it.
  expect(native.if).toBeUndefined();
  expect(helper.run).toContain('bun packages/core/bin/install-windows-sandbox.ts');
  expect(helper.run).toContain('BOITE_WINDOWS_SANDBOX_PATH=');
  expect(helper.run).toContain('$env:GITHUB_ENV');
  // Preparation is a prerequisite for later matrices: every native command
  // must stop before a later success can overwrite its exit status.
  const helperLines = helper.run!.trim().split('\n');
  const nativeCommands = helperLines.flatMap((line, index) => /^(?:bun |& )/.test(line) ? [index] : []);
  expect(nativeCommands).toHaveLength(3);
  for (const index of nativeCommands) {
    expect(helperLines[index + 1]).toBe('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }');
  }
  expect(job.steps.indexOf(helper)).toBeLessThan(job.steps.indexOf(native));
  expect(native.env).toMatchObject({ BOITE_TEST_NATIVE_EXECUTION: '1', TEMP: '${{ runner.temp }}', TMP: '${{ runner.temp }}' });
  expect(native.run).toBe(`$failed = $false
foreach ($helper in @('protected-tool.exe', 'protected-tool-mingw.exe')) {
  Write-Host "Native fixture helper: $helper"
  $env:BOITE_WINDOWS_SANDBOX_PATH = "$env:RUNNER_TEMP\\$helper"
  bun test packages/core/test/protected-windows.test.ts --timeout 120000
  if ($LASTEXITCODE -ne 0) { $failed = $true }
}
if ($failed) { exit 1 }
`);
  // The Windows core shards run the suite with the same helper, and none of the matrices.
  for (const id of ['core-windows-x64-1', 'core-windows-x64-2']) {
    const steps = (ci.jobs[id] as Job & { steps: Step[] }).steps;
    expect(steps.find(step => step.name === 'Build userspace native helper')).toEqual(helper);
    for (const name of ['Native Windows protected tools', 'Prepare synthetic native providers', 'Native Windows provider and shared scopes']) {
      expect(steps.some(step => step.name === name)).toBe(false);
    }
    expect(steps.find(step => step.run === 'bun run --cwd packages/core test')?.if).toBeUndefined();
  }
});

test('each portable desktop job builds its PORTABLE_ALL platform when platforms lists it', () => {
  const jobs = Object.entries(loadWorkflow('desktop.yml').jobs).filter(([id]) => id.startsWith('portable-'));
  expect(jobs.map(([id, job]) => ({
    id: id.slice('portable-'.length), name: job.name, runner: job['runs-on'], target: job.env?.BOITE_TARGET || undefined,
  }))).toEqual(PORTABLE_ALL.map(({ id, name, runner, target }) => ({ id, name, runner, target })));
  for (const [id, job] of jobs) {
    const platform = id.slice('portable-'.length);
    expect(job.if).toBe(`inputs.enabled && contains(inputs.platforms, '"id":"${platform}"')`);
    expect(job.env).toMatchObject({ PORTABLE_ID: platform, PORTABLE_RUNNER: job['runs-on'] });
  }
});

test('the ruleset comparison names what to add and what no run reports', () => {
  const rules = (contexts: string[]) => [{ type: 'deletion' }, {
    type: 'required_status_checks', parameters: { required_status_checks: contexts.map((context) => ({ context })) },
  }];
  expect(compareRuleset(['A', 'B'], rules(['A', 'B']))).toEqual({ missing: [], unknown: [] });
  // One ruleset's own rules, as `rulesets/<id>` answers.
  expect(compareRuleset(['A', 'B'], { rules: rules(['A', 'B']) })).toEqual({ missing: [], unknown: [] });
  // The removed gate, reported by no workflow, would block every pull request.
  expect(compareRuleset(['A', 'B'], rules(['A', 'CI required', 'Core tests (${{ matrix.name }})']))).toEqual({
    missing: ['B'], unknown: ['CI required', 'Core tests (${{ matrix.name }})'],
  });
});
