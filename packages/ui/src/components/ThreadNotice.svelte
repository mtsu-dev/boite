<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Info } from '@lucide/svelte';
  import InfoTip from './InfoTip.svelte';

  /**
   * The one form every thread notice takes: a mark, what happened in a few
   * words, a quieter detail, the rest behind an "i", then its buttons. It
   * wraps rather than cuts on a narrow column. `docked` gives it the
   * composer's column, for the notices that stand right above it.
   */
  let { icon: Icon, tone = 'live', title, detail, info, docked = false, testid, kind, actions, children }: {
    icon: typeof Info;
    /** The colour of the mark: waiting on the user, broken, or only said. */
    tone?: 'live' | 'danger' | 'quiet';
    title?: string;
    detail?: string;
    info?: string;
    docked?: boolean;
    testid: string;
    kind?: string;
    actions?: Snippet;
    /** After the detail, for a line with a link in it. */
    children?: Snippet;
  } = $props();
</script>

<div class="thread-notice" class:docked data-tone={tone} data-testid={testid} data-kind={kind} role="status">
  <span class="mark" aria-hidden="true"><Icon size={15} strokeWidth={1.75} /></span>
  <span class="line">
    {#if title}<strong class="title">{title}</strong>{/if}{#if detail}<span class="detail">{detail}</span>{/if}
    {#if children}{@render children()}{/if}
    {#if info}<InfoTip topic={title ?? detail ?? ''} text={info} testid="{testid}-info" />{/if}
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
    padding: 5px 6px 5px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    font-size: var(--text-sm);
    line-height: 1.4;
    color: var(--color-muted-foreground);
  }
  /* The composer's own column, so the notice sits on it rather than across the pane. */
  .docked { flex: none; width: min(calc(100% - 40px), var(--content)); margin: 0 auto 8px; }
  .mark { display: flex; flex: none; }
  [data-tone='live'] .mark { color: var(--color-live); }
  [data-tone='danger'] .mark { color: var(--color-danger); }
  [data-tone='quiet'] .mark { color: var(--color-subtle); }
  .line { flex: 1 1 16em; min-width: 0; overflow-wrap: anywhere; }
  .title { color: var(--color-foreground); font-weight: 550; }
  .title + .detail::before { content: '·' / ''; margin: 0 6px; color: var(--color-subtle); }
  .line :global(a) { margin-left: 6px; color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .line :global(a:hover) { color: var(--color-foreground); }
  .actions { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }
  .actions :global(button) { gap: 6px; }
  @media (max-width: 720px) {
    .docked { width: calc(100% - 20px); }
    /* A narrow basis keeps one button beside the text; two buttons still wrap below. */
    .line { flex-basis: 8em; }
    .actions :global(button) { min-height: var(--touch-target); }
  }
</style>
