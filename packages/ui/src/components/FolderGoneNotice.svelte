<script lang="ts">
  import { FolderX } from '@lucide/svelte';
  import type { Project } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import Notice from './Notice.svelte';

  /*
   * In the composer's place on a project whose folder was deleted, moved or
   * renamed outside Boite: the core refuses a new thread or a turn there. One
   * line and one way out, checking again once the folder is back; the path
   * sits behind the "i", and removing the project stays in its menu.
   */
  /** `replaces`: drawn in the composer's slot; a done thread shows it above its done notice. */
  let { store, project, replaces = true }: { store: Store; project: Project; replaces?: boolean } = $props();
  let checking = $state(false);

  async function check() {
    checking = true;
    try { await store.refreshProjects(); } finally { checking = false; }
  }
</script>

<Notice icon={FolderX} tone="danger" testid="folder-gone" title={strings.sidebar.projectMissing}
  info={fill(strings.sidebar.projectMissingBody, { path: project.path })} docked {replaces}>
  {#snippet actions()}
    <button type="button" class="small primary" data-testid="folder-gone-check" disabled={checking} onclick={check}><span class="ui-label">{strings.sidebar.projectMissingCheck}</span></button>
  {/snippet}
</Notice>
