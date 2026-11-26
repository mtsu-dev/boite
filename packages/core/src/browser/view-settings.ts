import { RENDER_SCALE } from './chromium.ts';
import type { Tab } from './types.ts';

/** The caller runs a viewport change in a screen turn so a capture cannot undo it. */
export async function setViewport(tab: Tab, size: Tab['viewport']): Promise<void> {
  if (size) await tab.page.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: RENDER_SCALE, mobile: false });
  else await tab.page.send('Emulation.clearDeviceMetricsOverride');
  tab.viewport = size;
}

export async function setAppearance(tab: Tab, colorScheme: Tab['colorScheme']): Promise<void> {
  await tab.page.send('Emulation.setEmulatedMedia', { features: colorScheme === 'system' ? [] : [{ name: 'prefers-color-scheme', value: colorScheme }] });
  tab.colorScheme = colorScheme;
}
