import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ShellChannel = 'stable' | 'nightly' | 'dev';

const inputs = [
  'package.json', 'bun.lock', 'packages/contracts/src', 'packages/ui/src', 'packages/ui/public',
  'packages/ui/index.html', 'packages/ui/package.json', 'packages/ui/vite.config.ts', 'packages/ui/release-version.ts',
  'apps/shell/scripts', 'apps/shell/src-tauri/src', 'apps/shell/src-tauri/capabilities',
  'apps/shell/src-tauri/build.rs', 'apps/shell/src-tauri/Cargo.toml', 'apps/shell/src-tauri/Cargo.lock',
];

function sourceDigest(root: string): string {
  const hash = createHash('sha256');
  // Different worktrees using the same Cargo target can have identical inputs.
  hash.update(realpathSync(root)).update('\0');
  function add(relative: string): void {
    const file = join(root, relative);
    if (!existsSync(file)) return;
    if (statSync(file).isDirectory()) {
      for (const name of readdirSync(file).sort()) add(`${relative}/${name}`);
      return;
    }
    if (relative.endsWith('.test.ts')) return;
    const bytes = readFileSync(file);
    hash.update(`${relative}\0${bytes.length}\0`).update(bytes);
  }
  for (const input of inputs) add(input);
  const tauri = 'apps/shell/src-tauri';
  if (existsSync(join(root, tauri))) {
    for (const file of readdirSync(join(root, tauri)).sort()) {
      if (/^tauri(?:\..+)?\.conf\.json$/.test(file)) add(`${tauri}/${file}`);
    }
  }
  return hash.digest('hex');
}

function marker(digest: string, target: string, channel: ShellChannel): string {
  return `boite-shell-build:${target}:${channel}:${digest}:end`;
}

export function shellBuildMarker(root: string, target: string, channel: ShellChannel): string {
  return marker(sourceDigest(root), target, channel);
}

export function shellProvenanceProblem(executable: string, root: string, target: string, channels: ShellChannel[]): string | null {
  const bytes = readFileSync(executable);
  const digest = sourceDigest(root);
  if (channels.some(channel => bytes.includes(marker(digest, target, channel)))) return null;
  return `Shell build provenance does not match this checkout, target or channel: ${executable}. Rebuild with bun run --cwd apps/shell tauri build --no-bundle.`;
}
