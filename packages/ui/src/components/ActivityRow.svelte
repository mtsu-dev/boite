<script lang="ts">
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { feedOperation, feedQuestion, feedSecondary, feedVerbLabel, type FeedRow, type FeedVerb } from '../lib/activity-feed';
  import { feedAsk, feedWhere } from '../lib/feed-row';
  import { leaveForAct } from '../lib/activity-return.svelte';
  import { ago, exactTime } from '../lib/format';
  import ThreadCard from './ThreadCard.svelte';
  import CommandWords from './CommandWords.svelte';
  import DecisionActions from './DecisionActions.svelte';
  import ActivityKind from './ActivityKind.svelte';
  import ClampText from './ClampText.svelte';

  /**
   * One Activity row (ActivityList.svelte): a Needs you row opens on its kind ("Permission", "Question", "Failed"),
   * then the list's own row (menu, drag, rename) with its title on two lines at most, led by its mark in the card's
   * mark column (ActivityMark.svelte); the place line under it, where the decision comes from (the project, the
   * machine among several, lib/feed-row.ts) and since when; an update opens on what happened ("Finished",
   * "Stopped") in the title's ink with its time beside it, so its place line only says where; what is asked under that, a question whole and a permission titled by what it does as the composer titles
   * it ("Push orbit/csv-import"); the command of a permission in a mono block under them, both whole up to four
   * lines and folded behind "Show all" past them (ClampText.svelte), so nothing is decided on a cut line; each
   * sub-agent that asks the same as a line of its own (lib/activity-feed.ts: one event, one row). The decision pair (DecisionActions.svelte, the composer's) stands at
   * the row's right edge: Deny or Skip outlined, settled here, then Allow or Answer solid, which opens the thread
   * where it is done. Review is outlined alone. A command too long to read here turns Allow into Review, which
   * opens the thread first. Acting leaves Activity for the thread; once the ask is settled, Activity comes back
   * where it was (lib/activity-return.svelte.ts).
   */
  let { row, helpers = [], now }: { row: FeedRow<Machine>; helpers?: FeedRow<Machine>[]; now: number } = $props();
  const operation = $derived(feedOperation(row.machine.store, row.thread.id));
  const ask = $derived(feedQuestion(row.machine.store, row.thread.id) ?? feedAsk(row.machine.store, row.thread.id, row));
  const where = $derived(feedWhere(row, workspace.machines.length > 1));
  const long = $derived(!!operation && (operation.split('\n').length > 6 || operation.length > 480));
  /** The row's action is its own, else the first sub-agent's that asks, which opens that sub-agent. */
  const target = $derived(row.verb ? row : helpers.find(helper => helper.verb) ?? null);
  const kind = $derived((target ?? row).kind);
  const verb = $derived<FeedVerb | null>(target?.verb === 'allow' && long ? 'review' : target?.verb ?? null);
  const secondary = $derived(target ? feedSecondary(target.machine.store, target.thread.id, verb) : null);
  let settling = $state(false);
  async function settle() {
    if (!secondary || settling) return;
    settling = true;
    try { await secondary.run(); } finally { settling = false; }
  }
</script>

{#snippet lead()}{#if kind}<ActivityKind {kind} news={!verb}>{#if !verb}<time title={exactTime(row.at)}>{ago(row.at, now)}</time>{/if}</ActivityKind>{/if}{/snippet}

<!-- An update's time follows its event's word; with no word, it ends the place line as a Needs you row's. -->
<ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact at={verb || !kind ? row.at : undefined} {where} lead={kind ? lead : undefined}>
  {#snippet detail()}
    {#if ask}<ClampText text={ask} testid="thread-reason" />{/if}
    {#if operation}<ClampText text={operation} testid="thread-operation" mono><CommandWords text={operation} /></ClampText>{/if}
    {#each helpers as helper (helper.thread.id)}
      <span class="ask helper" data-testid="thread-helper" data-thread-id={helper.thread.id} title={`${helper.thread.title} · ${helper.reason}`}><span class="who">{helper.thread.title}</span> <span class="sep" aria-hidden="true">·</span> {helper.reason}</span>
    {/each}
  {/snippet}
  {#snippet action()}
    {#if target && verb}
      <DecisionActions>
        {#if secondary}<button type="button" class="secondary" data-testid="thread-verb-secondary" data-verb={secondary.kind} disabled={settling} onclick={() => void settle()}>{feedVerbLabel(secondary.kind)}</button>{/if}
        <button type="button" class={verb === 'review' ? 'secondary' : 'primary'} data-testid="thread-verb" data-verb={verb} onclick={(event) => { leaveForAct(target.machine.store, target.thread.id, event.currentTarget); void workspace.select(target.machine.store, target.thread.id); }}>{feedVerbLabel(verb)}</button>
      </DecisionActions>
    {/if}
  {/snippet}
</ThreadCard>

<style>
  /* A sub-agent's line, on the title's edge: one line in the secondary ink, whole in its tooltip. */
  .ask { display: block; min-width: 0; contain: inline-size; font-size: var(--text-sm); line-height: 20px; color: var(--color-muted-foreground); text-align: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .helper { display: block; flex: none; }
  .who { color: var(--color-foreground); font-weight: 500; }
  .sep { color: var(--color-subtle); }
</style>
