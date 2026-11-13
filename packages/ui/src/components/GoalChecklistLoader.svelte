<script lang="ts">
  import { CircleAlert } from '@lucide/svelte';
  import Notice from './Notice.svelte';
  import type { ComponentProps } from 'svelte';
  import { strings } from '../lib/strings';
  import type GoalChecklist from './GoalChecklist.svelte';

  /**
   * Only a `/goal2` has a checklist: the list loads the first time one is
   * opened, outside the entry chunk. A chunk that
   * fails to load (an update, a phone offline) offers another try.
   */
  let props: ComponentProps<typeof GoalChecklist> = $props();
  let loading = $state.raw(import('./GoalChecklist.svelte'));
</script>

{#await loading then module}
  <module.default {...props} />
{:catch}
  <Notice icon={CircleAlert} tone="danger" testid="goal-checklist-failed" detail={strings.activity.checklistLoadFailed}>
    {#snippet actions()}<button type="button" class="small" onclick={() => (loading = import('./GoalChecklist.svelte'))}><span class="ui-label">{strings.common.refresh}</span></button>{/snippet}
  </Notice>
{/await}

