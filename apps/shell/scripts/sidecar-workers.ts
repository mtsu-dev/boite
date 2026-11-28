const common = ['artifact-retention-worker.js'];
const linux = ['linux-tcp-worker.js'];
const windows = ['jobs-worker.js', 'guard-worker.js'];

export const allSidecarWorkers = [...common, ...linux, ...windows];

export function sidecarWorkers(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'linux') return [...common, ...linux];
  if (platform === 'win32') return [...common, ...windows];
  return common;
}
