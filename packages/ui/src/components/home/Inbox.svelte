<script lang="ts">
  import { Bot, CirclePause, KeyRound, LogIn, MessageCircleQuestion, ShieldQuestion, TriangleAlert } from '@lucide/svelte';
  import { minuteClock, secondClock } from '../../lib/clock.svelte';
  import { elapsed, exactTime, projectName } from '../../lib/format';
  import { INBOX_CARDS, inbox, storeSources, type InboxCard, type InboxReason, type InboxRow } from '../../lib/inbox';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import type { ThreadSummary } from '@boite/contracts';
  import { threadState } from '../../lib/thread-state';
  import { workspace, type Machine } from '../../lib/workspace.svelte';
  import ProjectTile from '../ProjectTile.svelte';
  import StateRing from '../StateRing.svelte';
  import ThreadPicture from '../ThreadPicture.svelte';

  /**
   * The home's answer to "what needs me now", under the new-thread composer:
   * a card per thread waiting on the user, from every project and machine,
   * the longest wait first, then the threads at work. A card or a row opens
   * its thread, where the question or permission waits above the composer.
   * Nothing waiting says so quietly, on the sky.
   */
  let { store }: { store: Store } = $props();
  const labels = $derived(strings.inbox);
  const machines = $derived(workspace.machinesOr(store));
  const several = $derived(machines.length > 1);
  const lists = $derived(inbox(storeSources(machines)));
  /** A bot's own thread has no project and is no row of the sidebar. */
  const fromBot = (thread: ThreadSummary) => !!thread.agentSessionId;
  const botNeeds = $derived(lists.needs.filter(card => fromBot(card.thread)).length);
  const threadNeeds = $derived(lists.needs.length - botNeeds);
  let allCards = $state(false);
  let allRows = $state(false);
  const WORKING_ROWS = 5;
  const cards = $derived(allCards ? lists.needs : lists.needs.slice(0, INBOX_CARDS));
  const rows = $derived(allRows ? lists.working : lists.working.slice(0, WORKING_ROWS));
  const now = $derived(minuteClock.now);

  const icons: Record<InboxReason, typeof KeyRound> = { question: MessageCircleQuestion, permission: ShieldQuestion, secret: KeyRound, 'sign-in': LogIn, failed: TriangleAlert, interrupted: CirclePause };

  /** `12m`, `2h 57m`, `3d`: how long a card has waited, coarse enough to read at a glance. */
  function waited(since: number): string {
    const minutes = Math.max(1, Math.floor((now - since) / 60_000));
    if (minutes < 60) return fill(labels.minutes, { count: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return fill(labels.hours, { count: String(hours), minutes: String(minutes % 60).padStart(2, '0') });
    return fill(labels.days, { count: String(Math.floor(hours / 24)) });
  }
  function open(entry: { machine: Machine; thread: { id: string } }) {
    void workspace.select(entry.machine.store, entry.thread.id);
  }
</script>

<section class="inbox" data-testid="inbox" aria-label={labels.label}>
  {#if lists.needs.length}
    <!-- The threads' number is the sidebar's Needs you; a bot's ask is counted apart, behind a robot, as the Threads switch does. -->
    <h2 class="lane"><span class="ui-label">{labels.needsYou}</span>{#if threadNeeds}<span class="count" data-testid="inbox-needs-count" title={fill(labels.threadsCount, { count: String(threadNeeds) })}>{threadNeeds}</span>{/if}{#if botNeeds}<span class="count bots" data-testid="inbox-needs-bots" title={fill(labels.botsCount, { count: String(botNeeds) })} aria-label={fill(labels.botsCount, { count: String(botNeeds) })}><Bot size={11} aria-hidden="true" />{botNeeds}</span>{/if}</h2>
    <ul class="cards">
      {#each cards as card (`${card.machine.id}:${card.thread.id}`)}
        {@render needsCard(card)}
      {/each}
    </ul>
    {#if lists.needs.length > INBOX_CARDS}
      <button type="button" class="ghost small more" data-testid="inbox-more" aria-expanded={allCards} onclick={() => { allCards = !allCards; }}>
        <span class="ui-label">{allCards ? labels.fewer : fill(labels.more, { count: String(lists.needs.length - INBOX_CARDS) })}</span>
      </button>
    {/if}
  {:else}
    <p class="nothing" data-testid="inbox-empty">{labels.nothing}</p>
  {/if}

  {#if lists.working.length}
    <h2 class="lane working"><span class="ui-label">{labels.workingNow}</span><span class="count">{lists.working.length}</span></h2>
    <ul class="rows">
      {#each rows as row (`${row.machine.id}:${row.thread.id}`)}
        {@render workingRow(row)}
      {/each}
    </ul>
    {#if lists.working.length > WORKING_ROWS}
      <button type="button" class="ghost small more" data-testid="inbox-working-more" aria-expanded={allRows} onclick={() => { allRows = !allRows; }}>
        <span class="ui-label">{allRows ? labels.fewer : fill(labels.more, { count: String(lists.working.length - WORKING_ROWS) })}</span>
      </button>
    {/if}
  {/if}
</section>

{#snippet needsCard(card: InboxCard<Machine>)}
  {@const Icon = icons[card.reason]}
  {@const reason = labels.reasons[card.reason]}
  {@const time = waited(card.since)}
  <li>
    <button type="button" class="card" class:failed={card.reason === 'failed' || card.reason === 'sign-in' || card.reason === 'interrupted'} data-testid="inbox-card" data-thread-id={card.thread.id} data-machine-id={card.machine.id} data-reason={card.reason}
      aria-label={`${fill(labels.open, { title: card.thread.title })}. ${reason}${card.detail ? `: ${card.detail}` : ''}. ${fill(labels.waited, { time })}`} onclick={() => open(card)}>
      <StateRing kind={card.reason === 'failed' || card.reason === 'sign-in' || card.reason === 'interrupted' ? 'error' : 'waiting'} size={26} stale={card.machine.store.connection !== 'ready'} ground="var(--color-surface-2)">
        <ThreadPicture owner={card.machine.store} thread={card.thread} size={20} />
      </StateRing>
      <span class="body">
        <span class="top">
          {#if card.project}<span class="chip"><ProjectTile project={card.project} store={card.machine.store} size={14} /><span class="ui-label">{projectName(card.project)}</span></span>
          {:else if fromBot(card.thread)}<span class="chip bot" data-testid="inbox-card-bot"><Bot size={12} aria-hidden="true" /><span class="ui-label">{labels.bot}</span></span>{/if}
          {#if several}<span class="machine ui-label">{card.machine.label}</span>{/if}
          <time class="since" datetime={new Date(card.since).toISOString()} title={`${fill(labels.waited, { time })} · ${exactTime(card.since)}`}>{time}</time>
        </span>
        <span class="title">{card.thread.title}</span>
        <span class="why"><Icon size={13} /><span class="reason">{reason}</span>{#if card.detail}<span class="detail">{card.detail}</span>{/if}</span>
      </span>
    </button>
  </li>
{/snippet}

{#snippet workingRow(row: InboxRow<Machine>)}
  {@const time = elapsed(secondClock.now - row.since)}
  <li>
    <button type="button" class="row" data-testid="inbox-working" data-thread-id={row.thread.id} data-machine-id={row.machine.id}
      aria-label={`${fill(labels.open, { title: row.thread.title })}. ${fill(labels.working, { time })}`} onclick={() => open(row)}>
      <StateRing kind={threadState(row.thread, row.machine.store.subagents(row.thread.id))} size={16} stale={row.machine.store.connection !== 'ready'} ground="var(--color-background)">
        <ThreadPicture owner={row.machine.store} thread={row.thread} size={16} />
      </StateRing>
      <span class="title">{row.thread.title}</span>
      <span class="where ui-label">{[projectName(row.project) || null, several ? row.machine.label : null].filter(Boolean).join(' · ')}</span>
      <span class="elapsed">{time}</span>
    </button>
  </li>
{/snippet}

<style>
  .inbox {
    display: flex; flex-direction: column; align-items: stretch;
    width: min(calc(100% - 40px), var(--content)); max-height: 100%; min-height: 0;
    padding: 22px 0 24px; overflow-y: auto; scrollbar-width: thin;
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  ul { margin: 0; padding: 0; list-style: none; }
  .lane { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; font-size: var(--text-xs); font-weight: 600; color: var(--color-muted-foreground); text-transform: none; }
  .lane .count { padding: 0 7px; border-radius: var(--radius-full); line-height: 18px; font-variant-numeric: tabular-nums; background: color-mix(in oklch, var(--color-live-fill) 18%, transparent); color: var(--color-live); }
  .lane.working { margin-top: 18px; }
  .lane.working .count { background: var(--color-accent-soft); color: var(--color-accent); }
  /* Two cards a line where the column allows: four cards stay under the composer's fold. */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
  .card {
    display: flex; align-items: flex-start; gap: 12px; width: 100%; height: auto; min-height: 76px; padding: 12px 14px 12px 12px;
    border: 1px solid var(--color-border); border-radius: var(--radius-lg);
    background: color-mix(in oklch, var(--color-surface-2) 92%, transparent); box-shadow: var(--shadow-e1);
    color: var(--color-foreground); text-align: left; white-space: normal; font-weight: 400;
    transition: border-color var(--dur-1) var(--ease-out-quint), background var(--dur-1) var(--ease-out-quint);
  }
  .card:hover { border-color: color-mix(in oklch, var(--color-live-fill) 55%, var(--color-edge)); background: var(--color-surface-2); }
  .card.failed:hover { border-color: color-mix(in oklch, var(--color-danger) 55%, var(--color-edge)); }
  .body { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .top { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .chip { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 70%; padding: 1px 7px 1px 3px; border: 1px solid var(--color-border); border-radius: var(--radius-full); background: var(--color-surface); }
  .chip.bot { padding-left: 6px; color: var(--color-muted-foreground); }
  .lane .count.bots { display: inline-flex; align-items: center; gap: 3px; padding-left: 6px; }
  .chip .ui-label, .machine { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .since { margin-left: auto; flex: none; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--color-live); }
  .failed .since { color: var(--color-danger); }
  .card .title { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; line-clamp: 1; -webkit-box-orient: vertical; font-size: var(--text-base); font-weight: 600; line-height: 1.35; }
  .why { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .why > :global(svg) { flex: none; color: var(--color-live); }
  .failed .why > :global(svg) { color: var(--color-danger); }
  .reason { flex: none; color: var(--color-foreground); font-weight: 500; }
  .detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { align-self: flex-start; margin-top: 6px; color: var(--color-muted-foreground); }
  .nothing { margin: 4px 0 0; text-align: center; font-size: var(--text-sm); color: var(--color-muted-foreground); }

  .rows { display: flex; flex-direction: column; }
  .row {
    display: flex; align-items: center; gap: 10px; width: 100%; height: auto; min-height: 34px; padding: 4px 8px 4px 4px;
    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-foreground);
    text-align: left; font-size: var(--text-sm); font-weight: 400;
  }
  .row:hover { background: color-mix(in oklch, var(--color-surface-3) 70%, transparent); }
  .row .title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where { flex: 0 1 auto; max-width: 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .elapsed { flex: none; min-width: 52px; text-align: right; font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--color-accent); }
  @media (prefers-reduced-motion: reduce) { .inbox { animation: none; } }
  :global(html[data-motion='reduced']) .inbox { animation: none; }
</style>
