import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHIM = fileURLToPath(new URL('../shims/boite', import.meta.url));

/** Git for Windows' bash, found from the git on PATH: never the WSL `bash.exe` of System32. */
function gitBash(): string | null {
  if (process.platform !== 'win32') return null;
  const exec = Bun.spawnSync(['git', '--exec-path'], { stdout: 'pipe', stderr: 'ignore' });
  if (exec.exitCode !== 0) return null;
  const bash = resolve(exec.stdout.toString().trim(), '..', '..', '..', 'bin', 'bash.exe');
  return existsSync(bash) ? bash : null;
}

const bash = gitBash();
const install = mkdtempSync(join(tmpdir(), 'boite-shim-'));
afterAll(() => rmSync(install, { recursive: true, force: true }));

/**
 * An installed Boite in miniature: the shim, the runtime beside it as
 * `boite-core.exe`, and a bundle that prints the arguments it received.
 */
function installed(): string {
  const runtime = join(install, 'boite-core.exe');
  if (!existsSync(runtime)) {
    try { linkSync(process.execPath, runtime); } catch { copyFileSync(process.execPath, runtime); }
    mkdirSync(join(install, 'core'), { recursive: true });
    writeFileSync(join(install, 'core', 'main.js'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    copyFileSync(SHIM, join(install, 'boite'));
  }
  return install;
}

/** What the core receives when Git Bash runs `boite <args>`, with the environment given. */
function received(args: string[], env: Record<string, string> = {}): string[] {
  const quoted = args.map(arg => `'${arg}'`).join(' ');
  const environment: Record<string, string | undefined> = { ...process.env, ...env };
  delete environment['BOITE_CORE_EXECUTABLE'];
  if (env['MSYS_NO_PATHCONV'] === undefined) delete environment['MSYS_NO_PATHCONV'];
  delete environment['MSYS2_ARG_CONV_EXCL'];
  // Found on PATH, as a terminal finds it: the shell then names it by its MSYS path.
  environment['BOITE_SHIM_DIR'] = installed();
  const run = Bun.spawnSync([bash!, '-c', `PATH="$(cygpath -u "$BOITE_SHIM_DIR"):$PATH"; boite ${quoted}`], { env: environment, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`the shim failed: ${run.stderr.toString()}`);
  return JSON.parse(run.stdout.toString()) as string[];
}

describe.skipIf(bash === null)('the boite shim in Git Bash', () => {
  const remote = ['projects', 'add', '/home/boite/projects/pushers', '--machine', 'boite-m1', '--name', 'pushers'];

  test('runs the core bundle with MSYS_NO_PATHCONV set, the remote folder as typed', () => {
    expect(received(remote, { MSYS_NO_PATHCONV: '1' })).toEqual(['cli', ...remote]);
  });

  test('a folder after --machine is that machine\'s: Git Bash does not rewrite it to a Windows path', () => {
    expect(received(remote)).toEqual(['cli', ...remote]);
  });

  test('a local folder still reaches the core as a Windows path', () => {
    const [, , , folder] = received(['projects', 'add', '/tmp']);
    expect(folder).toMatch(/^[A-Za-z]:[\\/]/);
  });
});
