<script lang="ts">
  import type { Snippet } from 'svelte';
  import InfoTip from './InfoTip.svelte';

  let { title, info, id, testid, actions, children }: {
    title: string;
    info?: string;
    id?: string;
    testid?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="card" {id} data-testid={testid}>
  <h2 class="ui-label-box">
    <span class="ui-label">{title}</span>
    {#if info}<InfoTip topic={title} text={info} />{/if}
    {@render actions?.()}
  </h2>
  {@render children()}
</section>
