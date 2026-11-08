<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Info } from '@lucide/svelte';
  import InfoTip from './InfoTip.svelte';

  /**
   * The one form every thread notice takes: a mark, a plain first line that
   * says what happened to the user's work, the technical name or the next
   * step on a quieter second line, the rest behind an "i", then its buttons.
   * It wraps rather than cuts on a narrow column, and the mark stays on the
   * first line. `docked` gives it the
   * composer's column, for the notices that stand right above it;
   * `replaces` sizes it for the composer's slot (`Composer`'s `notice`),
   * where it stands when the thread cannot run.
   */
  let { icon: Icon, tone = 'live', title, detail, info, docked = false, replaces = false, testid, kind, actions, children }: {
    icon: typeof Info;
    /** The colour of the mark: waiting on the user, broken, or only said. */
    tone?: 'live' | 'danger' | 'quiet';
    title?: string;
    detail?: string;
    info?: string;
    docked?: boolean;
    /** Rendered in the composer's slot under the dock's strip: the box's width and the gap it keeps under it. */
    replaces?: boolean;
    testid: string;
    kind?: string;
    actions?: Snippet;
    /** After the detail, for a line with a link in it. */
    children?: Snippet;
  } = $props();
</script>

<div class="thread-notice" class:docked class:replaces data-tone={tone} data-testid={testid} data-kind={kind} role="status">
  <span class="mark" aria-hidden="true"><Icon size={15} strokeWidth={1.75} /></span>
  <span class="text">
    <span class="line">
      {#if title}<strong class="title">{title}</strong>{:else if detail}<span class="detail lead">{detail}</span>{/if}
      {#if info}<InfoTip topic={title ?? detail ?? ''} text={info} testid="{testid}-info" />{/if}
    </span>
    {#if (title && detail) || children}
      <span class="sub">{#if title && detail}<span class="detail">{detail}</span>{/if}{#if children}{@render children()}{/if}</span>
    {/if}
  </span>
  {#if actions}<span class="actions">{@render actions()}</span>{/if}
</div>

<style>
  .thread-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
    min-height: 38px;
    box-sizing: border-box;
    padding: 7px 6px 7px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    font-size: var(--text-sm);
    line-height: 1.4;
    color: var(--color-muted-foreground);
  }
  /* The composer's own column, so the notice sits on it rather than across the pane. */
  .docked { flex: none; width: min(calc(100% - 40px), var(--content)); margin: 0 auto 8px; }
  /* In the composer's slot, under its strip: the box's width and its bottom gap. */
  .docked.replaces { width: 100%; max-width: var(--content); margin: 0 auto 16px; }
  /* The mark sits on the first line's height, whatever wraps under it. */
  .mark { display: flex; flex: none; align-self: flex-start; align-items: center; height: 1.4em; }
  [data-tone='live'] .mark { color: var(--color-live); }
  [data-tone='danger'] .mark { color: var(--color-danger); }
  [data-tone='quiet'] .mark { color: var(--color-subtle); }
  .text { display: flex; flex: 1 1 16em; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
  .line { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
  .line :global(.info-tip), .line :global(button) { flex: none; }
  .title { color: var(--color-foreground); font-weight: 550; }
  .lead { color: var(--color-foreground); }
  .sub { color: var(--color-subtle); }
  .sub :global(a) { margin-left: 6px; color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .sub :global(a:hover) { color: var(--color-foreground); }
  .actions { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  .actions :global(button) { gap: 6px; }
  @media (max-width: 720px) {
    .docked { width: calc(100% - 24px); }
    .docked.replaces { width: 100%; margin-bottom: max(10px, env(safe-area-inset-bottom)); }
    /* The words take the row and the buttons go under them, so the first line is not squeezed into a column. */
    .text { flex-basis: calc(100% - 30px); }
    .actions :global(button) { min-height: var(--touch-target); }
  }
</style>
