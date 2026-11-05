<script lang="ts">
  import { Bot, MessagesSquare } from '@lucide/svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { followAgentDirectories } from '../lib/agent-directory.svelte';
  import { workTally } from '../lib/work-counts';

  /**
   * The switch at the top of the sidebar and of the Agents rail: the thread
   * list or the Agents page. A side carries one number, from the one rule
   * (`workTally`): how many need the user there, in the waiting colour, and
   * nothing when none does. Work and delegated agents are the lists' own
   * counts (the lifecycle strip, the Bots page), so a navigation switch never
   * shows a second number beside the first. The Threads side counts project
   * threads, the Bots side the bots' own threads. With the Agents experiment
   * off there is only one place to be, so the switch is not drawn at all. On
   * the thread list the lifecycle strip under it already counts the threads,
   * so the Threads side shows its count only from the Agents page.
   */
  let { store, current, prefix = '' }: { store: Store; current: 'threads' | 'agents'; prefix?: string } = $props();

  const stores = $derived(workspace.machines.length ? workspace.machines.map(machine => machine.store) : [store]);
  const on = $derived(experimentOn('resident-agents'));
  const tally = $derived(on ? workTally(stores) : null);
  const threads = $derived(tally ? tally.threads.needs : 0);
  const agents = $derived(tally ? tally.bots.needs : 0);

  // Every machine's agents snapshot stays loaded while the switch is drawn, so the Agents count is current from either side.
  followAgentDirectories(() => stores, () => on);
</script>

{#snippet badge(needs: number, testid: string)}
  {#if needs > 0}
    {@const label = fill(strings.sidebar.surfaceNeeds, { count: String(needs) })}
    <span class="count" data-testid={testid} data-count={needs} data-counts="needs" title={label} aria-label={label}>
      <span class="pulse" aria-hidden="true"></span><span class="ui-label" data-testid={`${testid}-rows`}>{needs}</span>
    </span>
  {/if}
{/snippet}

{#if on}
  <div class="surface-switch" role="group" aria-label={strings.sidebar.surface}>
    <button type="button" class="ghost small view" class:chosen={current === 'threads'} aria-pressed={current === 'threads'} data-testid={`${prefix}view-threads`}
      onclick={() => { if (current !== 'threads') store.showChat(); }}>
      <MessagesSquare size={13} /><span class="label ui-label">{strings.sidebar.threads}</span>{#if current !== 'threads'}{@render badge(threads, `${prefix}threads-at-work`)}{/if}
    </button>
    <button type="button" class="ghost small view" class:chosen={current === 'agents'} aria-pressed={current === 'agents'} data-testid={`${prefix}view-agents`} data-preload-view="agents"
      onclick={() => { if (current !== 'agents') store.showAgents(); }}>
      <Bot size={14} /><span class="label ui-label">{strings.sidebar.agents}</span>{@render badge(agents, `${prefix}agents-at-work`)}
    </button>
  </div>
{/if}

<style>
  .surface-switch { container-type: inline-size; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: var(--radius-md); background: var(--color-segment-track); }
  /* A phone's menu holds Conversations and Bots already, with what waits: the switch would say it twice. */
  @media (max-width: 720px) { :global(.app:not(.shell)) .surface-switch { display: none; } }
  /* Each side grows from its own content, so "Conversations" and its count
     keep their width beside a short "Bots" instead of an equal half each. */
  .view { flex: 1 1 auto; min-width: 0; padding-inline: 5px; color: var(--color-muted-foreground); }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .view { border-radius: calc(var(--radius-md) - 3px); }
  .chosen, .chosen:hover:not(:disabled) { background: var(--color-segment-thumb); color: var(--color-foreground); box-shadow: var(--shadow-thumb); }
  /* What needs the user on that side: an amber pill with a breathing dot.
     A solid ground: amber text on a see-through tint lost its contrast over the light glass (3.8:1). */
  .count {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    height: 16px;
    padding: 0 6px 0 5px;
    border-radius: var(--radius-full);
    background: color-mix(in oklch, var(--color-live) 16%, var(--color-surface-2));
    color: var(--color-live);
    font-size: var(--text-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .pulse { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: surface-pulse 1.6s var(--loop-ease-out-quint-48) infinite var(--loops); }
  @keyframes surface-pulse { 0%, 100% { opacity: 1; transform: none; } 50% { opacity: .35; transform: scale(.7); } }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  :global(html[data-motion='reduced']) .pulse { animation: none; }
  @container (max-width: 220px) {
    .view > :global(svg) { display: none; }
  }
</style>
