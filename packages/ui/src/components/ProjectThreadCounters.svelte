<script lang="ts">
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { projectThreadView } from '../lib/project-threads.svelte';
  import { count as formatCount, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { recentPreferences } from '../lib/recent.svelte';

  /**
   * A project card's one count: the threads that need the user (`waiting`), "Needs you" and its amber number on
   * every device (round 17: a bare number said nothing on the desktop). The working count stands only where no row says it:
   * a folded card, or the fold of working threads (the display menu's grouping), whose toggle it is, so there it
   * stays beside Needs you. The archived ones live in the card's menu (lib/project-menu.ts).
   * `away`: the machine is not connected; its last known working count stays, the counts that ask are not drawn.
   * The amber count stands alone in the header: with threads that need the user, the working fold's toggle moves
   * into the card, over the fold it opens (`place="fold"`, a row of its own with the same test id).
   */
  let { entry, working, controls, collapsed = false, searching = false, away = false, waiting = 0, place = 'head' }: {
    entry: ProjectEntry; working: number; controls: string; collapsed?: boolean; searching?: boolean; away?: boolean; waiting?: number; place?: 'head' | 'fold';
  } = $props();
  const grouped = $derived(recentPreferences.groupWorking);
  const open = $derived(!collapsed && !searching && projectThreadView.isOpen(entry, 'working'));
  const waitingLabel = $derived(fill(strings.sidebar.projectWaitingThreads, { count: String(waiting), project: projectName(entry.project) }));
  const workingLabel = $derived(fill(strings.sidebar.projectWorkingThreads, { count: String(working), project: projectName(entry.project) }));
</script>

{#if place === 'fold'}
  {#if working > 0 && grouped && waiting > 0 && !collapsed}
    <button type="button" class="ghost fold-toggle" class:away class:active={open} data-testid="project-working-toggle" data-count={working}
      title={workingLabel} aria-label={workingLabel} aria-expanded={open} aria-controls="{controls}-working" disabled={searching}
      onclick={() => projectThreadView.toggle(entry, 'working', collapsed)}>
      <span class="work-ring" aria-hidden="true"></span><span class="ui-label">{strings.sidebar.workingThreads}</span><span class="ui-label count">{formatCount(working)}</span>
    </button>
  {/if}
{:else}<div class="counters">
  {#if waiting > 0}
    <span class="counter waiting" data-testid="project-waiting-count" data-count={waiting} role="img" title={waitingLabel} aria-label={waitingLabel}><span class="ui-label word">{strings.sidebar.state.waiting}</span><span class="ui-label number">{formatCount(waiting)}</span></span>
  {/if}
  {#if working > 0 && waiting === 0 && (grouped || collapsed)}
    <button type="button" class="ghost counter working" class:away class:active={open && grouped} data-testid="project-working-toggle" data-count={working}
      title={workingLabel} aria-label={workingLabel} aria-expanded={grouped ? open : undefined} aria-controls={grouped ? `${controls}-working` : undefined} disabled={!grouped || searching}
      onclick={() => projectThreadView.toggle(entry, 'working', collapsed)}>
      <span class="work-ring" aria-hidden="true"></span><span class="ui-label">{formatCount(working)}</span>
    </button>
  {/if}
</div>{/if}

<style>
  .counters { display: flex; flex: none; align-items: center; gap: 2px; }
  /* The card's tag: a count, the details in the tooltip. The user's turn takes the rows' amber, the one mark of
     what needs the user, its word before it in the header's grey. A label, so regular weight; the count a step up. */
  .counter { display: inline-flex; align-items: center; height: 22px; min-width: 0; padding: 0 6px; gap: 4px; border: none; border-radius: var(--radius-sm);
    background: transparent; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 400; font-variant-numeric: tabular-nums; }
  .counter:disabled { opacity: 1; }
  .waiting .number { color: var(--color-live); font-weight: var(--weight-title); }
  /* Work, still: the rows' accent arc (ThreadState.svelte). The open thread keeps the one live spinner. */
  .work-ring { box-sizing: border-box; width: 9px; height: 9px; border: 1.5px solid var(--color-accent); border-top-color: transparent; border-radius: var(--radius-full); transform: rotate(45deg); }
  .counter:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }
  .counter.active { background: var(--color-active); color: var(--color-foreground); }
  /* The working fold's toggle inside the card, a quiet row over the fold, as the group labels read. */
  .fold-toggle { display: flex; align-items: center; gap: 6px; width: 100%; height: 28px; padding: 0 10px; justify-content: flex-start; border-radius: var(--radius-sm);
    color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 500; }
  .fold-toggle .count { margin-left: auto; font-variant-numeric: tabular-nums; }
  .fold-toggle:hover:not(:disabled), .fold-toggle.active { color: var(--color-foreground); }

  /* A phone: the tag a 32px target of its own, and a finger's 44px around it. */
  @media (max-width: 720px) {
    .counter { height: 32px; min-width: 32px; justify-content: center; font-size: var(--text-sm); }
    .fold-toggle { height: var(--touch-target); padding: 0 12px; border-radius: 0; font-size: var(--text-sm); }
    button.counter { position: relative; }
    button.counter::after { content: ''; position: absolute; inset: -6px -2px; }
  }
</style>
