/*
 * Reading a plugin's manifest out of a git repository, and nothing else. The
 * core makes an empty bare repository under its data directory, fetches the one
 * commit the ref names with `--depth 1`, reads `boite-plugin.json` out of that
 * commit as a blob and deletes the directory. No working tree is checked out,
 * no hook of the plugin's runs, and every git goes through `core.procs`, so the
 * trace shows it under `plugin:fetch:<n>` like any other process.
 *
 * Only https reaches git. The other transports are where a URL turns into a
 * command (`ext::`), a local file read (`file://`) or a login prompt (ssh), so
 * git is told `protocol.allow=never` with https the one exception, and the
 * credential helpers are emptied: a private or missing repository fails at
 * once instead of opening a sign-in window on the user's screen. The user's
 * gitconfig is not read either: an `insteadOf` rewrite or an `ext` allow
 * there would otherwise apply under those flags.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { PLUGIN_MANIFEST_FILE, PLUGIN_UI_LIMITS, PLUGIN_UI_PATH_PATTERN, readPluginSource } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { MANIFEST_MAX_BYTES, httpsProblem } from './manifest.ts';

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
/** An empty config file. Git reads it as no global and no system config. */
const EMPTY_GIT_CONFIG = process.platform === 'win32' ? 'NUL' : '/dev/null';
const FETCH_TIMEOUT_MS = 60_000;
const STALE_FETCH_MS = 15 * 60_000;
const OUTPUT_MAX_BYTES = 1024 * 1024;

let sequence = 0;

/**
 * The repository URL the core will fetch: https, a host, no credentials, no
 * query or fragment, trailing slashes cut. `allowLocal` is the tests' door to
 * a fixture repository on disk and is never set by a client.
 */
export function normalizeSourceUrl(input: unknown, allowLocal = false): string {
  const expected = 'an https URL of a git repository, such as https://github.com/owner/repo';
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 2048) {
    throw invalidParams(`plugin url must be ${expected}`, { field: 'url', expected });
  }
  const text = input.trim();
  if (allowLocal && isAbsolute(text) && existsSync(text)) return resolve(text);
  const problem = httpsProblem(text);
  if (problem !== null) throw invalidParams(`plugin url must be ${expected}, found ${problem}`, { field: 'url', expected, url: text });
  const url = new URL(text);
  if (url.search !== '' || url.hash !== '') {
    throw invalidParams(`plugin url must be ${expected}, with no query or fragment`, { field: 'url', expected, url: text });
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * What the owner pasted, read as people share a repository (`readPluginSource`):
 * a page, `owner/repo` or a clone URL, with the ref a page names unless `ref`
 * names one. HEAD when neither does.
 */
export function readSource(url: unknown, ref: unknown, allowLocal = false): { url: string; ref: string; pagePath: boolean } {
  if (allowLocal && typeof url === 'string' && isAbsolute(url.trim()) && existsSync(url.trim())) return { url: resolve(url.trim()), ref: checkRef(ref), pagePath: false };
  const read = readPluginSource(url, ref);
  if (!read.ok) throw invalidParams(read.message, { field: read.field, expected: read.expected, ...(typeof url === 'string' ? { url: url.slice(0, 200) } : {}) });
  return { url: read.url, ref: read.ref ?? 'HEAD', pagePath: read.page !== undefined };
}

/** A branch, a tag or a commit: no leading dash, no `..`, nothing git would read as an option. */
export function checkRef(input: unknown): string {
  const expected = 'a branch, tag or commit: letters, digits, ., _, / and -, not starting with - or holding ..';
  if (input === undefined || input === '') return 'HEAD';
  if (typeof input !== 'string' || !REF_PATTERN.test(input) || input.includes('..') || input.endsWith('/') || input.endsWith('.lock')) {
    throw invalidParams(`plugin ref must be ${expected}`, { field: 'ref', expected, ref: String(input) });
  }
  return input;
}

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    // Past the cap the rest is read and dropped, so git never blocks on a full pipe.
    if (size <= OUTPUT_MAX_BYTES) chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && !line.startsWith('hint:')) ?? '';
}

/**
 * The branch or tag a page's `<ref>/<path>` names, `main` for
 * `blob/main/README.md`: the longest leading segments the repository lists,
 * so `feature/x` stays whole. A leading commit hash stands alone. Null when
 * nothing matches; the caller then fetches the text as given.
 */
export function refOfPath(path: string, listed: string): string | null {
  const names = new Set(listed.split('\n').map((line) => line.split('\t')[1]?.trim().replace(/^refs\/(?:heads|tags)\//, '')).filter((name) => name));
  const parts = path.split('/');
  for (let count = parts.length; count > 0; count -= 1) {
    const candidate = parts.slice(0, count).join('/');
    if (names.has(candidate)) return candidate;
  }
  return /^[0-9a-f]{7,64}$/.test(parts[0]!) ? parts[0]! : null;
}

/** A file `provides.ui` names, as read at the fetched commit: its text, or null with its size (-1 when the commit has no such file). */
export interface FetchedFile {
  text: string | null;
  bytes: number;
}

/**
 * The paths a manifest's `provides.ui` names, read loosely: the manifest
 * reader judges the rest, this only picks which blobs to read beside it.
 */
export function uiPathsOf(text: string): { path: string; max: number }[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const ui = (raw as { provides?: { ui?: Record<string, unknown> } } | null)?.provides?.ui;
  if (typeof ui !== 'object' || ui === null) return [];
  const out: { path: string; max: number }[] = [];
  for (const key of ['script', 'style'] as const) {
    const path = ui[key];
    if (typeof path === 'string' && PLUGIN_UI_PATH_PATTERN.test(path) && !path.includes('//')) out.push({ path, max: PLUGIN_UI_LIMITS[key] });
  }
  return out;
}

/**
 * Fetches `ref` of `url` and returns the ref fetched, the commit it resolved
 * to and the text of the manifest at that commit, null when the commit has no
 * such file. The files its `provides.ui` names come with it, read at the same
 * commit, so the interface installed is the one the preview showed. With `pagePath`, `ref` came from a file or folder page and may
 * be `<ref>/<path>`: the repository's branches and tags decide where it ends.
 * Without it, the ref is fetched exactly as given.
 */
export async function fetchManifest(
  core: Core,
  url: string,
  ref: string,
  options: { allowLocal?: boolean; signal?: AbortSignal; pagePath?: boolean } = {},
): Promise<{ ref: string; commit: string; text: string | null; files: Record<string, FetchedFile> }> {
  const allowLocal = options.allowLocal === true;
  const root = resolve(core.dataDir, 'plugins');
  mkdirSync(root, { recursive: true });
  await sweepStale(core, root);
  const dir = join(root, `.fetch-${newId('')}`);
  const threadId = `plugin:fetch:${++sequence}`;
  const config = [
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    '-c', 'protocol.ext.allow=never',
    '-c', allowLocal ? 'protocol.file.allow=always' : 'protocol.file.allow=never',
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    '-c', 'core.fsmonitor=',
  ];
  const git = async (args: string[]): Promise<GitRun> => {
    if (options.signal?.aborted) throw refused('Boite is shutting down.');
    let spawned;
    try {
      spawned = core.procs.spawn(threadId, 'git', [...config, ...args], {
        cwd: root,
        env: {
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          // `spawn` overlays this on the process environment and cannot delete
          // a key. A count of 0 drops `GIT_CONFIG_KEY_*` pairs. An empty
          // `GIT_CONFIG_PARAMETERS` is the other channel: an inherited
          // `insteadOf` there still rewrites the URL under the flags above.
          GIT_CONFIG_COUNT: '0',
          GIT_CONFIG_PARAMETERS: '',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
          GIT_CONFIG_SYSTEM: EMPTY_GIT_CONFIG,
        },
      });
    } catch (error) {
      throw refused(`git did not start (${messageOf(error)}): adding a plugin from a URL needs git on PATH`, { args });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let late = false;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        late = true;
        reject(refused(`git ${args.find((arg) => !arg.startsWith('-') && arg !== dir) ?? ''} did not finish within ${FETCH_TIMEOUT_MS / 1000} seconds`, { url }));
      }, FETCH_TIMEOUT_MS);
    });
    try {
      const [stdout, stderr, code] = await Promise.race([
        Promise.all([drain(spawned.proc.stdout), drain(spawned.proc.stderr), spawned.exited]),
        expired,
      ]);
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
      // Only a git that outlived its deadline is killed; the next one runs under the same id.
      if (late) core.procs.killTree(threadId);
      await spawned.exited;
    }
  };

  // The core closing stops a fetch where it is instead of waiting out its timeout.
  const stop = () => core.procs.killTree(threadId);
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    const init = await git(['init', '--bare', '--quiet', dir]);
    if (init.code !== 0) throw refused(`git init failed in ${root}: ${firstLine(init.stderr) || `exit ${init.code}`}`, { dir });
    if (options.pagePath === true && ref.includes('/')) {
      const listed = await git(['ls-remote', '--heads', '--tags', '--refs', url]);
      if (listed.code === 0) ref = refOfPath(ref, listed.stdout) ?? ref;
    }
    const fetched = await git(['--git-dir', dir, 'fetch', '--depth', '1', '--no-tags', '--quiet', url, ref]);
    if (fetched.code !== 0) {
      throw refused(`git could not fetch ${ref} from ${url}: ${firstLine(fetched.stderr) || `exit ${fetched.code}`}`, { url, ref });
    }
    const parsed = await git(['--git-dir', dir, 'rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}']);
    const commit = parsed.stdout.trim();
    if (parsed.code !== 0 || !/^[0-9a-f]{40,64}$/.test(commit)) throw refused(`${ref} of ${url} does not name a commit`, { url, ref });
    const blob = `${commit}:${PLUGIN_MANIFEST_FILE}`;
    const sized = await git(['--git-dir', dir, 'cat-file', '-s', blob]);
    if (sized.code !== 0) return { ref, commit, text: null, files: {} };
    const size = Number(sized.stdout.trim());
    if (!Number.isFinite(size) || size > MANIFEST_MAX_BYTES) {
      throw refused(`${PLUGIN_MANIFEST_FILE} at ${commit.slice(0, 7)} is ${size} bytes, past the ${MANIFEST_MAX_BYTES} a manifest may take`, { url, commit });
    }
    const read = await git(['--git-dir', dir, 'cat-file', 'blob', blob]);
    if (read.code !== 0) throw refused(`git could not read ${PLUGIN_MANIFEST_FILE} at ${commit.slice(0, 7)}: ${firstLine(read.stderr) || `exit ${read.code}`}`, { url, commit });
    const files: Record<string, FetchedFile> = {};
    for (const { path, max } of uiPathsOf(read.stdout)) {
      const at = `${commit}:${path}`;
      const fileSize = await git(['--git-dir', dir, 'cat-file', '-s', at]);
      const bytes = fileSize.code === 0 ? Number(fileSize.stdout.trim()) : -1;
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > max) { files[path] = { text: null, bytes: Number.isFinite(bytes) ? bytes : -1 }; continue; }
      const blob = await git(['--git-dir', dir, 'cat-file', 'blob', at]);
      if (blob.code !== 0) throw refused(`git could not read ${path} at ${commit.slice(0, 7)}: ${firstLine(blob.stderr) || `exit ${blob.code}`}`, { url, commit });
      files[path] = { text: blob.stdout, bytes };
    }
    return { ref, commit, text: read.stdout, files };
  } finally {
    options.signal?.removeEventListener('abort', stop);
    // A helper git left behind (git-remote-https) goes with the job before the directory does.
    core.procs.killTree(threadId);
    await removeWithRetry(core, dir);
  }
}

/** Windows holds a pack file a moment after git exits. A directory that stays is logged and swept later. */
async function removeWithRetry(core: Core, dir: string): Promise<void> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  core.log('warn', `plugin fetch directory ${dir} was not removed (${messageOf(last)}); the next inspection sweeps it`);
}

/**
 * The fetch directories a failed removal or a core killed mid-fetch left
 * behind. Past this age no git of theirs can still run: a fetch is five gits
 * of `FETCH_TIMEOUT_MS` at most.
 */
async function sweepStale(core: Core, root: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.startsWith('.fetch-')) continue;
    const dir = join(root, name);
    try {
      if (now - (await stat(dir)).mtimeMs < STALE_FETCH_MS) continue;
    } catch {
      continue;
    }
    await removeWithRetry(core, dir);
  }
}
