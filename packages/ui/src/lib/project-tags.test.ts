import { expect, test } from 'vitest';
import type { Project } from '@boite/contracts';
import type { Store } from './store.svelte';
import type { ProjectEntry } from './project-view.svelte';
import { groupedKey, tagGroups, UNTAGGED } from './project-tags';

function entry(machine: string, id: string, tags?: string[]): ProjectEntry {
  const project: Project = { id, name: id, path: `/${id}`, createdAt: 0, ...(tags ? { tags } : {}) };
  return { machine: { id: machine, label: machine, store: { core: null } as unknown as Store }, project };
}

test('tag sections sort by name, merge spellings across machines, list a project under each tag and put untagged last', () => {
  const entries = [entry('pc', 'a', ['work', 'Zeta']), entry('laptop', 'b', ['Work']), entry('laptop', 'c', []), entry('old', 'd'), entry('pc', 'e', ['alpha'])];
  const groups = tagGroups(entries);
  expect(groups.map(group => [group.key, group.label, group.entries.map(e => e.project.id)])).toEqual([
    ['alpha', 'alpha', ['e']],
    ['work', 'work', ['a', 'b']],
    ['zeta', 'Zeta', ['a']],
    [UNTAGGED, '', ['c', 'd']],
  ]);
  const keys = groups.flatMap(group => group.entries.map(e => groupedKey(group, e)));
  expect(new Set(keys).size).toBe(keys.length);
  expect(tagGroups([entry('pc', 'a', ['x'])]).map(group => group.key)).toEqual(['x']);
});
