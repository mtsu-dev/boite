/*
 * The teams of one machine (`docs/teams.md`), read with `teams.list` and read
 * again on `teams.changed`, for the Teams section of the lists and the team
 * chat. A core that refuses the read (the Teams experiment off there, or an
 * older core) leaves the list empty; the desktop turning the experiment on
 * reads it again.
 */

import type { Team, TeamParty, ThreadId, ThreadSummary } from '@boite/contracts';
import { TEAM_OWNER } from '@boite/contracts';
import { untrack } from 'svelte';
import { formatLocale } from './i18n.svelte';
import { strings } from './strings';
import type { Store } from './store.svelte';
import type { Machine } from './workspace.svelte';

export class TeamDirectory {
  /** Every team, the archived ones too: an archived team's chat still opens, and says it takes no more posts. */
  teams = $state.raw<Team[]>([]);
  /** A first read answered: an empty list then means no team. */
  loaded = $state(false);

  readonly store: Store;
  #watchers = 0;
  #release: (() => void) | null = null;
  #client: unknown = null;
  #ready = false;
  #reading = 0;

  constructor(store: Store) {
    this.store = store;
  }

  /** Reads the teams and follows their changes while something draws them. Returns the release. */
  watch(): () => void {
    this.#watchers += 1;
    this.follow();
    return () => {
      this.#watchers -= 1;
      if (this.#watchers > 0) return;
      this.#release?.();
      this.#release = null;
      this.#client = null;
      this.#ready = false;
      this.#reading += 1;
    };
  }

  /** A socket can reconnect on the same client: read again after either one changes. */
  follow(): void {
    const client = this.store.client;
    const ready = this.store.connection === 'ready';
    if (this.#watchers === 0 || (client === this.#client && ready === this.#ready)) return;
    this.#release?.();
    this.#client = client;
    this.#ready = ready;
    this.#reading += 1;
    if (client) {
      const changed = client.on('teams.changed', () => { void this.refresh(); });
      // The core gates teams on the desktop's experiments: a read made before it heard of them was refused.
      const switched = client.on('client.desktopExperiments', ({ experiments }) => { if (experiments.includes('teams')) void this.refresh(); });
      this.#release = () => { changed(); switched(); };
    } else this.#release = null;
    if (ready) void this.refresh();
  }

  async refresh(): Promise<void> {
    const read = ++this.#reading;
    const client = this.store.client;
    if (!client || this.store.connection !== 'ready') return;
    try {
      const { teams } = await client.call('teams.list', { archived: true });
      // An older read that lands after a newer one must not put back what changed since.
      if (read !== this.#reading || client !== this.store.client) return;
      this.teams = teams;
    } catch {
      if (read !== this.#reading || client !== this.store.client) return;
      this.teams = [];
    }
    this.loaded = true;
  }

  /** The team whose chat is this thread. */
  ofThread(threadId: ThreadId | undefined): Team | null {
    return threadId === undefined ? null : this.teams.find(team => team.threadId === threadId) ?? null;
  }
}

const directories = new WeakMap<Store, TeamDirectory>();

/** One directory per machine, kept while its Store lives, so a second visit draws at once. */
export function teamsOf(store: Store): TeamDirectory {
  let directory = directories.get(store);
  if (!directory) {
    directory = new TeamDirectory(store);
    directories.set(store, directory);
  }
  return directory;
}

/** A team as the lists draw it: its machine and its chat's summary, for the unread mark. */
export interface TeamRow { machine: Machine; team: Team; chat: ThreadSummary | undefined }

/**
 * Keeps every listed machine's teams read while a list is drawn, and follows
 * each machine's reconnections. Call it while a component starts and read the
 * rows, the teams not archived, from what it returns.
 */
export function watchTeams(machines: () => readonly Machine[]): () => TeamRow[] {
  const views = $derived(machines().map(machine => ({ machine, directory: teamsOf(machine.store) })));
  $effect(() => {
    const watched = views.map(entry => entry.directory);
    const releases = untrack(() => watched.map(directory => directory.watch()));
    return () => { for (const release of releases) release(); };
  });
  $effect(() => { for (const { machine, directory } of views) { void machine.store.client; void machine.store.connection; untrack(() => directory.follow()); } });
  return () => views.flatMap(({ machine, directory }) => directory.teams.filter(team => !team.archived).map(team => ({ machine, team, chat: machine.store.threads.find(thread => thread.id === team.threadId) })));
}

/** Keeps one machine's teams read while the caller is drawn: the team chat, opened without the list. */
export function followTeams(store: () => Store): void {
  $effect(() => {
    const directory = teamsOf(store());
    const release = untrack(() => directory.watch());
    return release;
  });
  $effect(() => { const owner = store(); void owner.client; void owner.connection; untrack(() => teamsOf(owner).follow()); });
}

/** A member's key to its bot id: `<coreId>/<botId>`. */
export function botIdOf(key: string): string {
  return key.slice(key.indexOf('/') + 1);
}

/** Who wrote or receives a post, as the owner reads it: You (you inside a sentence), the member's name, else the bot id its key holds. */
export function partyName(team: Pick<Team, 'members'> | null, party: TeamParty, inText = false): string {
  if (party === TEAM_OWNER) return inText ? strings.teamChat.youInText : strings.teamChat.you;
  return team?.members.find(member => member.key === party)?.name ?? botIdOf(party);
}

/** Names listed for a line of the chat, in the app's language: "A, B and C". */
export function listNames(names: readonly string[]): string {
  try { return new Intl.ListFormat(formatLocale(), { type: 'conjunction' }).format(names); } catch { return names.join(', '); }
}
