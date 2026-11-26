import { expect, test } from 'bun:test';
import shared from '../src-tauri/tauri.bundle.conf.json';
import linux from '../src-tauri/tauri.bundle.linux.conf.json';
import windows from '../src-tauri/tauri.bundle.windows.conf.json';
import { sidecarWorkers } from './sidecar-workers.ts';

test.each([
  ['darwin', {}, ['artifact-retention-worker.js']],
  ['linux', linux.bundle, ['artifact-retention-worker.js', 'linux-tcp-worker.js']],
  ['win32', windows.bundle, ['artifact-retention-worker.js', 'guard-worker.js', 'jobs-worker.js']],
] as const)('%s stages and bundles only its sidecar workers', (platform, overlay, workers) => {
  const overrides = 'resources' in overlay ? overlay.resources : {};
  const resources = { ...shared.bundle.resources, ...overrides };
  expect([...sidecarWorkers(platform)].sort()).toEqual([...workers]);
  expect(Object.entries(resources).filter(([source]) => source.endsWith('-worker.js')).sort()).toEqual(
    workers.map(worker => [`binaries/${worker}`, worker]),
  );
});
