import { projectTagKey, type Project } from '@boite/contracts';
import type { Machine } from './workspace.svelte';
import { lastActivity } from './thread-order';

export interface ProjectEntry { machine: Machine; project: Project }
/** Imported conversations can be older than the project that received them. */
export function projectActivity(entry: ProjectEntry): number {
  const threads = entry.machine.store.threadsOf(entry.project.id);
  return threads.reduce((latest, thread) => Math.max(latest, lastActivity(thread)), 0);
}
export function projectKey(entry: ProjectEntry): string {
  const core = entry.machine.store.core;
  // A local core gets a new port on restart. Its data directory keeps the same projects.
  const machine = core?.hostname ? [core.hostname, core.dataDir, core.channel] : entry.machine.id;
  return JSON.stringify([machine, entry.project.id]);
}
const STORAGE = 'boite.project-view.v1';
/** The prefix of a tag among the project filter's choices; a project's key is a JSON array, so the two never meet. */
export const TAG_PICK = 'tag:';

export class ProjectView {
  order = $state<'recent' | 'manual'>('recent');
  filter = $state<string | null>(null);
  keys = $state<string[]>([]);
  /** The Projects view gathers projects under a section per tag. */
  byTag = $state(false);
  /** The tag the project filter shows, by its key without case; `filter` names one project instead. */
  tag = $state<string | null>(null);
  /** Tag sections folded on this device, by key: a tag is the same on every machine, so a machine view change keeps them. */
  folded = $state<string[]>([]);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
      if (saved.order === 'manual') this.order = 'manual';
      if (typeof saved.filter === 'string') this.filter = saved.filter;
      if (Array.isArray(saved.keys)) this.keys = saved.keys.filter((key: unknown) => typeof key === 'string');
      if (saved.byTag === true) this.byTag = true;
      if (typeof saved.tag === 'string' && saved.tag && this.filter === null) this.tag = saved.tag;
      if (Array.isArray(saved.folded)) this.folded = saved.folded.filter((key: unknown) => typeof key === 'string');
    } catch { /* preferences remain available for this session */ }
  }

  #save(): void {
    try { localStorage.setItem(STORAGE, JSON.stringify({ order: this.order, filter: this.filter, keys: this.keys, byTag: this.byTag, tag: this.tag, folded: this.folded })); }
    catch { /* preferences remain available for this session */ }
  }

  selected(entries: ProjectEntry[]): ProjectEntry | undefined {
    return entries.find(entry => projectKey(entry) === this.filter);
  }

  /** The projects of the chosen tag, or null when no tag is chosen or none of `entries` carries it any more. */
  tagged(entries: ProjectEntry[]): ProjectEntry[] | null {
    const key = this.tag;
    if (key === null) return null;
    const found = entries.filter(entry => (entry.project.tags ?? []).some(tag => projectTagKey(tag) === key));
    return found.length > 0 ? found : null;
  }

  /** `all`, a project's key, or `TAG_PICK` and a tag's key. */
  pick(key: string): void {
    const tag = key.startsWith(TAG_PICK) ? projectTagKey(key.slice(TAG_PICK.length)) : null;
    this.tag = tag || null;
    this.filter = key === 'all' || tag !== null ? null : key;
    this.#save();
  }

  setByTag(on: boolean): void { this.byTag = on; this.#save(); }

  tagOpen(key: string): boolean { return !this.folded.includes(key); }

  toggleTag(key: string): void {
    this.folded = this.folded.includes(key) ? this.folded.filter(folded => folded !== key) : [...this.folded, key];
    this.#save();
  }

  sorted(entries: ProjectEntry[]): ProjectEntry[] {
    const positions = new Map(this.keys.map((key, index) => [key, index]));
    const times = new Map(entries.map(entry => [projectKey(entry), projectActivity(entry)]));
    return [...entries].sort((a, b) => {
      const ak = projectKey(a), bk = projectKey(b);
      if (this.order === 'manual') {
        const position = (positions.get(ak) ?? Infinity) - (positions.get(bk) ?? Infinity);
        if (position) return position;
      }
      return times.get(bk)! - times.get(ak)! || b.project.createdAt - a.project.createdAt || ak.localeCompare(bk);
    });
  }

  toggle(entries: ProjectEntry[]): void {
    if (this.order === 'recent') {
      // Keep a previous arrangement; the first switch starts with the order on screen.
      if (!this.keys.length) this.keys = this.sorted(entries).map(projectKey);
      this.order = 'manual';
    } else this.order = 'recent';
    this.#save();
  }

  move(entries: ProjectEntry[], source: string, target: string, after = false): void {
    if (this.order !== 'manual' || source === target) return;
    const visible = this.sorted(entries).map(projectKey);
    if (!visible.includes(source) || !visible.includes(target)) return;
    // Hidden machines keep their slots while the visible projects move.
    const full = [...this.keys, ...visible.filter(key => !this.keys.includes(key))];
    const next = visible.filter(key => key !== source);
    next.splice(next.indexOf(target) + Number(after), 0, source);
    const visibleSet = new Set(visible);
    let index = 0;
    this.keys = full.map(key => visibleSet.has(key) ? next[index++]! : key);
    this.#save();
  }

  step(entries: ProjectEntry[], key: string, direction: -1 | 1): void {
    const ordered = this.sorted(entries).map(projectKey);
    const target = ordered[ordered.indexOf(key) + direction];
    if (target) this.move(entries, key, target, direction === 1);
  }
}

export const projectView = new ProjectView();
