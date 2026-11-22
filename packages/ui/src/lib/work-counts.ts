import { threadBusy, type ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { agentDirectory } from './agent-directory.svelte';
import { threadState } from './thread-state';
import { workingThread } from './recent.svelte';
import { rowAsks } from './status-order';
import { fill, strings } from './strings';

/** How many bots are at work, for the phone's Bots tab, and whether one of them waits on the user. */
export interface WorkCount {
  count: number;
  waiting: boolean;
}

/**
 * The agents at work: every persistent agent with a turn under way, a
 * question for the user or work left running, and every entrusted thread
 * mid-turn, one thread counted once. The agents snapshot only loads with the
 * Agents experiment on; without it nothing counts here.
 */
export function agentsAtWork(stores: readonly Store[]): WorkCount {
  let count = 0;
  let waiting = false;
  for (const store of stores) {
    const seen = new Set<string>();
    const add = (thread: ThreadSummary, asks: boolean) => {
      if (seen.has(thread.id)) return;
      seen.add(thread.id);
      count++;
      waiting ||= asks;
    };
    const directory = agentDirectory(store);
    // The user's turn as the rows read it: a question or permission the machine holds counts before the summary does.
    const asking = (thread: ThreadSummary) => threadState(thread, rowAsks(store, thread.id)) === 'waiting';
    for (const { thread, waiting: asks } of directory.atWork) add(thread, asks || asking(thread));
    const busy = (thread: ThreadSummary) => asking(thread) || workingThread(store, thread);
    // An agent's own thread at rest can still ask the user (`boite ask`) or keep work in the background.
    for (const thread of store.threads) {
      if (!thread.archived && thread.agentSessionId && busy(thread) && directory.ownerOf(thread)) add(thread, asking(thread));
    }
    for (const { thread } of directory.entrusted) if (busy(thread)) add(thread, asking(thread));
  }
  return { count, waiting };
}

/**
 * The conversations at work on every machine, as the projects' Working counts read them (lib/recent.svelte.ts
 * workingThread): each listed thread of a project still shown, bots' own threads and helpers left to their own marks.
 * The rail's Threads button and the phone's Threads tab carry it.
 */
export function threadsAtWork(stores: readonly Pick<Store, 'projects' | 'threadsOf' | 'subagents' | 'pendingQuestions' | 'pendingPermissions'>[]): number {
  let count = 0;
  for (const store of stores) {
    for (const project of store.projects) {
      if (project.archived) continue;
      for (const thread of store.threadsOf(project.id)) if (workingThread(store, thread)) count++;
    }
  }
  return count;
}

/**
 * The subagents at work on every machine: each delegated thread mid-turn or waiting on its own background work, as its
 * parent's row counts it (contracts workingChildren). Left out: a mochi's helper (its desk or the Threads count show
 * it), anything under an incognito conversation (it stays on its own screen), and an archived project's helpers.
 * The rail's Threads button and the phone's Threads tab show it beside threadsAtWork.
 */
export function subagentsAtWork(stores: readonly Pick<Store, 'projects' | 'threads'>[]): number {
  let count = 0;
  for (const store of stores) {
    const archived = new Set(store.projects.filter(project => project.archived).map(project => project.id));
    const byId = new Map(store.threads.map(thread => [thread.id, thread]));
    // Up the parents to the root conversation: a bot or an incognito one anywhere above keeps the helper off the count.
    const hidden = (thread: ThreadSummary) => {
      const seen = new Set<string>();
      for (let at: ThreadSummary | undefined = thread; at && !seen.has(at.id); at = at.parentThreadId ? byId.get(at.parentThreadId) : undefined) {
        seen.add(at.id);
        if (at.incognito || at.parentIsBot || (at !== thread && at.agentSessionId)) return true;
      }
      return false;
    };
    for (const thread of store.threads) {
      if (!thread.parentThreadId || thread.archived || !threadBusy(thread)) continue;
      if (thread.projectId && archived.has(thread.projectId)) continue;
      if (!hidden(thread)) count++;
    }
  }
  return count;
}

export function workCountLabel(threads: number, helpers: number): string | null {
  const t = strings.app.rail;
  return [
    threads ? threads === 1 ? t.workingOne : fill(t.workingMany, { count: String(threads) }) : null,
    helpers ? helpers === 1 ? t.subagentsOne : fill(t.subagentsMany, { count: String(helpers) }) : null
  ].filter(Boolean).join(', ') || null;
}
