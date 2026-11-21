/** The Tauri CLI with what each platform's packaging needs: the host's maintained ELF tools on Linux, the core bundle overlay on Windows. */
import { resolve } from 'node:path';
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { shellBuildMarker, shellProvenanceProblem, type ShellChannel } from './shell-artifact.ts';
import { shellTarget } from './targets.ts';

const env = { ...process.env };
const args = process.argv.slice(2);
const packaging = args[0] === 'bundle' || (args[0] === 'build' && !args.includes('--no-bundle'));
if (process.platform === 'linux' && packaging) {
  const patchelf = env.PATCHELF || Bun.which('patchelf');
  if (!patchelf) throw new Error('Linux packaging requires patchelf on PATH');
  env.PATCHELF = patchelf;
  if (process.arch === 'arm64') {
    const wrapper = resolve(import.meta.dir, 'patchelf-sidecar.sh');
    chmodSync(wrapper, 0o755);
    env.BOITE_PATCHELF = patchelf;
    env.PATCHELF = wrapper;
  }
}
// A cross build (Intel macOS from Apple Silicon) names its triple once, in BOITE_TARGET, for the core and the shell alike.
if (process.env.BOITE_TARGET && ['build', 'bundle'].includes(args[0] ?? '') && !args.some(arg => arg === '--target' || arg.startsWith('--target='))) {
  args.push('--target', process.env.BOITE_TARGET);
}
if (process.env.BOITE_SIGN_UPDATES === '1') {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('TAURI_SIGNING_PRIVATE_KEY is required for signed update artifacts');
  // An absent password makes minisign read the terminal, even for an unencrypted key.
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
  args.push('--config', 'src-tauri/tauri.updater.conf.json');
}
// The Windows sidecar is the runtime plus a `core` directory (stage-sidecar.ts): a build that bundles names it too.
const bundleConfig = args.findIndex((arg) => arg.endsWith('tauri.bundle.conf.json'));
if (process.platform === 'win32' && bundleConfig !== -1) {
  args.splice(bundleConfig + 1, 0, '--config', 'src-tauri/tauri.bundle.windows.conf.json');
}
// A Linux core looks for its launcher beside itself, so it ships as a second sidecar in the same directory (stage-sidecar.ts).
if (process.platform === 'linux' && bundleConfig !== -1) {
  args.splice(bundleConfig + 1, 0, '--config', 'src-tauri/tauri.bundle.linux.conf.json');
}
const shell = resolve(import.meta.dir, '..');
const root = resolve(shell, '../..');
const capture = args[0] === 'build' && !args.includes('--debug');
const targetArgument = args.indexOf('--target');
const requested = targetArgument === -1 ? args.find(arg => arg.startsWith('--target='))?.slice(9) : args[targetArgument + 1];
const target = capture ? shellTarget(requested) : undefined;
const channel: ShellChannel = args.some(arg => arg.endsWith('tauri.dev.conf.json')) ? 'dev'
  : args.some(arg => arg.endsWith('tauri.nightly.conf.json')) ? 'nightly' : 'stable';
if (target) env.BOITE_SHELL_BUILD_MARKER = shellBuildMarker(root, target.triple, channel);

const child = Bun.spawn(['bun', 'run', '--cwd', shell, 'tauri:cli', ...args], {
  env, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit', windowsHide: true,
});
const code = await child.exited;
if (code !== 0) process.exit(code);

if (target) {
  const tauri = resolve(shell, 'src-tauri');
  const metadata = Bun.spawnSync(['cargo', 'metadata', '--no-deps', '--format-version', '1', '--manifest-path', resolve(tauri, 'Cargo.toml')], {
    env, stdout: 'pipe', stderr: 'pipe', windowsHide: true,
  });
  if (metadata.exitCode !== 0) throw new Error(`cargo metadata failed: ${metadata.stderr.toString()}`);
  const targetDirectory = (JSON.parse(metadata.stdout.toString()) as { target_directory: string }).target_directory;
  const name = `boite-${channel === 'dev' ? 'dev-' : ''}shell${target.suffix}`;
  const segments = requested ? [target.triple] : [];
  const built = resolve(targetDirectory, ...segments, 'release', name);
  const directory = resolve(tauri, 'target', ...segments, 'release');
  const snapshot = resolve(directory, name);
  mkdirSync(directory, { recursive: true });
  const temporary = snapshot === built ? built : `${snapshot}.${process.pid}.tmp`;
  try {
    if (temporary !== built) copyFileSync(built, temporary);
    const problem = shellProvenanceProblem(temporary, root, target.triple, [channel]);
    if (problem) throw new Error(problem);
    if (temporary !== built) renameSync(temporary, snapshot);
  } finally {
    if (temporary !== built) rmSync(temporary, { force: true });
  }
}
