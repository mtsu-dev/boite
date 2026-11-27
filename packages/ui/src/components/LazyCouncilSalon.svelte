<script lang="ts">
  // A council's salon in the panel, fetched with the first council tab (`lib/council-entry.ts`): a build without the Council fetches nothing and shows nothing.
  import type { Store } from '../lib/store.svelte';
  import { councilSalon as lazyCouncilSalon } from '../lib/chat-views';
  import Deferred from './Deferred.svelte';

  let { store, councilId, threadId }: { store: Store; councilId: string; threadId?: string } = $props();
</script>

<!-- One salon per debate: the tab moved to another debate starts its reading afresh. -->
<Deferred part={lazyCouncilSalon}>{#snippet children(Salon)}{#key councilId}<Salon {store} {councilId} {threadId} />{/key}{/snippet}</Deferred>
