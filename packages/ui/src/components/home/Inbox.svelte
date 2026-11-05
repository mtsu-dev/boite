<script lang="ts">
  import { Bot, ChevronRight, CircleAlert, CirclePause, KeyRound, LogIn, MessageCircleQuestion, ShieldQuestion } from '@lucide/svelte';
  import { minuteClock, secondClock } from '../../lib/clock.svelte';
  import { elapsed, exactTime, projectName } from '../../lib/format';
  import { INBOX_CARDS, inbox, storeSources, waitedFor, type InboxCard, type InboxReason, type InboxRow } from '../../lib/inbox';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { threadState } from '../../lib/thread-state';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { workspace, type Machine } from '../../lib/workspace.svelte';
  import ProjectTile from '../ProjectTile.svelte';
  import StateRing from '../StateRing.svelte';
  import ThreadPicture from '../ThreadPicture.svelte';

  /**
   * The home's answer to "what needs me now", under the new-thread composer:
   * a card per thread waiting on the user, from every project and machine,
   * in the order of Recent's Needs you band beside it, then the threads at work. A card or a row opens
   * its thread, where the question or permission waits above the composer.
   * Nothing waiting says so quietly, on the sky.
   * Calm by default: three cards in one column, `See all` for the rest, and
   * the work folded under one quiet line the user opens when they want it
   * (remembered on this device).
   */
  let { store }: { store: Store } = $props();
  const labels = $derived(strings.inbox);
  const machines = $derived(workspace.machinesOr(store));
  const several = $derived(machines.length > 1);
  const lists = $derived(inbox(storeSources(machines)));
  /** The headers read the one count (`inbox().tally`), the strip's, the tabs' and the switch's: bots apart, offline machines never. */
  const botNeeds = $derived(lists.tally.bots.needs);
  const threadNeeds = $derived(lists.tally.threads.needs);
  const botWorking = $derived(lists.tally.bots.working);
  const threadWorking = $derived(lists.tally.threads.working);
  let allCards = $state(false);
  let allRows = $state(false);
  const WORKING_KEY = 'boite.inbox.working';
  let workingOpen = $state(readWorkingOpen());
  function readWorkingOpen(): boolean {
    try { return localStorage.getItem(WORKING_KEY) === 'open'; } catch { return false; }
  }
  function toggleWorking() {
    workingOpen = !workingOpen;
    try { localStorage.setItem(WORKING_KEY, workingOpen ? 'open' : 'closed'); } catch { /* Storage off: the fold lasts this page. */ }
  }
  const WORKING_ROWS = 5;
  /**
   * One number, one set: the header's count and `See all (n)` both count the
   * threads, as the sidebar's Needs you does. A bot's ask sits behind the
   * robot chip beside that count, which opens its cards; with no thread
   * asking, the bots' cards show at once.
   */
  const threadCards = $derived(lists.needs.filter(card => card.kind === 'threads'));
  const botCards = $derived(lists.needs.filter(card => card.kind === 'bots'));
  let botsOpen = $state(false);
  const botsShown = $derived(botCards.length > 0 && (botsOpen || threadCards.length === 0));
  const cards = $derived(allCards ? threadCards : threadCards.slice(0, INBOX_CARDS));
  const rows = $derived(allRows ? lists.working : lists.working.slice(0, WORKING_ROWS));
  const now = $derived(minuteClock.now);

  const icons: Record<InboxReason, typeof KeyRound> = { question: MessageCircleQuestion, permission: ShieldQuestion, secret: KeyRound, 'sign-in': LogIn, failed: CircleAlert, interrupted: CirclePause };

  /** A contact's request sits in the page's column, first, instead of floating over the home: loaded only once contacts are on. */
  let ContactRequestNotice = $state<typeof import('./ContactRequestNotice.svelte').default>();
  $effect(() => {
    if (!contactsShown(store) || ContactRequestNotice) return;
    void import('./ContactRequestNotice.svelte').then(module => { ContactRequestNotice = module.default; }).catch(() => {});
  });

  const waited = (since: number) => waitedFor(now, since);
  function open(entry: { machine: Machine; thread: { id: string } }) {
    void workspace.select(entry.machine.store, entry.thread.id);
  }
</script>

<section class="inbox" data-testid="inbox" aria-label={labels.label}>
  {#if ContactRequestNotice && contactsShown(store)}<ContactRequestNotice {store} flow />{/if}
  {#if lists.needs.length}
    <!-- The threads' number is the sidebar's Needs you; a bot's ask is counted apart, behind a robot, as the Threads switch does. -->
    <h2 class="lane"><span class="ui-label">{labels.needsYou}</span>{#if threadNeeds}<span class="count" data-testid="inbox-needs-count" title={fill(labels.threadsCount, { count: String(threadNeeds) })}>{threadNeeds}</span>{/if}{#if botNeeds}{@const botsLabel = fill(labels.botsCount, { count: String(botNeeds) })}<button type="button" class="ghost count bots" data-testid="inbox-needs-bots"
      aria-expanded={botsShown} aria-controls="inbox-bot-cards" disabled={threadCards.length === 0} title={botsLabel} aria-label={botsLabel} onclick={() => { botsOpen = !botsOpen; }}><Bot size={11} aria-hidden="true" />{botNeeds}</button>{/if}</h2>
    {#if botsShown}
      <ul class="cards bot-cards" id="inbox-bot-cards" data-testid="inbox-bot-cards">
        {#each botCards as card (`${card.machine.id}:${card.thread.id}`)}
          {@render needsCard(card)}
        {/each}
      </ul>
    {/if}
    <ul class="cards">
      {#each cards as card (`${card.machine.id}:${card.thread.id}`)}
        {@render needsCard(card)}
      {/each}
    </ul>
    {#if threadCards.length > INBOX_CARDS}
      <button type="button" class="ghost small more" data-testid="inbox-more" data-count={threadCards.length} aria-expanded={allCards} onclick={() => { allCards = !allCards; }}>
        <span class="ui-label">{allCards ? labels.fewer : fill(labels.more, { count: String(threadCards.length) })}</span>
      </button>
    {/if}
  {:else}
    <p class="nothing" data-testid="inbox-empty">{labels.nothing}</p>
  {/if}

  {#if lists.offline.length}
    <!-- A machine gone quiet keeps its asks in view, muted and uncounted, so they are not forgotten when it comes back. -->
    <h2 class="lane offline" title={labels.offlineHint}><span class="ui-label">{labels.offline}</span></h2>
    <ul class="cards offline" data-testid="inbox-offline">
      {#each lists.offline as card (`${card.machine.id}:${card.thread.id}`)}
        {@render needsCard(card)}
      {/each}
    </ul>
  {/if}

  {#if lists.working.length}
    <!-- The same split as Needs you: the threads' number is the strip's Working, a bot at work is counted apart.
         Work needs nothing from the user, so it waits folded under its line. -->
    <h2 class="lane working">
      <button type="button" class="ghost fold" data-testid="inbox-working-toggle" aria-expanded={workingOpen} aria-controls="inbox-working-rows" onclick={toggleWorking}>
        <ChevronRight class="chevron" size={13} aria-hidden="true" />
        <span class="ui-label">{labels.workingNow}</span>{#if threadWorking}<span class="count" data-testid="inbox-working-count" title={fill(labels.threadsCount, { count: String(threadWorking) })}>{threadWorking}</span>{/if}{#if botWorking}<span class="count bots" data-testid="inbox-working-bots" title={fill(labels.botsCount, { count: String(botWorking) })} aria-label={fill(labels.botsCount, { count: String(botWorking) })}><Bot size={11} aria-hidden="true" />{botWorking}</span>{/if}
      </button>
    </h2>
    {#if workingOpen}
    <ul class="rows" id="inbox-working-rows">
      {#each rows as row (`${row.machine.id}:${row.thread.id}`)}
        {@render workingRow(row)}
      {/each}
    </ul>
    {/if}
    {#if workingOpen && lists.working.length > WORKING_ROWS}
      <button type="button" class="ghost small more" data-testid="inbox-working-more" aria-expanded={allRows} onclick={() => { allRows = !allRows; }}>
        <span class="ui-label">{allRows ? labels.fewer : fill(labels.more, { count: String(lists.working.length) })}</span>
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
          <span class="title">{card.thread.title}</span>
          <time class="since" datetime={new Date(card.since).toISOString()} title={`${fill(labels.waited, { time })} · ${exactTime(card.since)}`}>{time}</time>
        </span>
        <!-- One grey line says where and why: the ring already says it asks. -->
        <span class="why">
          {#if card.project}<span class="where"><ProjectTile project={card.project} store={card.machine.store} size={14} /><span class="ui-label">{projectName(card.project)}</span></span>
          {:else if card.kind === 'bots'}<span class="where bot" data-testid="inbox-card-bot"><Bot size={13} aria-hidden="true" /><span class="ui-label">{labels.bot}</span></span>{/if}
          {#if several}<span class="machine ui-label">{card.machine.label}</span>{/if}
          <Icon size={13} class={card.reason === 'failed' ? 'failed-mark' : undefined} /><span class="reason">{reason}</span>{#if card.detail}<span class="detail">{card.detail}</span>{/if}
        </span>
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
    /* Scrolled rows fade under the composer instead of a hard cut; at rest the fades cover only the padding. */
    mask-image: linear-gradient(to bottom, transparent, black 18px, black calc(100% - 18px), transparent);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  ul { margin: 0; padding: 0; list-style: none; }
  .lane { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; font-size: var(--text-xs); font-weight: 600; color: var(--color-muted-foreground); text-transform: none; }
  /* A solid ground: an amber tint seen through the glass left the light theme's amber count at 4.35:1 on a pink wallpaper. */
  .lane .count { padding: 0 7px; border-radius: var(--radius-full); line-height: 18px; font-variant-numeric: tabular-nums; background: color-mix(in oklch, var(--color-live-fill) 18%, var(--color-surface-2)); color: var(--color-live); }
  .lane.working, .lane.offline { margin-top: 18px; }
  .lane.working { margin-bottom: 4px; }
  .cards.offline { opacity: 0.6; }
  /* Work asks nothing: its count stays grey, the amber is the asks' alone. */
  .lane.working .count { background: var(--color-control-surface); color: var(--color-muted-foreground); }
  .fold { display: inline-flex; align-items: center; gap: 6px; height: 24px; margin-left: -6px; padding: 0 8px 0 4px; border-radius: var(--radius-full);
    font: inherit; color: inherit; }
  .fold :global(.chevron) { flex: none; transition: transform var(--dur-2) var(--ease-out-quint); }
  .fold[aria-expanded='true'] :global(.chevron) { transform: rotate(90deg); }
  /* One column of cards, a mail app's unread: the eye reads down, never across. */
  .cards { display: flex; flex-direction: column; gap: 6px; }
  .card {
    display: flex; align-items: center; gap: 12px; width: 100%; height: auto; min-height: 60px; padding: 10px 14px 10px 12px;
    border: 1px solid transparent; border-radius: var(--radius-lg);
    background: var(--color-tile); box-shadow: var(--shadow-tile);
    color: var(--color-foreground); text-align: left; white-space: normal; font-weight: 400;
    transition: border-color var(--dur-1) var(--ease-out-quint), background var(--dur-1) var(--ease-out-quint);
  }
  .card:hover { border-color: color-mix(in oklch, var(--color-live-fill) 45%, transparent); background: var(--color-tile-hover); }
  .card.failed:hover { border-color: color-mix(in oklch, var(--color-danger) 55%, var(--color-edge)); }
  .body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .top { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .card .title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-base); font-weight: 600; line-height: 1.35; }
  .since { flex: none; font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--color-subtle); }
  .why { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .why > :global(svg) { flex: none; }
  /* A failure reads in one word and one glyph, the alert circle in the danger red, as on the tool lines. */
  .why > :global(svg.failed-mark) { color: var(--color-danger); }
  .where { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 5px; min-width: 0; max-width: 45%; }
  .where::after { content: '·'; margin-left: 1px; color: var(--color-subtle); }
  .lane .count.bots { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding-left: 6px; border: 0; font: inherit; font-variant-numeric: tabular-nums; }
  /* The robot chip opens the bots' asks: a button, the lift on hover its only change. */
  .lane button.count.bots:hover:not(:disabled) { background: color-mix(in oklch, var(--color-live-fill) 28%, var(--color-surface-2)); }
  .lane button.count.bots:disabled { opacity: 1; cursor: default; }
  .bot-cards { margin-bottom: 6px; }
  .where .ui-label, .machine { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .machine { flex: 0 1 auto; max-width: 25%; }
  .machine::after { content: '·'; margin-left: 6px; color: var(--color-subtle); }
  .reason { flex: none; }
  .detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-subtle); }
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
  .row .where { flex: 0 1 auto; max-width: 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .row .where::after { content: none; }
  .elapsed { flex: none; min-width: 52px; text-align: right; font-size: var(--text-xs); font-variant-numeric: tabular-nums; color: var(--color-subtle); }
  @media (prefers-reduced-motion: reduce) { .inbox { animation: none; } .fold :global(.chevron) { transition: none; } }
  :global(html[data-motion='reduced']) .inbox { animation: none; }
</style>
