<script lang="ts">
  import type { ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { trackThreadPullRequest } from '../lib/thread-pull-request.svelte';

  /**
   * Draws nothing: follows the open thread's pull request for a parent whose
   * thread can be absent (the header), the way a row follows its own.
   */
  let { owner, thread, value = $bindable(null) }: {
    owner: Store;
    thread: ThreadSummary;
    value?: NonNullable<ThreadSummary['pullRequest']> | null;
  } = $props();
  const pr = trackThreadPullRequest(() => ({ owner, thread }));
  $effect(() => { value = pr.value ?? null; });
</script>
