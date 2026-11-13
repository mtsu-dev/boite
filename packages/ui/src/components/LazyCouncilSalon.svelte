<script lang="ts">
  // A council's salon in the panel, fetched with the first council tab (`lib/council-entry.ts`): a build without the Council fetches nothing and shows nothing.
  import type { Store } from '../lib/store.svelte';
  import { loadCouncilSalon } from '../lib/council-entry';

  let { store, councilId, threadId }: { store: Store; councilId: string; threadId?: string } = $props();
  let Salon = $state.raw<typeof import('./council/CouncilSalon.svelte').default>();
  let loading: Promise<void> | undefined;
  $effect(() => { if (!Salon) loading ??= loadCouncilSalon()?.then(module => { Salon = module.default; }).catch(() => { loading = undefined; }); });
</script>

<!-- One salon per debate: the tab moved to another debate starts its reading afresh. -->
{#if Salon}{#key councilId}<Salon {store} {councilId} {threadId} />{/key}{/if}
