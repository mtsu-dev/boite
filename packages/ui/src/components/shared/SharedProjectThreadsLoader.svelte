<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { contactsParts } from '../../lib/contacts-entry';
  import { sharedProjectThreads } from '../../lib/deferred-parts';
  import { strings } from '../../lib/strings';
  import Deferred from '../Deferred.svelte';
  import type SharedProjectThreads from './SharedProjectThreads.svelte';

  let { children: localThreads, ...props }: ComponentProps<typeof SharedProjectThreads> = $props();
</script>

{#if props.active && contactsParts}
  <Deferred part={sharedProjectThreads}>
    {#snippet pending()}{@render localThreads()}{/snippet}
    {#snippet failure(retry)}
      {@render localThreads()}
      <p role="alert">{strings.parts.failed} <button type="button" onclick={retry}>{strings.common.retry}</button></p>
    {/snippet}
    {#snippet children(SharedProjectThreads)}<SharedProjectThreads {...props} children={localThreads} />{/snippet}
  </Deferred>
{:else}
  {@render localThreads()}
{/if}
