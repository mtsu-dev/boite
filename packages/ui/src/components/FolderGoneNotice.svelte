<script lang="ts">
  import { FolderX } from '@lucide/svelte';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { confirmRemoveProject } from '../lib/project-menu';
  import { fill, strings } from '../lib/strings';
  import NoticeBanner from './NoticeBanner.svelte';

  /*
   * Above the composer of a project whose folder was deleted, moved or renamed
   * outside Boite. The core refuses a new thread or a turn there; this says so
   * before the send, and offers the two ways out as buttons a phone can reach.
   */
  let { store, project }: { store: Store; project: Project } = $props();
  let checking = $state(false);

  async function check() {
    checking = true;
    try { await store.refreshProjects(); } finally { checking = false; }
  }
</script>

<NoticeBanner icon={FolderX} tone="danger" testid="folder-gone" title={strings.sidebar.projectMissing} text={fill(strings.sidebar.projectMissingBody, { path: project.path })}>
  {#snippet actions()}
    <button type="button" class="ghost small" data-testid="folder-gone-check" disabled={checking} onclick={check}><span class="ui-label">{strings.sidebar.projectMissingCheck}</span></button>
    {#if store.owner}<button type="button" class="ghost small danger" data-testid="folder-gone-remove" onclick={() => confirmRemoveProject(store, project)}><span class="ui-label">{strings.sidebar.removeProject}</span></button>{/if}
  {/snippet}
</NoticeBanner>
