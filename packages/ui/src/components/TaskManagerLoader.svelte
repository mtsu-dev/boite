<script lang="ts">
  import { CircleAlert } from '@lucide/svelte';
  import Notice from './Notice.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  let { store, onopenthread, section }: { store: Store; onopenthread?: () => void; section?: boolean } = $props();
  let loading = $state.raw(import('./TaskManager.svelte'));
</script>

{#await loading}
  <p class="hint" role="status">{strings.taskManager.loading}</p>
{:then module}
  <module.default {store} {onopenthread} {section} showTitle={section === true} />
{:catch}
  <Notice icon={CircleAlert} tone="danger" detail={strings.taskManager.loadFailed}>
    {#snippet actions()}<button type="button" class="small" onclick={() => loading = import('./TaskManager.svelte')}><span class="ui-label">{strings.common.refresh}</span></button>{/snippet}
  </Notice>
{/await}
