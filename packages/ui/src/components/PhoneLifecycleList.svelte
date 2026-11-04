<script lang="ts" generics="Row extends { machine: Machine; thread: ThreadSummary; project: Project | undefined }">
  import type { Snippet } from 'svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import { projectKey, type ProjectEntry } from '../lib/project-view.svelte';
  import { lifecycleFilter, lifecycleProjects, type Lifecycle } from '../lib/lifecycle-filter.svelte';
  import { compareThreads } from '../lib/thread-order';
  import { projectName } from '../lib/format';
  import { strings } from '../lib/strings';
  import ProjectTile from './ProjectTile.svelte';
  import RecentDone from './RecentDone.svelte';
  import WindowList from './WindowList.svelte';

  /**
   * The phone's list filtered to one lifecycle, as the desktop sidebar draws
   * it: every project that holds such a thread keeps its header, then its rows.
   * Done and archived list the project's fold in place. `row` is the list's own
   * row, so a filtered row opens, swipes and long-presses as any other.
   */
  let { entries, kind, now, scrollRoot, several = false, row: drawRow, onopen }: {
    entries: readonly ProjectEntry[];
    kind: Lifecycle;
    now: number;
    scrollRoot?: HTMLElement;
    several?: boolean;
    row: Snippet<[Row, boolean]>;
    onopen: () => void;
  } = $props();
  let projects = $derived(lifecycleProjects(entries, kind).map(({ entry, threads }) => ({
    entry,
    rows: threads.slice().sort(compareThreads).map(thread => ({ machine: entry.machine, thread, project: entry.project }) as Row)
  })));
</script>

{#each projects as { entry, rows } (projectKey(entry))}
  <section class="filtered" data-testid="mobile-project-group" data-filter={kind} data-project-id={entry.project.id} data-machine-id={entry.machine.id}>
    <div class="heading">
      <ProjectTile project={entry.project} store={entry.machine.store} /><h2>{projectName(entry.project)}{#if several}<span>{entry.machine.label}</span>{/if}</h2>
    </div>
    {#if kind === 'done' || kind === 'archived'}
      <RecentDone {kind} entries={[entry]} {scrollRoot} {now} open header={false} {onopen} />
    {:else}
      <WindowList items={rows} keyOf={item => JSON.stringify([item.machine.id, item.thread.id])} {scrollRoot} estimate={77}>
        {#snippet row(item)}{@render drawRow(item, true)}{/snippet}
      </WindowList>
    {/if}
  </section>
{:else}
  <p class="none" data-testid="mobile-lifecycle-empty">{strings.sidebar.lifecycle.none}</p>
{/each}
<!-- Keeps the filter's way out in reach at the list's end too. -->
{#if projects.length > 0}<button type="button" class="ghost clear" data-testid="mobile-lifecycle-clear" onclick={() => lifecycleFilter.clear()}>{strings.sidebar.lifecycle.showAll}</button>{/if}

<style>
  .filtered {
    --row-ground: var(--color-surface);
    --ring-ground: var(--color-surface);
    margin-bottom: 12px;
    /* clip, not hidden: hidden would make the card a scroll box and stop its header sticking. */
    overflow: clip;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  .heading {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch-target);
    padding: 6px 12px;
    color: var(--color-muted-foreground);
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-border);
  }
  .heading h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  .heading span { display: block; font-size: var(--text-xs); font-weight: 400; }
  .none { margin: 24px 12px; text-align: center; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .clear { display: flex; width: 100%; min-height: var(--touch-target); justify-content: center; align-items: center; font-size: var(--text-sm); color: var(--color-accent); }
</style>
