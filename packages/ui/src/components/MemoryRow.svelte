<script lang="ts">
  import type { MemoryEvent } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import { bytes } from '../lib/format';
  import { TriangleAlert } from '@lucide/svelte';
  import ThreadNotice from './ThreadNotice.svelte';

  /**
   * A memory stop or limit as one line of the thread: what was stopped, how
   * much, and the way to the memory settings. The reason and every stopped
   * process sit behind the "i".
   */
  let { event, events = [event], onconfigure }: { event: MemoryEvent; events?: MemoryEvent[]; onconfigure?: () => void } = $props();
  function describeNotice(notice: MemoryEvent): string {
    if (notice.kind === 'killed') return strings.resources.killReason[notice.reason](bytes(notice.limitBytes));
    if (notice.kind === 'throttled') return strings.resources.throttled(bytes(notice.limitBytes));
    if (notice.kind === 'thread-cap') return strings.resources.threadCap;
    if (notice.kind === 'budget') return strings.resources.budget;
    return strings.resources.states[notice.state];
  }
  const processOf = (stopped: MemoryEvent) => stopped.exe?.split(/[\\/]/).pop() ?? null;
  const reason = $derived(describeNotice(event));
  const killed = $derived(event.kind === 'killed');
  const name = $derived(processOf(event));
  const title = $derived(!killed ? undefined : events.length > 1 ? strings.resources.killCount(events.length) : name ? strings.resources.killedOne(name) : strings.resources.killTitle);
  const size = $derived(killed && events.length === 1 && event.bytes !== undefined ? bytes(event.bytes) : undefined);
  /** Several stops list each process and its size after the reason. */
  const info = $derived(!killed ? undefined : events.length === 1 ? reason
    : `${reason} ${events.map((stopped) => `${processOf(stopped) ?? strings.resources.unknown}${stopped.bytes !== undefined ? ` (${bytes(stopped.bytes)})` : ''}`).join(', ')}`);
</script>

{#snippet configure()}<button type="button" class="small configure" onclick={onconfigure}><span class="ui-label">{strings.resources.memorySettings}</span></button>{/snippet}
<ThreadNotice icon={TriangleAlert} testid="memory-row" kind={event.kind} {title} detail={killed ? size : reason} {info} actions={onconfigure ? configure : undefined} />
