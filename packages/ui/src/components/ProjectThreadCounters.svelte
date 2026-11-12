<script lang="ts">
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { projectThreadView } from '../lib/project-threads.svelte';
  import { count as formatCount, projectName } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import { recentPreferences } from '../lib/recent.svelte';
  import FailMark from './FailMark.svelte';

  /**
   * A project card's one count: the threads that need the user (`waiting`), on every device, wearing the mark of
   * what they are: the rows' amber dot while one waits on the user's turn (it ranks first), the failure's disc and
   * colour when all of them failed (`failed`: how many of `waiting` are failures). The tooltip names both counts. Each of those rows says "Needs you" itself, so the head says it only while one of them is out of
   * sight (`listed`: how many the card shows as rows; a folded card shows none), or while a list too narrow for the
   * rows' words leaves them their dot alone (ThreadState.svelte `fit`). The tooltip and the accessible name always
   * say it. The working count stands only where no row says it:
   * a folded card, or the fold of working threads (the display menu's grouping), whose toggle it is, so there it
   * stays beside Needs you. The archived ones live in the card's menu (lib/project-menu.ts).
   * `away`: the machine is not connected; its last known counts stay, the working one without its live colour, the
   * one that asks as Activity and the rail's badge count it.
   * The amber count stands alone in the header: with threads that need the user, the working fold's toggle moves
   * into the card, over the fold it opens (`place="fold"`, a row of its own with the same test id).
   */
  let { entry, working, controls, collapsed = false, searching = false, away = false, waiting = 0, failed = 0, listed = 0, place = 'head' }: {
    entry: ProjectEntry; working: number; controls: string; collapsed?: boolean; searching?: boolean; away?: boolean; waiting?: number; failed?: number; listed?: number; place?: 'head' | 'fold';
  } = $props();
  const grouped = $derived(recentPreferences.groupWorking);
  const open = $derived(!collapsed && !searching && projectThreadView.isOpen(entry, 'working'));
  const failOnly = $derived(failed > 0 && failed >= waiting);
  const waitingLabel = $derived(
    failOnly ? fill(strings.sidebar.projectFailedThreads, { count: String(waiting), project: projectName(entry.project) })
    : failed > 0 ? fill(strings.sidebar.projectMixedThreads, { waiting: String(waiting - failed), failed: String(failed), project: projectName(entry.project) })
    : fill(strings.sidebar.projectWaitingThreads, { count: String(waiting), project: projectName(entry.project) }));
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
    <span class="counter waiting" class:failed={failOnly} data-testid="project-waiting-count" data-count={waiting} data-state={failOnly ? 'error' : 'waiting'} role="img" title={waitingLabel} aria-label={waitingLabel}><span class="mark-word">{#if failOnly}<FailMark />{:else}<span class="dot" aria-hidden="true"></span>{/if}<span class="ui-label word" class:spare={!collapsed && listed >= waiting}>{failOnly ? strings.sidebar.state.error : strings.sidebar.state.waiting}</span></span><span class="ui-label number">{formatCount(waiting)}</span></span>
  {/if}
  {#if working > 0 && waiting === 0 && (grouped || collapsed)}
    <button type="button" class="ghost counter working" class:away class:active={open && grouped} data-testid="project-working-toggle" data-count={working}
      title={workingLabel} aria-label={workingLabel} aria-expanded={grouped ? open : undefined} aria-controls={grouped ? `${controls}-working` : undefined} disabled={!grouped || searching}
      onclick={() => projectThreadView.toggle(entry, 'working', collapsed)}>
      <span class="work-ring" aria-hidden="true"></span><span class="ui-label word">{strings.sidebar.workingThreads}</span><span class="ui-label">{formatCount(working)}</span>
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
  .waiting.failed .number { color: var(--color-danger); }
  /* The word beside the mark the rows wear, so the dot is learned where it is first named. */
  .dot { width: 8px; height: 8px; flex: none; border-radius: var(--radius-full); background: var(--color-live); }
  .counter .word { margin-right: 2px; }
  /* Said by every row that needs the user, so not here, unless the rows drop their word: a row's word gives way under
     a 200 px row in English, 220 px in French (ThreadState.svelte), a 236 or 256 px list, its 36 px of edges around
     the row's text. */
  /* The word gives way whole, never cut, when the head it sits in lets the count shrink (Sidebar.svelte: the project
     name keeps priority). The mark and the word share one wrapping line, its end against the number: short of room,
     the word wraps under a zero-width strut, out of sight, and the mark stays beside the number. */
  .waiting { display: inline-grid; grid-template-columns: auto auto; gap: 0; }
  .mark-word { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; min-width: 12px; height: 22px; overflow: hidden; }
  .mark-word::before { content: ''; width: 0; height: 22px; }
  .waiting .word { margin: 0 2px 0 4px; }
  .waiting .number { margin-left: 4px; }
  .spare { display: none; }
  @container sidebar (max-width: 235.98px) {
    .counter .spare { display: block; }
  }
  @container sidebar (max-width: 255.98px) {
    :global(html:lang(fr)) .counter .spare { display: block; }
  }
  /* Work, still: the rows' accent arc (ThreadState.svelte). The open thread keeps the one live spinner. */
  .work-ring { box-sizing: border-box; width: 9px; height: 9px; border: 1.5px solid var(--color-accent); border-top-color: transparent; border-radius: var(--radius-full); transform: rotate(45deg); }
  /* Offline: the last known count, not live work, so its ring takes the header's grey. */
  .away .work-ring { border-color: var(--color-muted-foreground); border-top-color: transparent; }
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
