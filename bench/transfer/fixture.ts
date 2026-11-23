import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The agents whose real streams the transfer report replays. */
export const PROVIDERS = ['claude', 'codex', 'opencode'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const PROVIDER_LABELS: Record<ProviderName, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };

export const FIXTURE_DIR = join(import.meta.dir, 'fixtures');
export const fixturePath = (provider: ProviderName): string => join(FIXTURE_DIR, `${provider}.jsonl`);

/** The file the recorded project holds and the replayed one is given, so tool output reads the same. */
export const NOTES_FILE = 'notes.md';
export const NOTES_TEXT = [
  '# Build cache notes',
  '',
  'The CI job restores its dependency cache from a key made of the runner image and the branch name.',
  'When the lockfile changes the key stays the same, so the restored store no longer matches it and',
  'the install step refuses it. Rebuilding by hand fixes one run, then the next lockfile change breaks it again.',
  '',
  '## Ideas',
  '',
  '- hash the lockfile into the key;',
  '- keep a restore key without the hash, so most packages still come from the cache;',
  '- share one store between branches that have the same lockfile.',
  '',
].join('\n');

export const FIXTURE_PROMPT = [
  `Read ${NOTES_FILE} in the current folder, then append this exact line at its end: "Reviewed: the lockfile hash goes into the cache key."`,
  'Do not touch any other file. Then reply with two short paragraphs that explain the problem the notes describe',
  'and the fix, followed by a bullet list of three follow-up checks. Write in English.',
].join(' ');

/** One fixture file: a header line, then what the driver read during the turn, in order. */
export interface FixtureHeader {
  fixture: 1;
  provider: ProviderName;
  agentVersion: string;
  model: string;
  /** The recorded turn's prompt; the replay sends the same one. */
  prompt: string;
}

export function readFixture(provider: ProviderName, text?: string): { header: FixtureHeader; lines: unknown[] } {
  const raw = text ?? readFileSync(fixturePath(provider), 'utf8');
  const [first, ...rest] = raw.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown);
  const header = first as FixtureHeader;
  if (header?.fixture !== 1 || header.provider !== provider) throw new Error(`${fixturePath(provider)}: first line is not a ${provider} fixture header`);
  return { header, lines: rest };
}
