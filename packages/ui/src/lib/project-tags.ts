import { Tag } from '@lucide/svelte';
import { projectTagKey, type Project } from '@boite/contracts';
import { count } from './format';
import { separator, type MenuItem } from './menu';
import { projectKey, TAG_PICK, type ProjectEntry } from './project-view.svelte';

/** The key of the section holding projects without a tag: no tag is empty, so it never names one. */
export const UNTAGGED = '';

/** One tag across the given projects: its key without case, the spelling shown, and the projects carrying it. */
export interface TagGroup {
  key: string;
  label: string;
  entries: ProjectEntry[];
}

/** A tag's spelling: the first met wins, so two machines writing `Work` and `work` share one section. */
function spellings(projects: Iterable<Project>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const project of projects) for (const tag of project.tags ?? []) {
    const key = projectTagKey(tag);
    if (!labels.has(key)) labels.set(key, tag);
  }
  return labels;
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) || a.localeCompare(b);
}

/** Every tag the given projects carry, once each without case, sorted by name. */
export function knownTags(projects: Iterable<Project>): string[] {
  return [...spellings(projects).values()].sort(byName);
}

/**
 * A section per tag, sorted by name, then the projects without one under
 * `UNTAGGED`, last and only when there are some. `entries` keeps its order
 * inside each section, and a project with several tags sits in each of them.
 */
export function tagGroups(entries: ProjectEntry[]): TagGroup[] {
  const labels = spellings(entries.map(entry => entry.project));
  const groups = new Map<string, ProjectEntry[]>([...labels.keys()].map(key => [key, []]));
  const untagged: ProjectEntry[] = [];
  for (const entry of entries) {
    const keys = new Set((entry.project.tags ?? []).map(projectTagKey));
    if (keys.size === 0) untagged.push(entry);
    for (const key of keys) groups.get(key)!.push(entry);
  }
  const sorted = [...groups].map(([key, list]) => ({ key, label: labels.get(key)!, entries: list })).sort((a, b) => byName(a.label, b.label));
  return untagged.length > 0 ? [...sorted, { key: UNTAGGED, label: '', entries: untagged }] : sorted;
}

/** A key for a project drawn inside a tag's section: unique when a project carries several tags. */
export function groupedKey(group: TagGroup, entry: ProjectEntry): string {
  return JSON.stringify([group.key, projectKey(entry)]);
}

/** The project filter's tag choices, under the projects, with how many projects each holds; none when no project has a tag. */
export function tagFilterItems(entries: ProjectEntry[], chosen: string | null): MenuItem[] {
  const tags = tagGroups(entries).filter(group => group.key !== UNTAGGED);
  if (tags.length === 0) return [];
  return [separator('tags-sep'), ...tags.map(group => ({
    id: `${TAG_PICK}${group.key}`, label: group.label, glyph: Tag, hint: count(group.entries.length), active: group.key === chosen,
  }))];
}

/** How the chosen tag is spelt among `entries`, for the filter's button. */
export function tagLabel(entries: ProjectEntry[], key: string): string {
  return knownTags(entries.map(entry => entry.project)).find(tag => projectTagKey(tag) === key) ?? key;
}
