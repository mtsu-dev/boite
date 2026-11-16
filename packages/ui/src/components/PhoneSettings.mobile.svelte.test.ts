import { afterAll, afterEach, expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../test/fake-client';
import PhoneSettings from './PhoneSettings.svelte';
import { strings } from '../lib/strings';

vi.hoisted(() => { vi.stubEnv('MODE', 'mobile'); });

let component: Record<string, unknown> | null = null;

afterEach(() => {
  if (component) unmount(component, { outro: false });
  component = null;
  delete window.__TAURI_INTERNALS__;
  document.body.innerHTML = '';
  localStorage.clear();
});
afterAll(() => { vi.unstubAllEnvs(); });

for (const native of [true, false]) {
  test(`${native ? 'Android' : 'web'} keeps notification kinds and ${native ? 'hides' : 'shows'} web installation and push`, async ({ store }) => {
    if (native) window.__TAURI_INTERNALS__ = {};
    store.endpointUrl = window.location.origin;
    // Keep a current pairing while the card refreshes sessions.
    vi.spyOn(store, 'loadSessions').mockResolvedValue(undefined);
    store.sessions = [{ current: true } as typeof store.sessions[number]];
    const call = vi.spyOn(store.client!, 'call');
    component = mount(PhoneSettings, { target: document.body, props: { store, showServerSettings: false } });
    flushSync();

    expect(document.querySelector('[data-testid=phone-notification-kinds]')).not.toBeNull();
    expect(document.querySelector('[data-testid=setting-notification-kind-finished]')).not.toBeNull();
    const install = [...document.querySelectorAll('button')].find(button => button.textContent?.includes(strings.phone.install));
    const pushCopy = document.body.textContent ?? '';
    const statusCalls = call.mock.calls.filter(([method]) => method === 'push.status');
    if (native) {
      expect(install).toBeUndefined();
      expect(pushCopy).not.toContain(strings.phone.httpsRequired);
      expect(pushCopy).not.toContain(strings.phone.unsupported);
      expect(document.querySelector('[data-testid=phone-push-enable]')).toBeNull();
      expect(statusCalls).toHaveLength(0);
    } else {
      expect(install).toBeDefined();
      expect(pushCopy).toContain(strings.phone.httpsRequired);
      expect(statusCalls).toHaveLength(1);
    }
  });
}
