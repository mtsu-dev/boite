<script lang="ts">
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { activityFeed } from '../lib/activity-feed';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { feedPlace, feedThread, inbox } from '../lib/inbox.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { strings } from '../lib/strings';
  import ThreadCard from './ThreadCard.svelte';
  import EmptyState from './EmptyState.svelte';

  /**
   * Desktop Activity, the main card's page while the rail has it on
   * (App.svelte), as triage in two sections: Needs you (what contacts ask,
   * then the threads that ask or failed), then Updates (finished or stopped
   * short), each with why and since when, as the phone's Activity lists them
   * (lib/activity-feed.ts), in the list's own rows (menu, drag, rename). Every machine, as the rail's count. It loads on its own, out of
   * the entry chunk.
   */
  let { store }: { store: Store } = $props();
  const machines = $derived(workspace.machinesOr(store));
  const rows = $derived(activityFeed(machines.flatMap(machine => {
    const byId = new Map(machine.store.projects.map(project => [project.id, project]));
    return machine.store.threads.filter(feedThread).map(thread => ({ machine, thread, project: thread.projectId === null ? undefined : byId.get(thread.projectId) }));
  }), feedPlace));
  const needs = $derived(rows.filter(row => row.section === 'needs'));
  const updates = $derived(rows.filter(row => row.section === 'updates'));
  const now = $derived(minuteClock.now);

  let ContactInboxRows = $state<typeof import('./home/ContactInboxRows.svelte').default>();
  $effect(() => {
    if (!contactsShown(store) || ContactInboxRows) return;
    void import('./home/ContactInboxRows.svelte').then(module => { ContactInboxRows = module.default; }).catch(() => {});
  });

  // A thread or another draft opened from anywhere (a row here, the list, the palette, a notification) takes the card back.
  let last: readonly unknown[] | undefined;
  $effect(() => {
    const next = [store, store.openThread?.id, store.draft?.id] as const;
    if (last && next.some((value, index) => value !== last![index]) && (next[1] || next[2])) inbox.open = false;
    last = next;
  });
  /** A new thread asked for by its key may land on the draft already behind the page: it leaves the page all the same. */
  function onkeydown(event: KeyboardEvent) {
    if (store.commandForKey(event) === 'new-thread') inbox.open = false;
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<section class="activity-page" data-testid="activity-list" aria-labelledby="activity-heading">
  <div class="column">
    <h1 id="activity-heading">{strings.mobile.activity}</h1>
    {#if needs.length > 0 || inbox.contacts > 0}<h2 class="section-label" data-testid="activity-needs">{strings.sidebar.state.waiting}</h2>{/if}
    {#if ContactInboxRows && contactsShown(store)}<ContactInboxRows {store} />{/if}
    {#each needs as row (`${row.machine.id}:${row.thread.id}`)}
      <ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact reason={row.reason} at={row.at} nested={row.nested} />
    {/each}
    {#if updates.length > 0}<h2 class="section-label" data-testid="activity-updates">{strings.mobile.feed.updates}</h2>{/if}
    {#each updates as row (`${row.machine.id}:${row.thread.id}`)}
      <ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact reason={row.reason} at={row.at} nested={row.nested} />
    {/each}
    {#if rows.length === 0 && inbox.contacts === 0}
      <!-- Nothing waits: the app's one empty view, small, with no call to action (the list beside it has New thread). -->
      <EmptyState line={strings.mobile.emptyActivity} testid="activity-empty" small />
    {/if}
  </div>
</section>

<style>
  .activity-page { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; }
  /* A reading column, as the chat's: rows of a thread's width read better than rows of the screen's. */
  .column { display: flex; flex-direction: column; gap: 2px; width: min(100%, 720px); min-height: 100%; margin: 0 auto; padding: var(--space-8) var(--space-6) var(--space-6); }
  h1 { margin: 0 0 var(--space-4) var(--space-3); font-size: var(--text-lg); font-weight: 650; letter-spacing: -0.015em; color: var(--color-foreground); }
  /* A section's name over its rows, from the rows' text edge; the next section stands off the last row. */
  h2 { margin: 0 0 var(--space-2) var(--space-3); }
  h2 ~ h2 { margin-top: var(--space-6); }
  /* A reading column's rows: a step taller than the list's. */
  .column :global([data-testid=thread-row] .row) { padding-block: 8px; }
</style>
