<script lang="ts">
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { feedOperation, type FeedRow, type FeedVerb } from '../lib/activity-feed';
  import { strings } from '../lib/strings';
  import { leaveForAct } from '../lib/activity-return.svelte';
  import ThreadCard from './ThreadCard.svelte';
  import CommandWords from './CommandWords.svelte';

  /**
   * One Activity row, desktop (ActivityList.svelte): the list's own row (menu, drag, rename) with who asks, its title
   * on two lines at most, and what is asked as one line under it, whole in the row's tooltip; the
   * command of a permission in a mono block under them, each sub-agent that asks the same as a line of its own
   * (lib/activity-feed.ts: one event, one row). The mark, since when and the row's one action end the title's line. A command too long to read here turns Allow into Review, which opens the thread
   * first. Acting leaves Activity for the thread; once the ask is settled, Activity comes back where it was
   * (lib/activity-return.svelte.ts).
   */
  let { row, helpers = [], now }: { row: FeedRow<Machine>; helpers?: FeedRow<Machine>[]; now: number } = $props();
  const operation = $derived(feedOperation(row.machine.store, row.thread.id));
  const long = $derived(!!operation && (operation.split('\n').length > 6 || operation.length > 480));
  /** The row's action is its own, else the first sub-agent's that asks, which opens that sub-agent. */
  const target = $derived(row.verb ? row : helpers.find(helper => helper.verb) ?? null);
  const verb = $derived<FeedVerb | null>(target?.verb === 'allow' && long ? 'review' : target?.verb ?? null);
</script>

<ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact at={row.at}>
  {#snippet ask()}<span class="ask" data-testid="thread-reason" title={row.reason}>{row.reason}</span>{/snippet}
  {#snippet detail()}
    {#if operation}<code class="operation" class:long data-testid="thread-operation"><CommandWords text={operation} /></code>{/if}
    {#each helpers as helper (helper.thread.id)}
      <span class="ask helper" data-testid="thread-helper" data-thread-id={helper.thread.id} title={`${helper.thread.title} · ${helper.reason}`}><span class="who">{helper.thread.title}</span> <span class="sep" aria-hidden="true">·</span> {helper.reason}</span>
    {/each}
  {/snippet}
  {#snippet action()}
    <!-- Every row keeps the action's place, Updates included, so the mark, the time and the actions stand in one
         column each down the whole page. -->
    <span class="feed-action">
      {#if target && verb}
        <button type="button" class="small verb" data-testid="thread-verb" data-verb={verb} onclick={(event) => { leaveForAct(target.machine.store, target.thread.id, event.currentTarget); void workspace.select(target.machine.store, target.thread.id); }}>{strings.mobile.feed.verb[verb]}</button>
      {/if}
    </span>
  {/snippet}
</ThreadCard>

<style>
  /* Under the title's edge: what is asked, one secondary line; its tooltip and the thread hold the whole. */
  .ask { display: block; min-width: 0; font-size: var(--text-sm); line-height: 1.45; color: var(--color-muted-foreground); text-align: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A sub-agent's line, under the title's text edge (the 16 px tile and its 10 px gap). */
  .helper { display: block; flex: none; padding-left: 26px; }
  .who { color: var(--color-foreground); font-weight: 500; }
  .sep { color: var(--color-subtle); }
  /* The command as it will run: mono, wrapped at spaces only, so a path or a branch name stays whole. */
  .operation { display: block; margin-left: 26px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-code-background); color: var(--color-code-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.5; text-align: start; white-space: pre-wrap; overflow-x: auto; scrollbar-width: none; }
  /* Too long to read here: its first lines, and Review opens the whole before Allow. */
  .operation.long { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; line-clamp: 6; overflow: hidden; }
  /* One width for every action (ThreadCard's `--feed-verb`), so each starts at the same offset. */
  .feed-action { display: flex; flex: none; width: var(--feed-verb); }
  .verb { justify-content: center; width: 100%; height: var(--control-sm); font-size: var(--text-xs); font-weight: 600; }
</style>
