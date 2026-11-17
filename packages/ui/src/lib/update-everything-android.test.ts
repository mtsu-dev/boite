import { expect, test, vi } from 'vitest';

/*
 * The Android app's Update button: one click opens the APK in the browser. A
 * release the app "downloaded" and then waited on as ready made the card ask
 * for a restart that Android never needs.
 */
const opened = vi.hoisted(() => [] as string[]);
const APK = 'https://github.com/mtsu-dev/boite/releases/download/v2.0.0-nightly.20261116.1/boite-mobile_2.0.0-nightly.20261116.1_android.apk';

vi.mock('./app-update.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('./app-update.svelte')>();
  const { androidBackend } = await import('./app-update-android');
  const releases = [{
    tag_name: 'v2.0.0-nightly.20261116.1', draft: false, published_at: '2026-11-16T03:00:00Z', body: null,
    assets: [{ name: 'boite-mobile_2.0.0-nightly.20261116.1_android.apk', browser_download_url: APK, size: 8_000_000 }]
  }];
  const backend = androidBackend(
    { info: async () => ({ version: '2.0.0-nightly.20261101.1', code: 2 }) },
    async () => new Response(JSON.stringify(releases), { status: 200 }),
    async (url) => { opened.push(url); }
  );
  return { ...real, appUpdater: new real.AppUpdater(backend, undefined, () => true), androidApp: () => true, showAppUpdateUi: () => true };
});

const { appUpdater } = await import('./app-update.svelte');
const { updateEverything } = await import('./update-everything.svelte');

test("one click on the Android app's Update opens its APK, and coming back offers it again, never a restart", async () => {
  const stop = appUpdater.start();
  try {
    await appUpdater.settled();
    appUpdater.checkNow();
    await appUpdater.settled();
    expect(appUpdater.snapshot).toMatchObject({ phase: 'available', version: '2.0.0-nightly.20261116.1' });

    await updateEverything.run();
    await vi.waitFor(() => expect(opened).toEqual([APK]));
    await appUpdater.settled();
    expect(appUpdater.snapshot.phase).toBe('installing');

    // Back in the app without the new build: offered as before, not "ready" to restart.
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(appUpdater.snapshot.phase).toBe('available'));
    await updateEverything.run();
    await vi.waitFor(() => expect(opened).toEqual([APK, APK]));
  } finally {
    stop();
  }
});
