<script lang="ts">
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { projectThreadView } from '../lib/project-threads.svelte';
  import { count as formatCount, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { recentPreferences } from '../lib/recent.svelte';

  /**
   * A project card's one count, on the desktop as on a phone: the threads that need the user (`waiting`) when any,
   * else the working ones. The rows under it say the rest; the archived ones live in the card's menu
   * (lib/project-menu.ts). While working threads fold under the count (the display menu's grouping), the working
   * count is that fold's toggle, so it stays beside Needs you.
   * `away`: the machine is not connected; its last known working count stays, the counts that ask are not drawn.
   */
  let { entry, working, controls, collapsed = false, searching = false, away = false, waiting = 0 }: {
    entry: ProjectEntry; working: number; controls: string; collapsed?: boolean; searching?: boolean; away?: boolean; waiting?: number;
  } = $props();
  const grouped = $derived(recentPreferences.groupWorking);
  const open = $derived(!collapsed && !searching && projectThreadView.isOpen(entry, 'working'));
  const waitingLabel = $derived(fill(strings.sidebar.projectWaitingThreads, { count: String(waiting), project: projectName(entry.project) }));
  const workingLabel = $derived(fill(strings.sidebar.projectWorkingThreads, { count: String(working), project: projectName(entry.project) }));
</script>

<div class="counters">
  {#if waiting > 0}
    <span class="counter waiting" data-testid="project-waiting-count" data-count={waiting} role="img" title={waitingLabel} aria-label={waitingLabel}><span class="ui-label word">{strings.sidebar.state.waiting}</span><span class="ui-label number">{formatCount(waiting)}</span></span>
  {/if}
  {#if working > 0 && (waiting === 0 || grouped)}
    <button type="button" class="ghost counter working" class:away class:active={open && grouped} data-testid="project-working-toggle" data-count={working}
      title={workingLabel} aria-label={workingLabel} aria-expanded={grouped ? open : undefined} aria-controls={grouped ? `${controls}-working` : undefined} disabled={!grouped || searching}
      onclick={() => projectThreadView.toggle(entry, 'working', collapsed)}>
      <span class="work-ring" aria-hidden="true"></span><span class="ui-label">{formatCount(working)}</span>
    </button>
  {/if}
</div>

<style>
  .counters { display: flex; flex: none; align-items: center; gap: 2px; }
  /* The card's tag: a mark or a word, then its count, the details in the tooltip. The user's turn keeps its word,
     grey like the others; its count takes the rows' amber, the one mark of what needs the user. */
  .counter { display: inline-flex; align-items: center; height: 22px; min-width: 0; padding: 0 6px; gap: 4px; border: none; border-radius: var(--radius-sm);
    background: transparent; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
  .counter:disabled { opacity: 1; }
  .waiting .number { color: var(--color-live); }
  /* Work, still: the rows' grey ring. The open thread keeps the one live spinner. */
  .work-ring { box-sizing: border-box; width: 8px; height: 8px; border: 1.5px solid currentColor; border-radius: var(--radius-full); }
  .counter:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }
  .counter.active { background: var(--color-active); color: var(--color-foreground); }

  /* A phone: the tag a 32px target of its own, and a finger's 44px around it. */
  @media (max-width: 720px) {
    .counter { height: 32px; min-width: 32px; justify-content: center; font-size: var(--text-sm); }
    button.counter { position: relative; }
    button.counter::after { content: ''; position: absolute; inset: -6px -2px; }
  }
</style>
