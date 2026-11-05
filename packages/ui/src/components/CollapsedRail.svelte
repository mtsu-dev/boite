<script lang="ts">
  import { PanelLeftOpen, SquarePen } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { projectName } from '../lib/format';
  import { projectKey, type ProjectEntry } from '../lib/project-view.svelte';
  import { inLifecycle } from '../lib/lifecycle-filter.svelte';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { openResident } from '../lib/resident';
  import AgentAvatar from './agents/AgentAvatar.svelte';
  import ProjectTile from './ProjectTile.svelte';

  /**
   * The sidebar folded to 48 px instead of gone: a new thread on top, one
   * tile per project with an amber dot when something there needs the user,
   * the bots under a hairline, and the way back to the full list. A tile
   * unfolds the list on its project.
   */
  let { store, entries, onproject }: {
    store: Store;
    entries: readonly ProjectEntry[];
    onproject: (entry: ProjectEntry) => void;
  } = $props();

  /** The Needs you rule of the strip, per project; a machine away counts nothing. */
  const needs = (entry: ProjectEntry) => entry.machine.store.connection !== 'ready' ? 0
    : entry.machine.store.threadsOf(entry.project.id).filter(thread => inLifecycle(entry, thread, 'waiting')).length;
  let bots = $derived(experimentOn('resident-agents') ? agentDirectory(store).agents : []);
</script>

<nav class="collapsed-rail" aria-label={strings.sidebar.railLabel} data-testid="sidebar-rail">
  <button type="button" class="ghost icon" title={strings.sidebar.newThread} aria-label={strings.sidebar.newThread}
    data-testid="rail-new-thread" onclick={() => store.startDraft(undefined, { fresh: true })}><SquarePen size={17} /></button>
  <div class="tiles">
    {#each entries as entry (projectKey(entry))}
      {@const count = needs(entry)}
      {@const name = projectName(entry.project)}
      {@const label = count === 0 ? fill(strings.sidebar.railProject, { project: name }) : fill(count === 1 ? strings.sidebar.railNeedsOne : strings.sidebar.railNeedsMany, { project: name, count: String(count) })}
      <button type="button" class="ghost tile" title={label} aria-label={label} data-testid="rail-project" data-project-key={projectKey(entry)} data-needs={count}
        onclick={() => onproject(entry)}>
        <ProjectTile project={entry.project} store={entry.machine.store} size={28} />
        {#if count > 0}<span class="needs" aria-hidden="true"></span>{/if}
      </button>
    {/each}
    {#if bots.length}
      <hr />
      {#each bots as bot (bot.id)}
        <button type="button" class="ghost tile" title={bot.name} aria-label={bot.name} data-testid="rail-bot" onclick={() => openResident(store, bot.id)}>
          <AgentAvatar kind="profile" id={bot.id} name={bot.name} avatar={bot.avatar} size={24} />
        </button>
      {/each}
    {/if}
  </div>
  <button type="button" class="ghost icon" title={strings.sidebar.expand} aria-label={strings.sidebar.expand}
    data-testid="rail-expand" onclick={() => store.toggleSidebar()}><PanelLeftOpen size={17} /></button>
</nav>

<style>
  .collapsed-rail {
    display: none;
  }
  @media (min-width: 721px) {
    .collapsed-rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      flex: none;
      width: 48px;
      min-height: 0;
      margin-left: calc(-1 * var(--frame-gap));
      padding: 4px 0 var(--frame-gap);
      box-sizing: border-box;
    }
  }
  .tiles {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .icon, .tile { width: 36px; height: 36px; flex: none; padding: 0; display: grid; place-items: center; }
  .tile { position: relative; border-radius: var(--radius-md); }
  /* The Needs you colour, the only amber on the rail: something there waits on the user. */
  .needs {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-live);
    box-shadow: 0 0 0 2px var(--color-frame);
  }
  hr {
    width: 24px;
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--color-border);
  }
</style>
