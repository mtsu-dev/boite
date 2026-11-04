/*
 * Where a plugin comes from, read the way people share it. Someone sends a
 * repository's page, a tag's page, `owner/repo` or a clone URL; the core
 * fetches one https repository at one ref. This turns the first into the
 * second, for `plugins.inspect` and for the card an agent puts in a
 * conversation (`boite plugin add`), on the core and in the in-memory client.
 * Nothing here reaches the network: what is refused is refused before git
 * runs, and the preview shows the URL and ref git used.
 */

/** The contracts build without DOM typings; every runtime that loads them has a WHATWG URL. */
interface ParsedUrl { protocol: string; username: string; password: string; hostname: string; host: string; origin: string; pathname: string }
declare const URL: new (value: string) => ParsedUrl;

export const PLUGIN_SOURCE_URL_MAX = 2048;
export const PLUGIN_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
export const PLUGIN_URL_EXPECTED = 'an https URL of a git repository, such as https://github.com/owner/repo, or owner/repo for GitHub';
export const PLUGIN_REF_EXPECTED = 'a branch, tag or commit: letters, digits, ., _, / and -, not starting with - or holding ..';

/** The repository and the ref to fetch: `ref` is null when neither the URL nor the caller named one. */
export interface PluginSourceInput {
  url: string;
  ref: string | null;
}

export type PluginSourceCheck =
  | ({ ok: true } & PluginSourceInput)
  | { ok: false; field: 'url' | 'ref'; expected: string; message: string };

/** A branch, tag or commit git cannot read as an option or a range. */
export function pluginRefProblem(ref: string): boolean {
  return !PLUGIN_REF_PATTERN.test(ref) || ref.includes('..') || ref.endsWith('/') || ref.endsWith('.lock');
}

/** `owner/repo`: GitHub's own short form. */
const SHORT_FORM = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** `git@host:owner/repo.git`, the ssh clone URL a repository page offers beside the https one. */
const SCP_FORM = /^git@([A-Za-z0-9.-]+):([A-Za-z0-9._/-]+)$/;
/** `host.tld/owner/repo`: a page address copied without its scheme. */
const BARE_HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?\//;

/**
 * The pages of a repository that name a ref, as GitHub, GitLab, Forgejo and
 * Gitea draw them: the repository is what comes before the marker, the ref
 * what follows it. A file page (`blob/main/boite-plugin.json`) loses the
 * manifest's name.
 */
const REF_PAGES: readonly RegExp[] = [
  /^(\/[^/]+\/[^/]+)\/(?:tree|blob|commit|releases\/tag)\/(.+)$/,
  /^(\/.+?)\/-\/(?:tree|blob|commit|tags)\/(.+)$/,
  /^(\/[^/]+\/[^/]+)\/src\/(?:branch|tag|commit)\/(.+)$/,
];
/** GitHub's other pages of a repository (issues, releases, pulls): the repository is the first two segments. */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

function refused(field: 'url' | 'ref', message: string): PluginSourceCheck {
  return { ok: false, field, expected: field === 'url' ? PLUGIN_URL_EXPECTED : PLUGIN_REF_EXPECTED, message };
}

/**
 * The repository and ref `url` and `ref` name. A ref given apart wins over one
 * the URL carries. The URL must end https: an http, ssh-only or credentialed
 * address is refused, never rewritten, except `git@host:path`, which names the
 * same repository over https. A query and a fragment are dropped: git does not
 * read them, and a token there would land in the install record.
 */
export function readPluginSource(url: unknown, ref?: unknown): PluginSourceCheck {
  if (typeof url !== 'string' || url.trim().length === 0 || url.length > PLUGIN_SOURCE_URL_MAX) return refused('url', `plugin url must be ${PLUGIN_URL_EXPECTED}`);
  if (ref !== undefined && ref !== null && typeof ref !== 'string') return refused('ref', `plugin ref must be ${PLUGIN_REF_EXPECTED}`);
  let text = url.trim();
  const scp = SCP_FORM.exec(text);
  if (scp) text = `https://${scp[1]}/${scp[2]}`;
  else if (SHORT_FORM.test(text)) text = `https://github.com/${text}`;
  else if (BARE_HOST.test(text)) text = `https://${text}`;
  let parsed: ParsedUrl;
  try {
    parsed = new URL(text);
  } catch {
    return refused('url', `plugin url must be ${PLUGIN_URL_EXPECTED}, found not a URL`);
  }
  if (parsed.protocol !== 'https:') return refused('url', `plugin url must be ${PLUGIN_URL_EXPECTED}, found a ${parsed.protocol.replace(':', '')} URL`);
  if (parsed.hostname.length === 0) return refused('url', `plugin url must be ${PLUGIN_URL_EXPECTED}, found a URL with no host`);
  if (parsed.username !== '' || parsed.password !== '') return refused('url', `plugin url must be ${PLUGIN_URL_EXPECTED}, found a URL carrying credentials`);
  let path = parsed.pathname.replace(/\/+$/, '');
  let named: string | null = null;
  for (const page of REF_PAGES) {
    const found = page.exec(path);
    if (!found) continue;
    path = found[1]!;
    try { named = decodeURIComponent(found[2]!); } catch { return refused('ref', `plugin ref must be ${PLUGIN_REF_EXPECTED}, found a malformed escape`); }
    named = named.replace(/\/boite-plugin\.json$/, '');
    break;
  }
  if (named === null && GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
    const [, owner, repo] = path.split('/');
    if (owner && repo) path = `/${owner}/${repo}`;
  }
  if (path === '') return refused('url', `plugin url must be ${PLUGIN_URL_EXPECTED}, found no repository path`);
  const given = typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : null;
  const chosen = given ?? named;
  if (chosen !== null && pluginRefProblem(chosen)) return refused('ref', `plugin ref must be ${PLUGIN_REF_EXPECTED}, found ${JSON.stringify(chosen.slice(0, 80))}`);
  return { ok: true, url: `${parsed.origin}${path}`, ref: chosen };
}

/**
 * Two URLs of one repository: the host in any case, with or without `.git`
 * and a trailing slash. An install from `…/repo.git` and an update read from
 * `…/repo` are the same plugin.
 */
export function sameRepository(a: string, b: string): boolean {
  return repositoryKey(a) === repositoryKey(b);
}

function repositoryKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '').replace(/\.git$/, '')}`;
  } catch {
    return url;
  }
}
