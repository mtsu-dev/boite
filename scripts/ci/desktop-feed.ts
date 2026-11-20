type Channel = 'stable' | 'nightly';
type PublishedRelease = { tag_name: string; draft: boolean; assets: { name: string }[] };

/** A complete stable beta is a stable-channel candidate, just like a final release. */
export function desktopFeedTag(channel: Channel, release: PublishedRelease, current?: string): string | null {
  const tag = release.tag_name;
  const version = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag);
  if (!version || version[1]?.split('.').some(identifier => /^0\d+$/.test(identifier))) {
    throw new Error(`${tag}: expected a version tag`);
  }
  const actual = tag.includes('-nightly.') ? 'nightly' : 'stable';
  if (channel !== actual) throw new Error(`${tag}: expected a ${channel} release`);
  if (release.draft || !release.assets.some(asset => asset.name === 'latest.json')) {
    throw new Error(`${tag}: expected a published release with latest.json`);
  }
  return current && Bun.semver.order(tag.slice(1), current.slice(1)) <= 0 ? null : tag;
}

function github<T>(route: string, method = 'GET', body?: unknown): T | null {
  const result = Bun.spawnSync(['gh', 'api', '--method', method, route, ...(body === undefined ? [] : ['--input', '-'])], {
    stdin: body === undefined ? 'ignore' : Buffer.from(JSON.stringify(body)), stdout: 'pipe', stderr: 'pipe',
  });
  if (result.exitCode === 0) return JSON.parse(result.stdout.toString()) as T;
  const error = result.stderr.toString().trim();
  if (method === 'GET' && error.endsWith('(HTTP 404)')) return null;
  throw new Error(`${method} ${route}: ${error}`);
}

function publishFeed(api: string, channel: Channel, release: PublishedRelease): void {
  const branch = `desktop-feed-${channel}`;
  const head = () => github<{ object: { sha: string } }>(`${api}/git/ref/heads/${branch}`)?.object.sha;
  for (let attempt = 0; ; attempt++) {
    const previous = head();
    const file = previous && github<{ content: string }>(`${api}/contents/latest.json?ref=${previous}`);
    const current = file ? (JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) as { tag: string }).tag : undefined;
    const tag = desktopFeedTag(channel, release, current);
    if (!tag) {
      console.log(`The desktop ${channel} feed already serves ${current}`);
      return;
    }
    const tree = github<{ sha: string }>(`${api}/git/trees`, 'POST', {
      tree: [{ path: 'latest.json', mode: '100644', type: 'blob', content: `${JSON.stringify({ tag })}\n` }],
    })!;
    const commit = github<{ sha: string }>(`${api}/git/commits`, 'POST', {
      message: `Publish desktop ${channel} feed for ${tag}`, tree: tree.sha, parents: previous ? [previous] : [],
    })!;
    try {
      if (previous) github(`${api}/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
      else github(`${api}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
    } catch (error) {
      if (attempt === 2 || head() === previous) throw error;
      continue;
    }
    console.log(`Published the desktop ${channel} feed at ${tag}`);
    return;
  }
}

if (import.meta.main) {
  const [channel, releaseTag] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  if ((channel !== 'stable' && channel !== 'nightly') || !releaseTag || !repo) throw new Error('Expected a channel, release tag and GITHUB_REPOSITORY');
  const api = `repos/${repo}`;
  const release = github<PublishedRelease>(`${api}/releases/tags/${encodeURIComponent(releaseTag)}`);
  if (!release || release.tag_name !== releaseTag) throw new Error(`Published release ${releaseTag} was not found`);
  publishFeed(api, channel, release);
}
