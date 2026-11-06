<script lang="ts">
  import { Archive, CheckCheck, LoaderCircle } from '@lucide/svelte';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { archiveCount, projectThreadView, type ProjectThreadKind } from '../lib/project-threads.svelte';
  import { count as formatCount, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { recentPreferences } from '../lib/recent.svelte';

  /**
   * `away`: the machine is not connected, so its last known working count is drawn without the live colour.
   * `body`: the lists the card shows as its body. Their rows say the count, so the pill only stands in for them
   * while the card is folded, and unfolds it.
   * `part`: the desktop card splits them. Its header keeps what matters now, the threads that need the user
   * (`waiting`) and the working ones; its foot keeps Done and Archived. A phone's header draws them all.
   */
  let { entry, working, controls, collapsed = false, searching = false, away = false, body = [], part = 'all', waiting = 0 }: {
    entry: ProjectEntry; working: number; controls: string; collapsed?: boolean; searching?: boolean; away?: boolean; body?: readonly ProjectThreadKind[];
    part?: 'all' | 'head' | 'foot'; waiting?: number;
  } = $props();
  const kinds = $derived(part === 'head' ? ['working'] as const : part === 'foot' ? ['done', 'archived'] as const : ['working', 'done', 'archived'] as const);
  const labels = { working: strings.sidebar.projectWorkingThreads, done: strings.sidebar.projectDoneThreads, archived: strings.sidebar.projectArchivedThreads };
  const waitingLabel = $derived(fill(strings.sidebar.projectWaitingThreads, { count: String(waiting), project: projectName(entry.project) }));
</script>

<div class="counters {part}">
  {#if part === 'head' && waiting > 0}
    <span class="counter waiting" data-testid="project-waiting-count" data-count={waiting} role="img" title={waitingLabel} aria-label={waitingLabel}><span class="ui-label">{formatCount(waiting)}</span></span>
  {/if}
  {#each kinds as kind (kind)}
    {@const total = kind === 'working' ? working : archiveCount(entry.project, kind)}
    {@const open = !collapsed && !(kind === 'working' && searching) && projectThreadView.isOpen(entry, kind)}
    {@const label = fill(labels[kind], { count: String(total), project: projectName(entry.project) })}
    {@const inBody = body.includes(kind)}
    {@const grouped = (kind !== 'working' || recentPreferences.groupWorking) && !inBody}
    {#if total > 0 && (!inBody || collapsed)}
    <button type="button" class="ghost counter {kind}" class:away class:active={open && grouped} data-testid="project-{kind}-toggle" data-count={total}
      title={label} aria-label={label} aria-expanded={grouped || inBody ? open : undefined} aria-controls={grouped ? `${controls}-${kind}` : undefined} disabled={!inBody && (!grouped || (kind === 'working' && searching))}
      onclick={() => inBody ? entry.machine.store.toggleProject(entry.project.id) : projectThreadView.toggle(entry, kind, collapsed)}>
      {#if kind === 'working'}<LoaderCircle size={part === 'all' ? 13 : 12} class={part === 'all' ? undefined : 'spinner'} aria-hidden="true" />{:else if kind === 'done'}<CheckCheck size={part === 'all' ? 13 : 12} aria-hidden="true" />{:else}<Archive size={part === 'all' ? 13 : 12} aria-hidden="true" />{/if}
      <span class="ui-label">{formatCount(total)}</span>
    </button>
    {/if}
  {/each}
</div>

<style>
  .counters { display: flex; flex: none; align-items: center; gap: 6px; }
  .counter { font-variant-numeric: tabular-nums; }
  .counter:disabled { opacity: 1; }

  /* A phone's header: a pill per state that holds threads; nothing is drawn for a 0. */
  .all .counter { height: 28px; min-width: 0; padding: 0 10px 0 9px; gap: 5px; border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 600;
    color: var(--color-muted-foreground); background-color: var(--color-hover); border: 1px solid transparent; background-clip: padding-box; }
  .all .working:not(.away) { color: var(--color-foreground); }
  .all .done { color: var(--color-success); background-color: color-mix(in oklch, var(--color-success) 14%, transparent); }
  .all .counter.active { box-shadow: inset 0 0 0 1px currentColor; }
  /* Hover deepens the pill's own tint instead of the grey a ghost button takes. */
  .all .counter:hover:not(:disabled) { background-color: color-mix(in oklch, currentColor 24%, transparent); background-clip: padding-box; }
  .all .working:not(.away):hover:not(:disabled) { color: var(--color-foreground); }
  .all .done:hover:not(:disabled) { color: var(--color-success); }

  /* The desktop card: small tags with no fill, but the user's turn in its amber. */
  .head, .foot { gap: 2px; }
  .head .counter, .foot .counter { display: inline-flex; align-items: center; height: 20px; min-width: 0; padding: 0 6px; gap: 4px; border: none; border-radius: var(--radius-sm);
    background: transparent; color: var(--color-subtle); font-size: 11.5px; font-weight: 600; }
  .head .counter.waiting { color: var(--color-live); background: color-mix(in srgb, var(--color-live) 12%, transparent); }
  .head .working :global(.spinner) { color: var(--color-accent); animation: spin 1s steps(60) infinite var(--loops); }
  .head .working.away :global(.spinner) { color: inherit; animation: none; }
  .head .counter:hover:not(:disabled), .foot .counter:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }
  .head .counter.active, .foot .counter.active { background: var(--color-active); color: var(--color-foreground); }
  .foot .counter { font-weight: 500; }
  @media (prefers-reduced-motion: reduce) { .head .working :global(.spinner) { animation: none; } }
  :global(html[data-motion='reduced']) .head .working :global(.spinner) { animation: none; }

  /* A narrow column keeps the project's name readable: tighter pills. */
  @container sidebar (max-width: 300px) { .all { gap: 4px; } .all .counter { padding: 0 7px 0 6px; gap: 3px; } }
  /* A phone keeps the 44px target; the transparent border leaves a 32px pill drawn inside it. */
  @media (max-width: 720px) { .all { gap: 0; } .all .counter { min-width: var(--touch-target); min-height: var(--touch-target); padding: 0 8px; gap: 5px; border-width: 6px; } }
</style>
