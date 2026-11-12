<script lang="ts">
  import { CircleAlert } from '@lucide/svelte';
  import Notice from './Notice.svelte';
  import type { Component, ComponentProps } from 'svelte';
  import { strings } from '../lib/strings';
  import type WindowCaptureCard from './WindowCaptureCard.svelte';
  import type WindowConsentCard from './WindowConsentCard.svelte';

  /**
   * Window captures are rare: each card loads with the first of its parts,
   * outside the entry chunk. Until it does, the app's process stands in; a
   * chunk that fails to load (an update, a phone offline) offers another try.
   */
  let props: ComponentProps<typeof WindowCaptureCard> | ComponentProps<typeof WindowConsentCard> = $props();
  const load = () => props.part.type === 'window_capture' ? import('./WindowCaptureCard.svelte') : import('./WindowConsentCard.svelte');
  let loading = $state.raw(load());
</script>

{#await loading}
  <p class="hint" role="status" data-testid="window-card-loading">{props.part.process}</p>
{:then module}
  {@const Card = module.default as unknown as Component<typeof props>}
  <Card {...props} />
{:catch}
  <Notice icon={CircleAlert} tone="danger" testid="window-card-failed" detail={strings.parts.failed}>
    {#snippet actions()}<button type="button" class="small" onclick={() => (loading = load())}><span class="ui-label">{strings.common.refresh}</span></button>{/snippet}
  </Notice>
{/await}

<style>
  .hint { margin: 0; padding: var(--activity-padding); font-size: var(--text-sm); color: var(--color-muted-foreground); }
</style>
