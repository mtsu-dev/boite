<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';
  import DoneRetentionSetting from './DoneRetentionSetting.svelte';
  import DeletedThreads from './DeletedThreads.svelte';
  import InfoTip from './InfoTip.svelte';
  import { lifecycleFilter } from '../lib/lifecycle-filter.svelte';
  import { archiveCount } from '../lib/project-threads.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * Archived threads live in the thread list, under its Archived filter, with
   * every action a row has there. Settings keeps how long done threads stay,
   * the deleted ones, and one line that leads to the filter. `store` is the
   * machine whose settings these are; `here`, this window's, leaves Settings
   * for the list. `onopenlist` shows a phone's list, which Settings covers.
   */
  let { store, here = store, eager = false, onopenlist }: { store: Store; here?: Store; eager?: boolean; onopenlist?: () => void } = $props();

  let count = $derived(store.projects.reduce((sum, project) => sum + archiveCount(project, 'archived'), 0));

  function open(): void {
    lifecycleFilter.show('archived');
    here.showChat();
    onopenlist?.();
  }
</script>

<section class="card" id="settings-archived" data-testid="archived-threads">
  <h2 class="ui-label-box"><span class="ui-label">{strings.settings.archived.heading}</span><InfoTip topic={strings.settings.archived.heading} text={strings.settings.archived.intro} /></h2>
  <DoneRetentionSetting {store} />
  <div class="switch-row">
    <span class="text"><span data-testid="archived-count">{count === 0 ? strings.settings.archived.none : fill(strings.settings.archived.inList, { count: String(count) })}</span></span>
    <button type="button" data-testid="archived-show-list" onclick={open}>
      <span class="ui-label">{strings.settings.archived.openList}</span><ArrowRight size={14} strokeWidth={1.75} />
    </button>
  </div>
</section>

<DeletedThreads {store} {eager} />

<style>
  button { gap: 6px; flex: none; }
</style>
