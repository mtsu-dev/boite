<script lang="ts">
  import { Activity } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { activityFeed } from '../lib/activity-feed';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { feedPlace, feedThread, inbox } from '../lib/inbox.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { strings } from '../lib/strings';
  import ThreadCard from './ThreadCard.svelte';

  /**
   * Desktop Activity, in the thread list's column: what contacts ask, then
   * the threads that need the user, failed or finished, each with why, as the
   * phone's Activity tab lists them (lib/activity-feed.ts). It loads on its
   * own, out of the entry chunk.
   */
  let { store }: { store: Store } = $props();
  const machines = $derived(workspace.machinesOr(store));
  const shown = $derived(machineFilter.shown(machines));
  const rows = $derived(activityFeed(machines.filter(machine => shown === null || machine.id === shown).flatMap(machine => {
    const byId = new Map(machine.store.projects.map(project => [project.id, project]));
    return machine.store.threads.filter(feedThread).map(thread => ({ machine, thread, project: thread.projectId === null ? undefined : byId.get(thread.projectId) }));
  }), feedPlace));
  const now = $derived(minuteClock.now);

  let ContactInboxRows = $state<typeof import('./home/ContactInboxRows.svelte').default>();
  $effect(() => {
    if (!contactsShown(store) || ContactInboxRows) return;
    void import('./home/ContactInboxRows.svelte').then(module => { ContactInboxRows = module.default; }).catch(() => {});
  });
</script>

<div class="activity-list" data-testid="activity-list">
  {#if ContactInboxRows && contactsShown(store)}<ContactInboxRows {store} />{/if}
  {#each rows as row (`${row.machine.id}:${row.thread.id}`)}
    <ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact reason={row.reason} nested={row.nested} />
  {/each}
  {#if rows.length === 0 && inbox.contacts === 0}
    <p class="empty" data-testid="activity-empty"><Activity size={14} aria-hidden="true" /><span class="ui-label">{strings.mobile.emptyActivity}</span></p>
  {/if}
</div>

<style>
  .activity-list { display: flex; flex-direction: column; gap: 2px; }
  /* Nothing waits: one quiet line, no card and no call to action. */
  .empty { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0; padding: 28px 12px; color: var(--color-subtle); font-size: var(--text-sm); }
</style>
