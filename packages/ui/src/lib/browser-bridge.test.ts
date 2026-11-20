import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  window.history.replaceState(null, '', '/');
});

/** The bridge the module picks on load, at this address and in this mode. */
async function bridgeAt(search: string, dev: boolean) {
  window.history.replaceState(null, '', `/${search}`);
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  return import('./browser-bridge');
}

test('a production build ignores ?fake=1 and parks no fake page', async () => {
  const { browserBridge, FakeBridge } = await bridgeAt('?fake=1', false);
  expect(browserBridge).not.toBeInstanceOf(FakeBridge);
});

test('the dev server still draws the fake page on ?fake=1', async () => {
  const { browserBridge, FakeBridge } = await bridgeAt('?fake=1', true);
  expect(browserBridge).toBeInstanceOf(FakeBridge);
});
