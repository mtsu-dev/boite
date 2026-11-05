<script lang="ts">
  import type { MemoryEvent } from '@boite/contracts';
  import { strings } from '../lib/strings';
  import { bytes } from '../lib/format';
  import { Settings2, TriangleAlert } from '@lucide/svelte';
  import NoticeBanner from './NoticeBanner.svelte';

  let { event, events = [event], onconfigure }: { event: MemoryEvent; events?: MemoryEvent[]; onconfigure?: () => void } = $props();
  function describeNotice(notice: MemoryEvent): string {
    if (notice.kind === 'killed') return strings.resources.killReason[notice.reason](bytes(notice.limitBytes));
    if (notice.kind === 'throttled') return strings.resources.throttled(bytes(notice.limitBytes));
    if (notice.kind === 'thread-cap') return strings.resources.threadCap;
    if (notice.kind === 'budget') return strings.resources.budget;
    return strings.resources.states[notice.state];
  }
  const text = $derived(describeNotice(event));
  const killed = $derived(event.kind === 'killed');
  /** A stop's line is the limit it crossed; why, and what stopped, read behind the disclosure. */
  // A narrow line wraps before the size, never between its number and its unit.
  const limit = $derived(event.kind === 'killed' ? bytes(event.limitBytes).replace(' ', '\u00a0') : '');
  /** Read whole by a screen reader; on the line, the words give way before the figure. */
  const sentence = $derived(event.kind !== 'killed' ? '' : events.length > 1
    ? strings.resources.killCount(events.length, limit)
    : strings.resources.killLimit(limit));
  const figure = $derived(killed ? strings.resources.killFigure(events.length, limit) : '');
</script>

{#snippet stoppedList()}
      <p class="reason">{text}</p>
      <div class="processes" aria-label={strings.resources.stoppedProcesses(events.length)}>
        {#each events as stopped}
          <div class="stopped"><span class="process">{stopped.exe?.split(/[\\/]/).pop() ?? strings.resources.unknown}</span>{#if stopped.bytes !== undefined}<span class="size">{bytes(stopped.bytes)}</span>{/if}</div>
        {/each}
      </div>
{/snippet}

<!-- A memory stop is a notice in the flow, one line high: the limit it crossed, then why and the processes behind its disclosure. -->
<NoticeBanner icon={TriangleAlert} tone="warning" testid="memory-row" kind={event.kind} inline
  title={killed ? strings.resources.killLine : ''} {figure} label={killed ? sentence : text} text={killed ? '' : text} details={killed ? stoppedList : undefined}>
  {#snippet actions()}
    {#if onconfigure}<button type="button" class="small ghost configure" onclick={onconfigure} title={strings.resources.memorySettings}><Settings2 size={14} aria-hidden="true" /><span class="ui-label">{strings.resources.memorySettings}</span></button>{/if}
  {/snippet}
</NoticeBanner>

<style>
  .processes { display: flex; flex-direction: column; gap: 4px; }
  .stopped { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; font-size: var(--text-xs); }
  .process { min-width: 0; padding: 2px 7px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-foreground); font-family: var(--font-mono); }
  .size { color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .configure { gap: 6px; color: var(--color-muted-foreground); }
  @media (max-width: 720px) { .configure .ui-label { display: none; } }
</style>
