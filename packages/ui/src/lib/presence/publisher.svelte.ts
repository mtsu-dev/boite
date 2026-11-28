/*
 * Keeps the rich presence of this computer true while the experiment is on:
 * the words come from every machine's work (`activity.ts`), and the core this
 * desktop app started shows them in the chat apps listening here
 * (`presence.set`, docs/internals/presence.md). Off, or the app gone, the
 * presence is cleared.
 */
import { markFeature, type PresenceActivity, type PresenceStatus } from '@boite/contracts';
import { experimentOn } from '../experiments.svelte';
import { desktopShell } from '../shell-platform';
import type { Store } from '../store.svelte';
import { workspace } from '../workspace.svelte';
import { presenceActivity, type PresenceWork } from './activity';

markFeature('boite-feature:discord-presence');

/** This device's choice to name the projects: off by default, since a profile is seen by everyone on the friend list. */
export const SHOW_PROJECTS_KEY = 'boite.presence.projects';

function readShowProjects(): boolean {
  try { return window.localStorage.getItem(SHOW_PROJECTS_KEY) === '1'; } catch { return false; }
}

/** The conversations at work on one machine, private ones left out. */
export function storeWork(store: Store): PresenceWork[] {
  const names = new Map(store.projects.map(project => [project.id, project.name]));
  return store.threads
    .filter(thread => !thread.incognito && !thread.archived && (thread.status === 'running' || thread.status === 'queued' || thread.status === 'waiting'))
    .map(thread => ({
      status: thread.status,
      project: thread.projectId ? names.get(thread.projectId) ?? null : null,
      model: store.modelOf(thread)?.name ?? null,
      at: thread.runningSince ?? thread.requestSince ?? thread.updatedAt,
    }));
}

class PresencePublisher {
  showProjects = $state(readShowProjects());
  /** What the core last said: which chat apps show it. Null before the first answer. */
  status = $state.raw<PresenceStatus | null>(null);
  /** When the current stretch of work began, kept while any agent works so a finished one does not reset the timer. */
  #since: number | null = null;
  /** The timer counts no further back than this app's start: a question left waiting for days is not days of play. */
  readonly #opened = Date.now();
  #stop: (() => void) | null = null;

  /** The core this desktop app started, once connected: the chat apps' sockets are on its machine. */
  get local(): Store | null {
    if (!desktopShell()) return null;
    return workspace.machinesOr(workspace.active).find(machine => machine.store.localCore && machine.store.connection === 'ready')?.store ?? null;
  }

  /** The activity now, for the chat apps and the Settings preview alike. */
  activity(): PresenceActivity {
    const work = workspace.machinesOr(workspace.active).flatMap(machine => storeWork(machine.store));
    if (work.length === 0) this.#since = null;
    else this.#since ??= Math.max(this.#opened, Math.min(...work.map(each => each.at)));
    return presenceActivity(work, { projects: this.showProjects, startedAt: this.#since });
  }

  setShowProjects(on: boolean): void {
    this.showProjects = on;
    try { window.localStorage.setItem(SHOW_PROJECTS_KEY, on ? '1' : '0'); } catch { /* the choice lasts this session */ }
  }

  /** Follows the work and the switch until the app closes; once. */
  start(): void {
    if (this.#stop !== null) return;
    this.#stop = $effect.root(() => {
      // Who the presence went to, and as what: a change of thread that changes no word sends nothing.
      let shown: { store: Store; generation: number; text: string } | null = null;
      $effect(() => {
        const store = this.local;
        const activity = experimentOn('discord-presence') && store ? this.activity() : null;
        const target = store && activity ? { store, generation: store.clientGeneration, text: JSON.stringify(activity) } : null;
        if (shown && target && shown.store === target.store && shown.generation === target.generation && shown.text === target.text) return;
        // Off now, or another core: the one that showed it clears it. A client that reconnected has a new socket, whose close already cleared it.
        if (shown && (!target || shown.store !== target.store) && shown.store.client && shown.store.clientGeneration === shown.generation) {
          void shown.store.client.call('presence.set', { activity: null }).catch(() => {});
        }
        shown = target;
        if (!target || !activity) { this.status = null; return; }
        void target.store.client?.call('presence.set', { activity }).then(status => { if (shown === target) this.status = status; }, () => {});
      });
      // The chat apps that come and go while it shows.
      $effect(() => {
        const client = this.local?.client;
        if (!client || !experimentOn('discord-presence')) return;
        return client.on('presence.status', (status) => { this.status = status; });
      });
    });
  }
}

export const presence = new PresencePublisher();
