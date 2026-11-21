/**
 * Pi 1.5.1 made idle cache refreshes the default. Keep the streaming behavior
 * in Boite unless the account explicitly opts into idle requests.
 */
export function writeCacheWarmingExtension(write: (name: string, code: string) => string): string {
  return write('pi-cache-warming.mjs', SOURCE);
}

// Pi's extension loader maps this package name in the bundled CLI and in
// legacy installations.
const SOURCE = `import { SettingsManager, getAgentDir } from '@mariozechner/pi-coding-agent';

export default function boiteCacheWarming(pi) {
  pi.on('cache_warming_decision', (_event, ctx) => {
    if (!ctx.isIdle()) return;
    try {
      const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: false });
      if (settings.getGlobalSettings().cacheWarming === 'idle') return;
    } catch {
      // Idle refreshes require a readable, explicit profile setting.
    }
    return { action: 'stop' };
  });
}
`;
