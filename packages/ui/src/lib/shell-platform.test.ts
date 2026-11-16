import { afterEach, expect, test, vi } from 'vitest';
import { desktopShell, linuxShell, mobileApp } from './shell-platform';

const tauri = window as { __TAURI_INTERNALS__?: unknown };
afterEach(() => {
  delete tauri.__TAURI_INTERNALS__;
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('only the Linux desktop shell lacks the child webview and the microphone', () => {
  const webkitgtk = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  expect(linuxShell(webkitgtk)).toBe(false);
  tauri.__TAURI_INTERNALS__ = {};
  expect(linuxShell(webkitgtk)).toBe(true);
  expect(linuxShell('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe(false);
  expect(linuxShell('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/140.0')).toBe(false);
  expect(linuxShell('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36')).toBe(false);
});

test('the Android app runs inside Tauri yet is a remote client, never the desktop shell', async () => {
  tauri.__TAURI_INTERNALS__ = {};
  expect([desktopShell(), mobileApp()]).toEqual([true, false]);
  vi.stubEnv('MODE', 'mobile');
  vi.resetModules();
  const mobile = await import('./shell-platform');
  expect([mobile.desktopShell(), mobile.mobileApp()]).toEqual([false, true]);
  expect(mobile.linuxShell('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15')).toBe(false);
  delete tauri.__TAURI_INTERNALS__;
  expect(mobile.mobileApp()).toBe(false);
});
