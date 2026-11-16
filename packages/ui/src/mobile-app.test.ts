import { afterAll, expect, test, vi } from 'vitest';
import { mount, unmount } from 'svelte';

// The Android build: Tauri is there, the desktop shell and its core are not.
// Both are read once at module load, so they are set before the app is imported.
vi.stubEnv('MODE', 'mobile');
window.__TAURI_INTERNALS__ = {};
const { default: App } = await import('./App.svelte');
const { store } = await import('./lib/store.svelte');
const { closeTour } = await import('./lib/onboarding.svelte');
const { strings } = await import('./lib/strings');

afterAll(() => {
  delete window.__TAURI_INTERNALS__;
  vi.unstubAllEnvs();
});

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting, body was:\n${document.body.textContent ?? ''}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test('the Android app opens on the phone app\'s way in, never on its own page as a core', async () => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  closeTour();
  const target = document.body.appendChild(document.createElement('div'));
  const app = mount(App, { target });
  try {
    await waitFor(() => store.booted && document.querySelector('[data-testid=mobile-connect]') !== null);
    // Its page origin is the app's own assets: no core is tried there, so it asks to pair.
    expect(store.endpointUrl).toBeFalsy();
    expect(store.pairingRequired).toBe(true);
    expect(document.querySelector('[data-testid=machine-paste-open]')).not.toBeNull();
    expect(document.body.textContent).not.toContain(strings.app.noEndpointTitle);
  } finally {
    unmount(app, { outro: false });
    target.remove();
  }
});
