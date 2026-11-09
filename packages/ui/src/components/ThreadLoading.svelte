<script lang="ts">
  import { fill, strings } from '../lib/strings';
  import { transferBytes } from '../lib/format';
  import Deferred, { parts } from './Deferred.svelte';
  import { HOUSE_BOT } from '../lib/robots';

  /**
   * What the chat shows between the click on a thread and its first page: the
   * outline of a conversation in the transcript's own column, a prompt and two
   * replies in quiet shapes, where the first message will land. Once the core
   * says what the page weighs, a neutral bar and the numbers count it in;
   * before that (a page short enough to come whole, or a core that sends
   * answers whole) the shapes say it alone.
   */
  let { progress }: { progress: { received: number; total: number } | null } = $props();

  const fraction = $derived(progress && progress.total > 0 ? Math.min(1, progress.received / progress.total) : null);
  const label = $derived(progress ? fill(strings.chat.openingProgress, { received: transferBytes(progress.received), total: transferBytes(progress.total) }) : '');
</script>

<div class="loading" data-testid="thread-loading" role="status" aria-live="polite">
  <!-- Without a total the shapes alone say it is coming: the old sweep's id stays with them. -->
  <div class="column" aria-hidden="true" data-testid={fraction === null ? 'thread-loading-sweep' : undefined}>
    <div class="shape prompt"></div>
    <div class="reply"><div class="shape line"></div><div class="shape line"></div><div class="shape line short"></div></div>
    <div class="reply"><div class="shape line"></div><div class="shape line half"></div></div>
  </div>
  <div class="column count">
    {#if fraction !== null}
      <div class="track" role="progressbar" aria-label={strings.chat.opening}
        aria-valuemin={0} aria-valuemax={progress?.total} aria-valuenow={progress?.received} aria-valuetext={label || undefined}>
        <div class="bar" data-testid="thread-loading-bar" style:transform="scaleX({fraction})"></div>
      </div>
    {/if}
    <!-- Said in words beside the house bot, so the shapes read as a page on its way, not an empty thread. -->
    <p class="caption" class:alone={!label}>
      <span class="what"><span class="mark" aria-hidden="true"><Deferred part={parts.RobotFace} quiet>{#snippet children(RobotFace)}<RobotFace robot={HOUSE_BOT} />{/snippet}</Deferred></span>{strings.chat.opening}</span>
      {#if label}<span class="numbers" data-testid="thread-loading-progress">{label}</span>{/if}
    </p>
  </div>
</div>

<style>
  /* The timeline's own geometry, so nothing moves when the page lands. */
  .loading {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 20px var(--outline-room);
    overflow: hidden;
    /* A fast open finishes before this shows: no flash for a short page. */
    animation: fade var(--dur-3) var(--ease-out-quint) 150ms both;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--chat-message-gap, 24px);
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
  }

  /* Shapes in the faintest fill, breathing slowly while the page comes. */
  .shape {
    border-radius: var(--radius-full);
    background: var(--color-active);
    animation: pulse 1.8s var(--loop-ease-in-out-54) infinite var(--loops);
  }
  .prompt { align-self: flex-end; width: min(46%, 340px); height: 44px; border-radius: var(--radius-xl); }
  .reply { display: flex; flex-direction: column; gap: 12px; }
  .line { height: 12px; width: 92%; }
  .line + .line { width: 84%; }
  .line.short { width: 58%; }
  .line.half { width: 40%; }

  .count { gap: 8px; }

  .track {
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--color-active);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    width: 100%;
    background: var(--color-subtle);
    transform-origin: left;
    transition: transform var(--dur-2) var(--ease-out-quint);
  }

  .caption {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }

  .caption.alone { justify-content: center; }
  .what { display: inline-flex; align-items: center; gap: 8px; }
  .mark { display: block; flex: none; width: 22px; height: 22px; }
  .mark :global(svg.robot) { display: block; width: 100%; height: 100%; border-radius: 50%; }

  .numbers {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :global(html[data-motion='reduced']) .shape { animation: none; }
  @media (prefers-reduced-motion: reduce) {
    .shape { animation: none; }
  }
</style>
