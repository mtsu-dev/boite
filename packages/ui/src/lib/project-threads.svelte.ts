import type { Project, ThreadSummary } from '@boite/contracts';
import { projectKey, type ProjectEntry } from './project-view.svelte';
import type { Store } from './store.svelte';
import { groupWorkingThread, recentPreferences, workingThread } from './recent.svelte';
import { threadOrder } from './thread-order';
import { rowAsks } from './status-order';
import { threadState } from './thread-state';
import { hasUnsentDraft } from './composer-queue';

type ProjectThreadKind = 'working' | 'done' | 'archived';
/** The two kinds of row in the fold under the project list: projects with no open conversation, and projects put out of the list. */
export type ProjectShelfKind = 'idle' | 'archived';
/**
 * Where the Projects view lists a project: at work at the top, open, paused (threads, none running, none for the
 * user) or idle (no thread at all). Archived projects are not a section: they leave the list for their own fold.
 */
export type ProjectSection = 'working' | 'open' | 'paused' | 'idle';
/** Every fold of the Projects view: each section with a header, and the archived projects. */
export type ProjectFold = Exclude<ProjectSection, 'open'> | 'archived';
/**
 * Each fold's state at launch, on desktop and phone alike: what holds work starts open, what holds no thread starts
 * closed. A header toggles its fold for the session; the next launch starts from here again.
 */
export const PROJECT_FOLDS_OPEN: Readonly<Record<ProjectFold, boolean>> = { working: true, paused: true, idle: false, archived: false };
/** Archived conversations split in two: done ones (marked done, PR merged) leave after a delay, the others wait to be picked up again. */
export type ArchiveKind = 'done' | 'archived';

/** How many archived threads of a project are done and how many were put aside by hand. */
export function archiveCount(project: Project, kind: ArchiveKind): number {
  const done = project.doneThreads ?? 0;
  return kind === 'done' ? done : Math.max(0, (project.archivedThreads ?? 0) - done);
}

/** Whether an archived thread belongs to the done list or the archived one. */
export function archiveKindOf(thread: ThreadSummary): ArchiveKind {
  return thread.doneAt != null ? 'done' : 'archived';
}

/** Expansion follows a project across desktop and phone, without mixing machines. */
class ProjectThreadView {
  working = $state<string[]>([]);
  done = $state<string[]>([]);
  archived = $state<string[]>([]);
  /** The Projects view's folds, from PROJECT_FOLDS_OPEN, as left across desktop and phone for this session. */
  folds = $state<Record<ProjectFold, boolean>>({ ...PROJECT_FOLDS_OPEN });

  foldOpen(fold: ProjectFold): boolean {
    return this.folds[fold];
  }

  toggleFold(fold: ProjectFold): void {
    this.folds[fold] = !this.folds[fold];
  }

  /** Back to the launch state, for tests. */
  resetFolds(): void {
    this.folds = { ...PROJECT_FOLDS_OPEN };
  }

  isOpen(entry: ProjectEntry, kind: ProjectThreadKind): boolean {
    if (kind === 'working' && !recentPreferences.groupWorking) return false;
    return this[kind].includes(projectKey(entry));
  }

  toggle(entry: ProjectEntry, kind: ProjectThreadKind, collapsed = false): void {
    const key = projectKey(entry);
    const open = this[kind].includes(key);
    if (collapsed) entry.machine.store.toggleProject(entry.project.id);
    if (collapsed && open) return;
    this[kind] = open ? this[kind].filter(value => value !== key) : [...this[kind], key];
  }

  /** Unfolding a project whose only rows are folded working ones opens them too, so the fold never comes up empty. */
  toggleProject(entry: ProjectEntry, lists: ThreadLists, drafts: number): void {
    const store = entry.machine.store;
    const unfolding = store.isCollapsed(entry.project.id);
    store.toggleProject(entry.project.id);
    if (unfolding && lists.attention.length === 0 && drafts === 0 && lists.working.length > 0 && recentPreferences.groupWorking && !this.isOpen(entry, 'working')) {
      this.working = [...this.working, projectKey(entry)];
    }
  }
}

export const projectThreadView = new ProjectThreadView();

/** A conversation or draft keeps its project visible, including folded working rows. The open draft counts before it has text, though it lists no row yet. */
export function activeProject(entry: ProjectEntry): boolean {
  const store = entry.machine.store;
  return store.threadsOf(entry.project.id).length > 0
    || store.draft?.projectId === entry.project.id
    || store.draftEntries.some(draft => draft.projectId === entry.project.id);
}

/** Nothing runs in it and nothing there is for the user: no news, question or failure, no pin, no unsent text. */
function restingThread(store: Store, thread: ThreadSummary): boolean {
  if (thread.pinned || hasUnsentDraft(store.composerStates[thread.id])) return false;
  return threadState(thread, rowAsks(store, thread.id)) === null;
}

/**
 * Working: every conversation it holds is at work and nothing there holds the user's input (a pin, unsent text in a
 * conversation or in a new draft), so a folded section never hides what waits on the user.
 * Paused: conversations, every one at rest (restingThread) and no new draft, so folding it hides nothing either.
 * Open: any other conversation or draft. Idle: no conversation at all; archived and done ones live in its row's history.
 */
function projectSection(entry: ProjectEntry): ProjectSection {
  const store = entry.machine.store;
  const threads = store.threadsOf(entry.project.id);
  const drafting = store.draftEntries.some(draft => draft.projectId === entry.project.id);
  if (threads.length > 0 && !drafting && threads.every(thread => groupWorkingThread(store, thread))) return 'working';
  if (threads.length > 0 && !drafting && store.draft?.projectId !== entry.project.id && threads.every(thread => restingThread(store, thread))) return 'paused';
  return activeProject(entry) ? 'open' : 'idle';
}

/**
 * The listed projects split by section, each in the order it came in. Without working grouping, projects at work stay
 * open cards; without inactive grouping, paused and idle projects do too.
 */
export function projectSections(entries: readonly ProjectEntry[], groupInactive: boolean, groupWorking: boolean): Record<ProjectSection, ProjectEntry[]> {
  const sections: Record<ProjectSection, ProjectEntry[]> = { working: [], open: [], paused: [], idle: [] };
  for (const entry of entries) {
    const section = projectSection(entry);
    const grouped = section === 'open' || (section === 'working' ? groupWorking : groupInactive);
    sections[grouped ? section : 'open'].push(entry);
  }
  return sections;
}

/** Protected working rows stay visible while folded and appear only once when unfolded. */
function projectThreadLists(entry: ProjectEntry, threads: ThreadSummary[], workingOpen: boolean): {
  working: ThreadSummary[]; attention: ThreadSummary[];
} {
  const store = entry.machine.store;
  const sorted = threads.slice().sort(threadOrder(thread => rowAsks(store, thread.id)));
  return {
    working: sorted.filter(thread => workingThread(entry.machine.store, thread)),
    attention: recentPreferences.groupWorking
      ? sorted.filter(thread => workingOpen ? !workingThread(entry.machine.store, thread) : !groupWorkingThread(entry.machine.store, thread))
      : sorted
  };
}

type ThreadLists = ReturnType<typeof projectThreadLists>;

/** One project's drawn lists, sorted once for its rows and for Alt+digit; it reads only its own project's threads. */
export class ProjectLists {
  readonly entry: ProjectEntry;
  readonly lists: ThreadLists = $derived.by(() => projectThreadLists(this.entry, this.entry.machine.store.threadsOf(this.entry.project.id), projectThreadView.isOpen(this.entry, 'working')));
  constructor(entry: ProjectEntry) { this.entry = entry; }
}

/**
 * Maps each listed project to its lists. A project whose entry is the same object
 * keeps its lists, so a change in one project's threads sorts that project alone.
 */
export function projectListMap(): (entries: readonly ProjectEntry[]) => Map<string, ProjectLists> {
  let previous = new Map<string, ProjectLists>();
  return entries => {
    const next = new Map<string, ProjectLists>();
    for (const entry of entries) {
      const key = projectKey(entry);
      const known = previous.get(key);
      next.set(key, known?.entry === entry ? known : new ProjectLists(entry));
    }
    previous = next;
    return next;
  };
}
