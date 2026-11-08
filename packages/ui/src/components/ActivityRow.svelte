<script lang="ts">
  import type { Machine } from '../lib/workspace.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { feedOperation, type FeedRow, type FeedVerb } from '../lib/activity-feed';
  import { strings } from '../lib/strings';
  import ThreadCard from './ThreadCard.svelte';

  /**
   * One Activity row, desktop (ActivityList.svelte): the list's own row (menu, drag, rename) with who asks, its title
   * on two lines at most, then what is asked, whole: the command of a permission in a mono block, each sub-agent
   * that asks as a line of its own, so one thread is one row. Since when and the row's one action stand at the
   * right edge. A command too long to read here turns Allow into Review, which opens the thread first.
   */
  let { row, helpers = [], now }: { row: FeedRow<Machine>; helpers?: FeedRow<Machine>[]; now: number } = $props();
  const operation = $derived(feedOperation(row.machine.store, row.thread.id));
  const long = $derived(!!operation && (operation.split('\n').length > 6 || operation.length > 480));
  /** The row's action is its own, else the first sub-agent's that asks, which opens that sub-agent. */
  const target = $derived(row.verb ? row : helpers.find(helper => helper.verb) ?? null);
  const verb = $derived<FeedVerb | null>(target?.verb === 'allow' && long ? 'review' : target?.verb ?? null);
</script>

<ThreadCard machine={row.machine} project={row.project} thread={row.thread} {now} compact at={row.at}>
  {#snippet detail()}
    <span class="ask" data-testid="thread-reason">{row.reason}</span>
    {#if operation}<code class="operation" class:long data-testid="thread-operation">{operation}</code>{/if}
    {#each helpers as helper (helper.thread.id)}
      <span class="ask helper" data-testid="thread-helper" data-thread-id={helper.thread.id}><span class="who">{helper.thread.title}</span> <span class="sep" aria-hidden="true">·</span> {helper.reason}</span>
    {/each}
  {/snippet}
  {#snippet action()}
    {#if target && verb}
      <button type="button" class="small verb" data-testid="thread-verb" data-verb={verb} onclick={() => void workspace.select(target.machine.store, target.thread.id)}>{strings.mobile.feed.verb[verb]}</button>
    {/if}
  {/snippet}
</ThreadCard>

<style>
  /* Under the title, from its text edge (the 16 px tile and its 10 px gap): what is asked, wrapped, never cut. */
  .ask { display: block; padding-left: 26px; font-size: var(--text-sm); line-height: 1.45; color: var(--color-muted-foreground); text-align: start; white-space: normal; overflow-wrap: anywhere; }
  .who { color: var(--color-foreground); font-weight: 500; }
  .sep { color: var(--color-subtle); }
  /* The command as it will run: mono, wrapped, every line of it. */
  .operation { display: block; margin-left: 26px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-code-background); color: var(--color-code-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.5; text-align: start; white-space: pre-wrap; overflow-wrap: anywhere; }
  /* Too long to read here: its first lines, and Review opens the whole before Allow. */
  .operation.long { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; line-clamp: 6; overflow: hidden; }
  .verb { justify-content: center; min-width: 11ch; height: var(--control-sm); font-size: var(--text-xs); font-weight: 600; }
</style>
