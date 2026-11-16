/*
 * The Android app's updater, for the APK installed outside a store. This side
 * reads GitHub's release list and picks the build to offer; the app's
 * `AppUpdates.kt` (`window.BoiteUpdater`) downloads it, checks it is this app
 * signed by the same key and newer, and hands it to Android's installer.
 * docs/internals/android-native.md#updates.
 */
import type { AppUpdateBackend, UpdateChannel, UpdateSnapshot } from './app-update.svelte';
import { MOBILE_BUILD, tauriApp } from './shell-platform';
import { strings } from './strings';

/** What `AppUpdates.kt` exposes to the page. */
export interface AndroidUpdater {
  /** JSON `{ version, code }` of the installed app. */
  info(): string;
  download(url: string, version: string): void;
  install(version: string): 'started' | 'permission' | 'missing' | string;
}

/** What `AppUpdates.kt` reports through `window.__boiteAppUpdate`. */
export type AndroidUpdateEvent =
  | { kind: 'progress'; received: number; total: number | null }
  | { kind: 'downloaded'; version: string }
  | { kind: 'failed'; message: string }
  | { kind: 'installAborted' }
  | { kind: 'installFailed'; message: string };

declare global {
  interface Window {
    BoiteUpdater?: AndroidUpdater;
    __boiteAppUpdate?: (event: AndroidUpdateEvent) => void;
  }
}

export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  body?: string | null;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export interface Candidate {
  version: string;
  url: string;
  size: number;
  notes: string | null;
  publishedAt: string | null;
}

/** The APK a release publishes for this app (`.github/workflows/mobile.yml`). */
const APK = /^boite-mobile_(.+)_android\.apk$/;
const RELEASES = import.meta.env.VITE_APP_UPDATE_FEED || 'https://api.github.com/repos/mtsu-dev/boite/releases?per_page=100';
/** Pages of 100 releases read before saying none carries an APK. */
const PAGES = 3;
/** An answer this recent is reused unless the owner asks. */
const REUSE_MS = 5 * 60 * 1_000;
const CHANNEL_KEY = 'boite.app-update-channel';
/**
 * Release builds number their version code in minutes since this instant
 * (`mobile.yml`), so a code is also the build's time. A build made by hand
 * keeps the code 1 of `tauri.conf.json`: every release is newer.
 */
const CODE_EPOCH = Date.UTC(2020, 0, 1);

/** The bridge, only in the Android app built for itself. */
export function androidUpdater(): AndroidUpdater | null {
  return MOBILE_BUILD && tauriApp() && typeof window !== 'undefined' ? window.BoiteUpdater ?? null : null;
}

export function trackOf(version: string): UpdateChannel {
  return version.includes('-nightly.') ? 'nightly' : 'stable';
}

type Parsed = { core: number[]; pre: string[] };

function parse(version: string): Parsed | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split('.') ?? [] };
}

/** Semantic version order; an unparsable version sorts below every other. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let i = 0; i < 3; i += 1) if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The newest published release of `channel` that carries the app's APK. */
export function candidateOf(releases: readonly GithubRelease[], channel: UpdateChannel): Candidate | null {
  let best: Candidate | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    for (const asset of release.assets) {
      const version = APK.exec(asset.name)?.[1];
      if (!version || trackOf(version) !== channel || !parse(version)) continue;
      if (best && compareVersions(version, best.version) <= 0) continue;
      best = { version, url: asset.browser_download_url, size: asset.size, notes: release.body ?? null, publishedAt: release.published_at };
    }
  }
  return best;
}

/** When this build was made, from its version code; 0 for a build made by hand. */
export function builtAt(code: number): number {
  return code > 1 ? CODE_EPOCH + code * 60_000 : 0;
}

/**
 * Within its channel only a higher version is offered. Switching channel
 * offers the other one's newest build, but only one published after this
 * build: Android refuses a lower version code, and codes follow build time.
 */
export function offers(current: string, code: number, candidate: Candidate, channel: UpdateChannel): boolean {
  if (candidate.version === current) return false;
  if (trackOf(current) === channel) return compareVersions(candidate.version, current) > 0;
  const published = candidate.publishedAt ? Date.parse(candidate.publishedAt) : NaN;
  return Number.isFinite(published) && published > builtAt(code);
}

function readChannel(fallback: UpdateChannel): UpdateChannel {
  try {
    const stored = window.localStorage.getItem(CHANNEL_KEY);
    return stored === 'nightly' || stored === 'stable' ? stored : fallback;
  } catch {
    return fallback;
  }
}

function saveChannel(channel: UpdateChannel): void {
  try { window.localStorage.setItem(CHANNEL_KEY, channel); } catch { /* the choice lasts this run */ }
}

async function releasePages(fetcher: typeof fetch, channel: UpdateChannel): Promise<GithubRelease[]> {
  const all: GithubRelease[] = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const url = new URL(RELEASES, window.location.href);
    if (page > 1) url.searchParams.set('page', String(page));
    const response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`${url.host}: the release list answered ${response.status}`);
    const releases = await response.json() as GithubRelease[];
    if (!Array.isArray(releases)) throw new Error(`${url.host}: expected a list of releases`);
    all.push(...releases);
    // Newest first: a page with this channel's APK holds its newest build.
    if (releases.length < 100 || candidateOf(releases, channel)) break;
  }
  return all;
}

export function androidBackend(bridge: AndroidUpdater, fetcher: typeof fetch = (...args) => fetch(...args)): AppUpdateBackend {
  const installed = JSON.parse(bridge.info()) as { version: string; code: number };
  const currentChannel = trackOf(installed.version);
  let snapshot: UpdateSnapshot = {
    phase: 'idle', currentVersion: installed.version, currentChannel, channel: readChannel(currentChannel),
    version: null, notes: null, publishedAt: null, received: 0, total: null, error: null, supported: true
  };
  let candidate: Candidate | null = null;
  let checkedAt = 0;
  let waiter: { resolve: (value: UpdateSnapshot) => void; reject: (error: Error) => void } | null = null;
  const handlers = new Set<(snapshot: UpdateSnapshot) => void>();
  const publish = (next: UpdateSnapshot): UpdateSnapshot => {
    snapshot = next;
    for (const handler of handlers) handler(next);
    return next;
  };

  window.__boiteAppUpdate = (event) => {
    switch (event.kind) {
      case 'progress':
        publish({ ...snapshot, phase: 'downloading', received: event.received, total: event.total });
        return;
      case 'downloaded':
        if (event.version !== snapshot.version) return;
        waiter?.resolve(publish({ ...snapshot, phase: 'ready', received: snapshot.total ?? snapshot.received, error: null }));
        waiter = null;
        return;
      case 'failed':
        waiter?.reject(new Error(event.message));
        waiter = null;
        return;
      case 'installAborted':
        publish({ ...snapshot, phase: 'ready', error: null });
        return;
      case 'installFailed':
        publish({ ...snapshot, phase: 'error', error: event.message });
    }
  };

  return {
    status: async () => snapshot,
    check: async (channel, force = false) => {
      if (channel !== snapshot.channel) saveChannel(channel);
      if (!force && channel === snapshot.channel && snapshot.phase !== 'error' && Date.now() - checkedAt < REUSE_MS) return snapshot;
      publish({ ...snapshot, phase: 'checking', channel, error: null });
      const found = candidateOf(await releasePages(fetcher, channel), channel);
      checkedAt = Date.now();
      candidate = found && offers(installed.version, installed.code, found, channel) ? found : null;
      return publish({
        ...snapshot, phase: candidate ? 'available' : 'current', channel,
        version: candidate?.version ?? null, notes: candidate?.notes ?? null, publishedAt: candidate?.publishedAt ?? null,
        received: 0, total: candidate?.size || null, error: null
      });
    },
    download: () => {
      if (!candidate) return Promise.resolve(snapshot);
      const { url, version } = candidate;
      publish({ ...snapshot, phase: 'downloading', received: 0, error: null });
      return new Promise<UpdateSnapshot>((resolve, reject) => {
        waiter = { resolve, reject };
        bridge.download(url, version);
      });
    },
    install: async () => {
      const answer = snapshot.version ? bridge.install(snapshot.version) : 'missing';
      if (answer === 'permission') {
        publish({ ...snapshot, phase: 'ready', error: null });
        throw new Error(strings.appUpdate.androidPermission);
      }
      if (answer !== 'started') throw new Error(strings.appUpdate.failed);
      publish({ ...snapshot, phase: 'installing', error: null });
    },
    listen: async (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }
  };
}
