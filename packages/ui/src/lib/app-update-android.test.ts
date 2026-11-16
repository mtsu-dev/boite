import { afterEach, expect, test, vi } from 'vitest';
import { androidBackend, builtAt, candidateOf, compareVersions, offers, portUpdater, type AndroidUpdater, type AndroidUpdaterPort, type GithubRelease } from './app-update-android';
import { strings } from './strings';

function release(tag: string, files: string[], extra: Partial<GithubRelease> = {}): GithubRelease {
  return {
    tag_name: tag, draft: false, published_at: '2026-11-16T04:00:00Z', body: `notes ${tag}`,
    assets: files.map((name) => ({ name, browser_download_url: `https://github.com/mtsu-dev/boite/releases/download/${tag}/${name}`, size: 8_000_000 })),
    ...extra
  };
}

const apk = (version: string) => `boite-mobile_${version}_android.apk`;

function bridge(info = { version: '2.0.0-nightly.20261115.1', code: 3_600_000 }) {
  const calls: string[] = [];
  let answer = 'started';
  const fake: AndroidUpdater & { calls: string[]; answer(value: string): void } = {
    calls,
    answer: (value) => { answer = value; },
    info: async () => info,
    download: async (url, version) => { calls.push(`download ${version} ${url}`); },
    install: async (version) => { calls.push(`install ${version}`); return answer; }
  };
  return fake;
}

const answer = (releases: GithubRelease[]) => vi.fn(async () => new Response(JSON.stringify(releases), { status: 200 }));

afterEach(() => {
  delete window.__boiteAppUpdate;
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

test('check, download and install drive the bridge and report each phase', async () => {
  const fake = bridge();
  const fetcher = answer([release('v2.0.0-nightly.20261116.1', [apk('2.0.0-nightly.20261116.1')])]);
  const backend = androidBackend(fake, fetcher);
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

  const downloading = backend.download();
  expect(fake.calls).toEqual([`download 2.0.0-nightly.20261116.1 https://github.com/mtsu-dev/boite/releases/download/v2.0.0-nightly.20261116.1/${apk('2.0.0-nightly.20261116.1')}`]);
  window.__boiteAppUpdate!({ kind: 'progress', received: 4_000_000, total: 8_000_000 });
  window.__boiteAppUpdate!({ kind: 'downloaded', version: '2.0.0-nightly.20261116.1' });
  expect(await downloading).toMatchObject({ phase: 'ready', received: 8_000_000 });

  await backend.install();
  expect(fake.calls.at(-1)).toBe('install 2.0.0-nightly.20261116.1');
  expect((await backend.status()).phase).toBe('installing');
  // The owner dismissed Android's dialog: the build stays ready.
  window.__boiteAppUpdate!({ kind: 'installAborted' });
  expect((await backend.status()).phase).toBe('ready');
  expect(seen).toEqual(['checking', 'available', 'checking', 'available', 'downloading', 'downloading', 'ready', 'installing', 'ready']);
});

test('an app not yet allowed to install says so and keeps its download', async () => {
  const fake = bridge();
  const backend = androidBackend(fake, answer([release('v2.0.0-nightly.20261116.1', [apk('2.0.0-nightly.20261116.1')])]));
  await backend.check('nightly');
  const downloading = backend.download();
  window.__boiteAppUpdate!({ kind: 'downloaded', version: '2.0.0-nightly.20261116.1' });
  await downloading;
  fake.answer('permission');
  await expect(backend.install()).rejects.toThrow(strings.appUpdate.androidPermission);
  expect((await backend.status()).phase).toBe('ready');
});

test('a failed download or list rejects with its reason', async () => {
  const backend = androidBackend(bridge(), answer([release('v2.0.0-nightly.20261116.1', [apk('2.0.0-nightly.20261116.1')])]));
  await backend.check('nightly');
  const downloading = backend.download();
  window.__boiteAppUpdate!({ kind: 'failed', message: 'The download is signed by another key than this app' });
  await expect(downloading).rejects.toThrow('signed by another key');
  expect(await backend.status()).toMatchObject({ phase: 'error', error: 'The download is signed by another key than this app' });
  // The next try asks the list again instead of reading back a download that ended.
  expect(await backend.check('nightly')).toMatchObject({ phase: 'available', received: 0 });

  const offline = androidBackend(bridge(), vi.fn(async () => new Response('{}', { status: 403 })));
  await expect(offline.check('nightly')).rejects.toThrow('the release list answered 403');
});

test('the channel the owner picks is kept for the next start', async () => {
  const fetcher = answer([release('v2.0.0-beta.2', [apk('2.0.0-beta.2')])]);
  await androidBackend(bridge(), fetcher).check('stable');
  expect((await androidBackend(bridge(), fetcher).status()).channel).toBe('stable');
});

test('the port pairs each answer with its request and ignores anything else', async () => {
  const sent: { id: number; cmd: string; version?: string }[] = [];
  const port: AndroidUpdaterPort = { onmessage: null, postMessage: (message) => { sent.push(JSON.parse(message)); } };
  const updater = portUpdater(port);
  const info = updater.info();
  const install = updater.install('2.0.0-nightly.20261116.2');
  expect(sent.map(({ cmd }) => cmd)).toEqual(['info', 'install']);
  expect(sent[1]).toMatchObject({ version: '2.0.0-nightly.20261116.2' });
  port.onmessage!({ data: 'not json' });
  port.onmessage!({ data: JSON.stringify({ id: 99, result: 'stray' }) });
  port.onmessage!({ data: JSON.stringify({ id: sent[1]!.id, result: 'permission' }) });
  port.onmessage!({ data: JSON.stringify({ id: sent[0]!.id, result: { version: '2.0.0', code: 5 } }) });
  expect(await install).toBe('permission');
  expect(await info).toEqual({ version: '2.0.0', code: 5 });
});
