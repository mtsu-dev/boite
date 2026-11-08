<script lang="ts">
  import type { MemoryEvent } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import { bytes } from '../lib/format';
  import { Settings, TriangleAlert, X } from '@lucide/svelte';
  import ThreadNotice from './ThreadNotice.svelte';

  /**
   * A memory stop or limit as one line of the thread: what was stopped, how
   * much, and the way to the memory settings. The reason and every stopped
   * process sit behind the "i". In the notification corner (MemoryCorner) it
   * also puts itself away.
   */
  let { event, events = [event], onconfigure, ondismiss }: { event: MemoryEvent; events?: MemoryEvent[]; onconfigure?: () => void; ondismiss?: () => void } = $props();
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
  /** A plain first line says what happened to the user's work; the process and its size follow, quieter. */
  const title = $derived(!killed ? undefined : events.length > 1 ? strings.resources.killCount(events.length) : strings.resources.killTitle);
  /** One stop names its process and size; several keep their list behind the "i". */
  const detail = $derived(!killed ? reason : events.length > 1 ? undefined
    : [processOf(event), event.bytes !== undefined ? bytes(event.bytes) : null].filter(Boolean).join(', ') || undefined);
  /** Several stops list each process and its size after the reason. */
  const info = $derived(!killed ? undefined : events.length === 1 ? reason
    : `${reason} ${events.map((stopped) => `${processOf(stopped) ?? strings.resources.unknown}${stopped.bytes !== undefined ? ` (${bytes(stopped.bytes)})` : ''}`).join(', ')}`);
</script>

{#snippet actions()}
  <!-- The corner card stays two lines high, so it covers as little of the thread as it can: its way to the settings is an icon. -->
  {#if onconfigure && ondismiss}<button type="button" class="ghost small icon configure" title={strings.resources.memorySettings} aria-label={strings.resources.memorySettings} onclick={onconfigure}><Settings size={14} /></button>
  {:else if onconfigure}<button type="button" class="small configure" onclick={onconfigure}><span class="ui-label">{strings.resources.memorySettings}</span></button>{/if}
  {#if ondismiss}<button type="button" class="ghost small icon" data-testid="memory-row-dismiss" title={strings.common.dismiss} aria-label={strings.common.dismiss} onclick={ondismiss}><X size={14} /></button>{/if}
{/snippet}
<ThreadNotice icon={TriangleAlert} testid="memory-row" kind={event.kind} {title} {detail} {info} actions={onconfigure || ondismiss ? actions : undefined} />
