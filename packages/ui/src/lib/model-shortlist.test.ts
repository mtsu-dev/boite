import { expect, test } from 'vitest';
import type { ModelInfo } from '@boite/contracts';
import { shortlist } from './model-shortlist';

const model = (id: string): ModelInfo => ({ id, name: id.toUpperCase() } as ModelInfo);
const catalog: Record<string, string[]> = { 'claude:a': ['opus', 'sonnet', 'haiku'], 'claude:b': ['opus'], 'codex:c': ['sol', 'mini'] };
const find = (providerId: string, accountId: string, id: string) => catalog[`${providerId}:${accountId}`]?.includes(id) ? model(id) : null;
const thread = (providerId: string, accountId: string, id: string | null, at: number, extra = {}) => ({ providerId, accountId, model: id, updatedAt: at, ...extra });

test('stars come first, then the latest threads, the current choice leading them, each model once', () => {
  const rows = shortlist(
    [{ providerId: 'claude', accountId: 'a', model: model('opus') }],
    [thread('codex', 'c', 'sol', 3), thread('claude', 'a', 'haiku', 5), thread('claude', 'b', 'opus', 9), thread('codex', 'c', 'mini', 1)],
    { providerId: 'claude', accountId: 'a', model: 'sonnet' },
    find
  );
  // Opus on the other login is the starred model already; three recent rows at most.
  expect(rows.map((row) => [row.model.id, row.favorite])).toEqual([['opus', true], ['sonnet', false], ['haiku', false], ['sol', false]]);
});

test('a subagent, an archived thread or a model its account no longer lists stays off the first level', () => {
  const rows = shortlist([], [
    thread('codex', 'c', 'sol', 1, { parentThreadId: 't1' }),
    thread('codex', 'c', 'mini', 2, { archivedAt: 3 }),
    thread('claude', 'b', 'sonnet', 4),
    thread('claude', 'a', null, 5),
    thread('claude', 'a', 'haiku', 0, { lastUserMessageAt: 6 })
  ], null, find);
  expect(rows.map((row) => row.model.id)).toEqual(['haiku']);
});
