<script lang="ts">
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { feedOperation, feedSecondary, feedVerbLabel, type FeedRow, type FeedVerb } from '../lib/activity-feed';
  import { feedAsk, feedWhere } from '../lib/feed-row';
  import { leaveForAct } from '../lib/activity-return.svelte';
  import ThreadCard from './ThreadCard.svelte';
  import CommandWords from './CommandWords.svelte';
  import DecisionActions from './DecisionActions.svelte';

  /**
   * One Activity row, desktop (ActivityList.svelte): the list's own row (menu, drag, rename) with its title on two
   * lines at most, ended by its mark; the place line under it, where the decision comes from (the project, the
   * machine among several, lib/feed-row.ts) and since when; what is asked as one line under that, whole in its
   * tooltip, a permission titled by what it does as the composer titles it ("Push orbit/csv-import"); the command
   * of a permission in a mono block under them, each sub-agent that asks the same as a line of its own
   * (lib/activity-feed.ts: one event, one row). The decision pair (DecisionActions.svelte, the composer's) stands at
   * the row's right edge: Deny or Skip outlined, settled here, then Allow or Answer solid, which opens the thread
   * where it is done. Review is outlined alone. A command too long to read here turns Allow into Review, which
   * opens the thread first. Acting leaves Activity for the thread; once the ask is settled, Activity comes back
   * where it was (lib/activity-return.svelte.ts).
   */
  let { row, helpers = [], now }: { row: FeedRow<Machine>; helpers?: FeedRow<Machine>[]; now: number } = $props();
  const operation = $derived(feedOperation(row.machine.store, row.thread.id));
  const ask = $derived(feedAsk(row.machine.store, row.thread.id, row));
  const where = $derived(feedWhere(row, workspace.machines.length > 1));
  const long = $derived(!!operation && (operation.split('\n').length > 6 || operation.length > 480));
  /** The row's action is its own, else the first sub-agent's that asks, which opens that sub-agent. */
  const target = $derived(row.verb ? row : helpers.find(helper => helper.verb) ?? null);
  const verb = $derived<FeedVerb | null>(target?.verb === 'allow' && long ? 'review' : target?.verb ?? null);
  const secondary = $derived(target ? feedSecondary(target.machine.store, target.thread.id, verb) : null);
  let settling = $state(false);
  async function settle() {
    if (!secondary || settling) return;
    settling = true;
    try { await secondary.run(); } finally { settling = false; }
  }
</script>

<ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact at={row.at} {where}>
  {#snippet detail()}
    {#if ask}<span class="ask" data-testid="thread-reason" title={ask}>{ask}</span>{/if}
    {#if operation}<code class="operation" class:long data-testid="thread-operation"><CommandWords text={operation} /></code>{/if}
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
  /* Under the place line: what is asked, one line in the secondary ink, a step above the place's meta; its tooltip
     and the thread hold the whole. It takes the width it is given, never widening the row's text column. */
  .ask { display: block; min-width: 0; contain: inline-size; font-size: var(--text-sm); line-height: 1.45; color: var(--color-muted-foreground); text-align: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A sub-agent's line, on the title's edge. */
  .helper { display: block; flex: none; }
  .who { color: var(--color-foreground); font-weight: 500; }
  .sep { color: var(--color-subtle); }
  /* The command as it will run: mono, wrapped at spaces only, so a path or a branch name stays whole. */
  .operation { display: block; contain: inline-size; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-code-background); color: var(--color-code-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.5; text-align: start; white-space: pre-wrap; overflow-x: auto; scrollbar-width: none; }
  /* Too long to read here: its first lines, and Review opens the whole before Allow. */
  .operation.long { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; line-clamp: 6; overflow: hidden; }
</style>
