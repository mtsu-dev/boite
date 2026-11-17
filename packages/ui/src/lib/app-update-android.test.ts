import { afterEach, expect, test, vi } from 'vitest';
import { androidBackend, builtAt, candidateOf, compareVersions, offers, portUpdater, type AndroidUpdater, type AndroidUpdaterPort, type GithubRelease } from './app-update-android';

function release(tag: string, files: string[], extra: Partial<GithubRelease> = {}): GithubRelease {
  return {
    tag_name: tag, draft: false, published_at: '2026-11-16T04:00:00Z', body: `notes ${tag}`,
    assets: files.map((name) => ({ name, browser_download_url: `https://github.com/mtsu-dev/boite/releases/download/${tag}/${name}`, size: 8_000_000 })),
    ...extra
  };
}

const apk = (version: string) => `boite-mobile_${version}_android.apk`;

function bridge(info = { version: '2.0.0-nightly.20261115.1', code: 3_600_000 }): AndroidUpdater {
  return { info: async () => info };
}

const answer = (releases: GithubRelease[]) => vi.fn(async () => new Response(JSON.stringify(releases), { status: 200 }));

afterEach(() => {
  window.localStorage.clear();
});

test('versions order like semver, nightlies by date then counter', () => {
  expect(compareVersions('2.0.0-nightly.20261116.2', '2.0.0-nightly.20261116.1')).toBeGreaterThan(0);
  expect(compareVersions('2.0.0-nightly.20261116.1', '2.0.0-nightly.20261115.9')).toBeGreaterThan(0);
  expect(compareVersions('2.0.0', '2.0.0-beta.1')).toBeGreaterThan(0);
  expect(compareVersions('2.0.0-beta.10', '2.0.0-beta.9')).toBeGreaterThan(0);
  expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
});

test('the candidate is the newest APK of the channel, never a draft or a desktop file', () => {
  const releases = [
    release('v2.0.0-nightly.20261116.1', [apk('2.0.0-nightly.20261116.1'), 'boite_2.0.0_x64-setup.exe']),
    release('v2.0.0-nightly.20261117.1', [apk('2.0.0-nightly.20261117.1')], { draft: true }),
    release('v2.0.0-nightly.20261115.1', [apk('2.0.0-nightly.20261115.1')]),
    release('v2.0.0-beta.2', [apk('2.0.0-beta.2')]),
    release('v2.0.0-beta.3', ['boite-android-1.0.3.apk'])
  ];
  expect(candidateOf(releases, 'nightly')?.version).toBe('2.0.0-nightly.20261116.1');
  expect(candidateOf(releases, 'stable')?.version).toBe('2.0.0-beta.2');
  expect(candidateOf([releases[4]!], 'stable')).toBeNull();
});

test('a channel offers a higher version; a switch only a build published after this one', () => {
  const code = 3_600_000;
  const at = new Date(builtAt(code));
  const nightly = { version: '2.0.0-nightly.20261116.1', url: '', size: 1, notes: null, publishedAt: null };
  expect(offers('2.0.0-nightly.20261115.1', code, nightly, 'nightly')).toBe(true);
  expect(offers('2.0.0-nightly.20261116.1', code, nightly, 'nightly')).toBe(false);
  expect(offers('2.0.0-nightly.20261117.1', code, nightly, 'nightly')).toBe(false);
  const stable = (minutes: number) => ({ version: '2.0.0-beta.2', url: '', size: 1, notes: null, publishedAt: new Date(at.getTime() + minutes * 60_000).toISOString() });
  // Android refuses the lower version code of an older build.
  expect(offers('2.0.0-nightly.20261115.1', code, stable(-30), 'stable')).toBe(false);
  expect(offers('2.0.0-nightly.20261115.1', code, stable(30), 'stable')).toBe(true);
  // A build made by hand keeps code 1: every release is newer.
  expect(offers('2.0.0-beta.1', 1, stable(-1_000_000), 'stable')).toBe(true);
});

test('the offer opens its APK in the browser, and is offered again when the owner comes back', async () => {
  const opened: string[] = [];
  const fetcher = answer([release('v2.0.0-nightly.20261116.1', [apk('2.0.0-nightly.20261116.1')])]);
  const backend = androidBackend(bridge(), fetcher, async (url) => { opened.push(url); });
  const seen: string[] = [];
  await backend.listen((snapshot) => seen.push(snapshot.phase));

  const status = await backend.status();
  expect(status).toMatchObject({ phase: 'idle', currentVersion: '2.0.0-nightly.20261115.1', currentChannel: 'nightly', channel: 'nightly', supported: true });
  const checked = await backend.check('nightly');
  expect(checked).toMatchObject({ phase: 'available', version: '2.0.0-nightly.20261116.1', total: 8_000_000, notes: 'notes v2.0.0-nightly.20261116.1' });
  // A second look within minutes reuses the answer; the owner's forces one.
  await backend.check('nightly');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await backend.check('nightly', true);
  expect(fetcher).toHaveBeenCalledTimes(2);

  // Nothing downloads in the app, which may not install packages.
  expect(await backend.download()).toMatchObject({ phase: 'ready', received: 8_000_000 });
  expect(opened).toEqual([]);
  await backend.install();
  expect(opened).toEqual([`https://github.com/mtsu-dev/boite/releases/download/v2.0.0-nightly.20261116.1/${apk('2.0.0-nightly.20261116.1')}`]);
  expect((await backend.status()).phase).toBe('installing');
  // Android stops the app to replace it: back and still running, the update can start over.
  document.dispatchEvent(new Event('visibilitychange'));
  expect((await backend.status()).phase).toBe('available');
  expect(seen).toEqual(['checking', 'available', 'checking', 'available', 'ready', 'installing', 'available']);
});

test('a failed list rejects with its reason, and nothing opens without an offer', async () => {
  const opened: string[] = [];
  const offline = androidBackend(bridge(), vi.fn(async () => new Response('{}', { status: 403 })), async (url) => { opened.push(url); });
  await expect(offline.check('nightly')).rejects.toThrow('the release list answered 403');
  await expect(offline.install()).rejects.toThrow('no APK to open');
  expect(opened).toEqual([]);
});

test('the channel the owner picks is kept for the next start', async () => {
  const fetcher = answer([release('v2.0.0-beta.2', [apk('2.0.0-beta.2')])]);
  await androidBackend(bridge(), fetcher).check('stable');
  expect((await androidBackend(bridge(), fetcher).status()).channel).toBe('stable');
});

test('the port pairs each answer with its request and ignores anything else', async () => {
  const sent: { id: number; cmd: string }[] = [];
  const port: AndroidUpdaterPort = { onmessage: null, postMessage: (message) => { sent.push(JSON.parse(message)); } };
  const updater = portUpdater(port);
  const first = updater.info();
  const second = updater.info();
  expect(sent.map(({ cmd }) => cmd)).toEqual(['info', 'info']);
  port.onmessage!({ data: 'not json' });
  port.onmessage!({ data: JSON.stringify({ id: 99, result: 'stray' }) });
  port.onmessage!({ data: JSON.stringify({ id: sent[1]!.id, result: { version: '2.0.1', code: 6 } }) });
  port.onmessage!({ data: JSON.stringify({ id: sent[0]!.id, result: { version: '2.0.0', code: 5 } }) });
  expect(await second).toEqual({ version: '2.0.1', code: 6 });
  expect(await first).toEqual({ version: '2.0.0', code: 5 });

});
