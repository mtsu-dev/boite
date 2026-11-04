<script lang="ts">
  import { Archive, CheckCheck, CircleAlert, CircleDot, LoaderCircle } from '@lucide/svelte';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { archiveCount, projectThreadView, type ProjectThreadKind } from '../lib/project-threads.svelte';
  import { count as formatCount, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { recentPreferences } from '../lib/recent.svelte';
  import { threadState } from '../lib/thread-state';

  /**
   * A project's count chips: who needs the user (amber), what failed (red),
   * what works (accent, toggling the working fold), what is done and what was
   * archived (toggling their folds in place). A folded project keeps them all,
   * so it still says what it holds; a 0 draws nothing.
   * `away`: the machine is not connected, so its last known working count is drawn without the live colour,
   * and its needs and failures are not counted live.
   * `body`: the lists the card shows as its body. Their rows say the count, so the pill only stands in for them
   * while the card is folded, and unfolds it.
   */
  let { entry, working, controls, collapsed = false, searching = false, away = false, body = [] }: {
    entry: ProjectEntry; working: number; controls: string; collapsed?: boolean; searching?: boolean; away?: boolean; body?: readonly ProjectThreadKind[];
  } = $props();
  const kinds = ['working', 'done', 'archived'] as const;
  const labels = { working: strings.sidebar.projectWorkingThreads, done: strings.sidebar.projectDoneThreads, archived: strings.sidebar.projectArchivedThreads };
  const name = $derived(projectName(entry.project));
  /** The rows waiting on the user's hand, split as the ring draws them: a question in amber, a failure in red. */
  const hands = $derived.by(() => {
    let needs = 0, failed = 0;
    if (away) return { needs, failed };
    const store = entry.machine.store;
    for (const thread of store.threadsOf(entry.project.id)) {
      const state = threadState(thread, store.subagents(thread.id));
      if (state === 'waiting') needs += 1;
      else if (state === 'error' || state === 'interrupted') failed += 1;
    }
    return { needs, failed };
  });
</script>

<div class="counters">
  {#if hands.needs > 0}
    {@const label = fill(strings.sidebar.projectNeedsYou, { count: String(hands.needs), project: name })}
    <span class="counter needs" data-testid="project-waiting-count" data-count={hands.needs} role="img" title={label} aria-label={label}>
      <CircleDot size={12} aria-hidden="true" /><span class="ui-label">{formatCount(hands.needs)}</span>
    </span>
  {/if}
  {#if hands.failed > 0}
    {@const label = fill(strings.sidebar.projectFailed, { count: String(hands.failed), project: name })}
    <span class="counter failed" data-testid="project-failed-count" data-count={hands.failed} role="img" title={label} aria-label={label}>
      <CircleAlert size={12} aria-hidden="true" /><span class="ui-label">{formatCount(hands.failed)}</span>
    </span>
  {/if}
  {#each kinds as kind (kind)}
    {@const total = kind === 'working' ? working : archiveCount(entry.project, kind)}
    {@const open = !collapsed && !(kind === 'working' && searching) && projectThreadView.isOpen(entry, kind)}
    {@const label = fill(labels[kind], { count: String(total), project: name })}
    {@const inBody = body.includes(kind)}
    {@const grouped = (kind !== 'working' || recentPreferences.groupWorking) && !inBody}
    {@const toggles = inBody || (grouped && !(kind === 'working' && searching))}
    {#if total > 0 && (!inBody || collapsed)}
      {#if toggles}
        <button type="button" class="ghost counter {kind}" class:away class:active={open && grouped} data-testid="project-{kind}-toggle" data-count={total}
          title={label} aria-label={label} aria-expanded={open} aria-controls={grouped ? `${controls}-${kind}` : undefined}
          onclick={() => inBody ? entry.machine.store.toggleProject(entry.project.id) : projectThreadView.toggle(entry, kind, collapsed)}>
          {#if kind === 'working'}<LoaderCircle size={12} aria-hidden="true" />{:else if kind === 'done'}<CheckCheck size={12} aria-hidden="true" />{:else}<Archive size={12} aria-hidden="true" />{/if}
          <span class="ui-label">{formatCount(total)}</span>
        </button>
      {:else}
        <!-- Working rows listed inline have nothing to unfold: the count is a fact, never a dead button. -->
        <span class="counter {kind}" class:away data-testid="project-{kind}-toggle" data-count={total} role="img" title={label} aria-label={label}>
          <LoaderCircle size={12} aria-hidden="true" /><span class="ui-label">{formatCount(total)}</span>
        </span>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .counters { display: flex; flex: none; align-items: center; gap: 1px; }
  /* A chip per count that holds threads: an icon, the number, its words in the tooltip. */
  .counter { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 0; padding: 0 4px 0 3px; gap: 1px; border-radius: var(--radius-full);
    font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground); background-color: transparent; border: 1px solid transparent; background-clip: padding-box; }
  .needs { color: var(--color-live); background-color: color-mix(in oklch, var(--color-live-fill) 16%, transparent); }
  .failed { color: var(--color-danger); background-color: color-mix(in oklch, var(--color-danger) 14%, transparent); }
  .working:not(.away) { color: var(--color-accent); background-color: var(--color-accent-soft); }
  .done { color: var(--color-success); }
  .counter.active { box-shadow: inset 0 0 0 1px currentColor; }
  /* Hover deepens the chip's own tint instead of the grey a ghost button takes. */
  button.counter:hover { background-color: color-mix(in oklch, currentColor 20%, transparent); background-clip: padding-box; }
  button.working:not(.away):hover { color: var(--color-accent); }
  button.done:hover { color: var(--color-success); }
  /* A phone keeps the 44px target; the transparent border leaves a 32px chip drawn inside it. */
  @media (max-width: 720px) { .counters { gap: 0; } button.counter { min-width: var(--touch-target); min-height: var(--touch-target); padding: 0 8px; gap: 5px; border-width: 6px; }
    span.counter { height: 26px; padding: 0 8px; margin: 0 3px; } }
</style>
