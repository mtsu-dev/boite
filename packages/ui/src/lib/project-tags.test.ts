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

test('a full tag list saves with a held tag still typed, and refuses a new one', async () => {
  const { tagEditor } = await import('./tag-editor.svelte');
  const { PROJECT_TAGS_MAX } = await import('@boite/contracts');
  const full = Array.from({ length: PROJECT_TAGS_MAX }, (_, index) => `t${index}`);
  const saved = tagEditor.edit({ project: 'p', tags: full, known: [] });
  tagEditor.typed = 'T0';
  tagEditor.save();
  expect(await saved).toEqual(full);

  const refused = tagEditor.edit({ project: 'p', tags: full, known: [] });
  tagEditor.typed = 'new';
  tagEditor.save();
  expect(tagEditor.current).not.toBeNull();
  tagEditor.cancel();
  expect(await refused).toBeNull();
});
