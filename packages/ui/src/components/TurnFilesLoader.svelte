<script lang="ts">
  import { errorText } from '../lib/errors';
  import type { ComponentProps } from 'svelte';
  import type TurnFiles from './TurnFiles.svelte';
  import { strings } from '../lib/strings';

  let { between, after, ...rest }: ComponentProps<typeof TurnFiles> = $props();
  let loading = $state.raw(import('./TurnFiles.svelte'));
  let beforeAnchor = $state<HTMLElement | undefined>(undefined);
  let afterAnchor = $state<HTMLElement | undefined>(undefined);
</script>

{#if between}<span hidden bind:this={beforeAnchor}></span>{@render between()}{/if}
{#if after}<span hidden bind:this={afterAnchor}></span>{@render after()}{/if}
{#await loading then module}
  <module.default {...rest} {beforeAnchor} {afterAnchor} />
{:catch reason}
  <p role="alert">{errorText(reason)}</p>
  <button class="ghost small" onclick={() => loading = import('./TurnFiles.svelte')}>{strings.common.refresh}</button>
{/await}
