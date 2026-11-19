<script lang="ts">
  import type { Snippet } from 'svelte';
  import InfoTip from './InfoTip.svelte';

  let { title, info, infoTestid, id, testid, class: extraClass = '', actions, children }: {
    title?: string;
    info?: string;
    infoTestid?: string;
    id?: string;
    testid?: string;
    class?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
  const headingId = $props.id();
</script>

<section class="card {extraClass}" {id} data-testid={testid} aria-labelledby={title ? headingId : undefined}>
  {#if title}
    <h2 class="ui-label-box" id={headingId}>
      <span class="ui-label">{title}</span>
      {#if info !== undefined}<InfoTip topic={title} text={info} testid={infoTestid} />{/if}
      {@render actions?.()}
    </h2>
  {/if}
  {@render children()}
</section>
