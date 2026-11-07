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
   * `part`: a project's card, on the desktop as on a phone, splits them. Its header keeps what matters now, the
   * threads that need the user (`waiting`) and the working ones; its foot keeps Done and Archived.
   */
  let { entry, working, controls, collapsed = false, searching = false, away = false, body = [], part, waiting = 0 }: {
    entry: ProjectEntry; working: number; controls: string; collapsed?: boolean; searching?: boolean; away?: boolean; body?: readonly ProjectThreadKind[];
    part: 'head' | 'foot'; waiting?: number;
  } = $props();
  const kinds = $derived(part === 'head' ? ['working'] as const : ['done', 'archived'] as const);
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
      {#if kind === 'working'}<LoaderCircle size={12} class="spinner" aria-hidden="true" />{:else if kind === 'done'}<CheckCheck size={12} aria-hidden="true" />{:else}<Archive size={12} aria-hidden="true" />{/if}
      <span class="ui-label">{formatCount(total)}</span>
    </button>
    {/if}
  {/each}
</div>

<style>
  .counters { display: flex; flex: none; align-items: center; gap: 6px; }
  .counter { font-variant-numeric: tabular-nums; }
  .counter:disabled { opacity: 1; }

  /* The card's small tags with no fill, but the user's turn in its amber. */
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

  /* A phone keeps the small tag and reaches a finger's 44px around it. */
  @media (max-width: 720px) { button.counter { position: relative; } button.counter::after { content: ''; position: absolute; inset: -12px -2px; } }
</style>
