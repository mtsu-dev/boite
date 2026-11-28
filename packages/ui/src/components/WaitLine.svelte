<script lang="ts">
  import type { ThreadWait } from '../lib/background';
  import { exactTime } from '../lib/format';
  import Elapsed from './Elapsed.svelte';

  let { wait, testid = 'thread-wait' }: { wait: ThreadWait; testid?: string } = $props();
</script>

<span class="wait-line" data-testid={testid} title={wait.since === null ? wait.label : `${wait.label}\n${exactTime(wait.since)}`}>
  <span class="label ui-label">{wait.label}</span>
  {#if wait.since !== null}<Elapsed startedAt={wait.since} finishedAt={null} active />{/if}
</span>

<style>
  .wait-line { display: inline-flex; align-items: baseline; gap: var(--space-1); flex: 0 1 auto; min-width: 0; max-width: 100%; padding-block: 0.3em; margin-block: -0.3em; overflow: hidden; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 400; }
  .label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wait-line :global(.elapsed) { flex: none; }
</style>
