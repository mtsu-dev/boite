<script lang="ts">
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { activityFeed, feedGroups } from '../lib/activity-feed';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { feedPlace, feedThread, inbox } from '../lib/inbox.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { strings } from '../lib/strings';
  import { count } from '../lib/format';
  import ActivityRow from './ActivityRow.svelte';
  import EmptyState, { HOUSE_BOT } from './EmptyState.svelte';
  import RobotFace from './agents/RobotFace.svelte';
  import { restoreActivity } from '../lib/activity-return.svelte';

  /**
   * Desktop Activity, the main card's page while the rail has it on
   * (App.svelte), as triage in two sections: Needs you (what contacts ask,
   * then the threads that ask or failed), then Updates (finished or stopped
   * short), each with what it asks, whole, and since when, as the phone's Activity lists them
   * (lib/activity-feed.ts), one row per event (ActivityRow.svelte), in the chat's column. Every machine, as the
   * rail's count. It loads on its own, out of the entry chunk.
   */
  let { store }: { store: Store } = $props();
  const machines = $derived(workspace.machinesOr(store));
  const rows = $derived(activityFeed(machines.flatMap(machine => {
    const byId = new Map(machine.store.projects.map(project => [project.id, project]));
    return machine.store.threads.filter(feedThread).map(thread => ({ machine, thread, project: thread.projectId === null ? undefined : byId.get(thread.projectId) }));
  }), feedPlace));
  const needs = $derived(feedGroups(rows.filter(row => row.section === 'needs')));
  const updates = $derived(feedGroups(rows.filter(row => row.section === 'updates')));
  /** The section's number, the rail's badge's: its rows (a sub-agent counts on its parent) and what contacts ask. */
  const needsCount = $derived(needs.length + inbox.contacts);
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
  // Back from a thread an action opened: the scroll it had and the keyboard where the user was.
  let page = $state<HTMLElement>();
  $effect(() => { if (page) void restoreActivity(page); });
  /** Out of Activity into a fresh draft, as the list's New thread. */
  function newThread() {
    inbox.open = false;
    store.startDraft(undefined, { fresh: true });
  }
  /** A new thread asked for by its key may land on the draft already behind the page: it leaves the page all the same. */
  function onkeydown(event: KeyboardEvent) {
    if (store.commandForKey(event) === 'new-thread') inbox.open = false;
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<!-- The window's band names the page, in its empty state too: the card carries no second title. -->
<section class="activity-page" data-testid="activity-list" aria-label={strings.mobile.activity} tabindex="-1" bind:this={page}>
  <div class="column">
    <!-- The section names the mark its rows wear: the amber dot beside "Needs you", learned together. -->
    {#if needsCount > 0}<h2 class="section-label" data-testid="activity-needs" data-count={needsCount}><span class="dot" aria-hidden="true"></span>{strings.sidebar.state.waiting}<span class="count">{count(needsCount)}</span></h2>
    {:else if rows.length > 0}<p class="all-done" data-testid="activity-all-done"><span class="face" aria-hidden="true"><RobotFace robot={HOUSE_BOT} /></span>{strings.mobile.nothingNeedsYou}</p>{/if}
    {#if ContactInboxRows && contactsShown(store)}<ContactInboxRows {store} />{/if}
    {#each needs as { row, helpers } (`${row.machine.id}:${row.thread.id}`)}<ActivityRow {row} {helpers} {now} />{/each}
    {#if updates.length > 0}<h2 class="section-label" data-testid="activity-updates">{strings.mobile.feed.updates}</h2>{/if}
    {#each updates as { row, helpers } (`${row.machine.id}:${row.thread.id}`)}<ActivityRow {row} {helpers} {now} />{/each}
    {#if rows.length === 0 && inbox.contacts === 0}
      <!-- Nothing waits: the app's one empty view, small, with the one thing left to do. -->
      <EmptyState line={strings.mobile.emptyActivity} testid="activity-empty" small>
        {#snippet action()}<button type="button" class="primary" data-testid="activity-new-thread" onclick={newThread}>{strings.sidebar.newThread}</button>{/snippet}
      </EmptyState>
    {/if}
  </div>
</section>

<style>
  /* The chat's own column (MessageList.svelte): the same side room and gutters, then --content, so a thread and
     Activity read at one width, centred in the card. */
  .activity-page { flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable both-edges; padding: 0 var(--outline-room); outline: none; }
  /* Centred across like Settings and sized to what it holds, between a reading measure and the column; anchored at
     the card's top as a thread starts at its top (round 20: centred, a short list began 230 px down over a void).
     Only the empty state sits in the middle. */
  .column { display: flex; flex-direction: column; gap: 2px; width: fit-content; min-width: min(100%, var(--prose)); max-width: var(--content); min-height: 100%; margin: 0 auto; padding: var(--space-6) 0 max(var(--space-6), 10vh); }
  .column:has(:global([data-testid=activity-empty])) { justify-content: center; }
  /* A section's name over its rows, from the rows' text edge; the next section stands off the last row. */
  /* From the rows' tile edge (ThreadCard's compact 10 px). */
  h2 { margin: 0 0 var(--space-2) 10px; }
  h2 ~ h2 { margin-top: var(--space-6); }
  /* The section's count, the rail badge's number: amber marks it, the word stays grey. */
  h2 .count { margin-left: 6px; color: var(--color-live); font-variant-numeric: tabular-nums; }
  h2 { display: flex; align-items: center; }
  .dot { width: 8px; height: 8px; margin-right: 8px; flex: none; border-radius: var(--radius-full); background: var(--color-live); }
  /* Only updates left: the house mascot, small, says nothing waits; the moment is rare, so it may smile. */
  .all-done { display: flex; align-items: center; gap: 10px; margin: 0 0 var(--space-4) 10px; font-size: var(--text-sm); font-weight: 500; color: var(--color-muted-foreground); }
  .face { display: block; width: 24px; height: 24px; flex: none; }
  .face :global(svg.robot) { display: block; width: 100%; height: 100%; border-radius: 50%; }
</style>
