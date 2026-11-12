<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X, type Info } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The one notice of the app: a banner, a line in the composer's place, a
   * failure in the transcript and a toast are all this form. A mark in the
   * tone's ink, one plain line that says what happened, an optional quieter
   * second line, the rest behind an "i", then at most two buttons of the
   * family and an optional dismiss. Its ground is the tone's soft wash, no
   * hairline; a toast (`floating`) adds the overlays' one elevation.
   * `docked` gives it the composer's column; `replaces` sizes it for the
   * composer's slot, where it stands when the thread cannot run.
   */
  let { icon: Icon, tone = 'info', title, meta, detail, tip, info, docked = false, replaces = false, floating = false, role = 'status', label, testid, kind, ids, actions, children, ondismiss, dismissId }: {
    icon: typeof Info;
    /** Its ink and wash: said only, a warning, broken, or done. */
    tone?: 'info' | 'caution' | 'danger' | 'success';
    title?: string;
    /** Quiet words after the title: where it comes from, how many wait. */
    meta?: string;
    detail?: string;
    /** A native tooltip on the first line: the full sentence a short line stands for. */
    tip?: string;
    info?: string;
    docked?: boolean;
    /** Rendered in the composer's slot under the dock's strip: the box's width and the gap it keeps under it. */
    replaces?: boolean;
    /** A toast: the same notice over the page, with the overlays' elevation. */
    floating?: boolean;
    role?: 'status' | 'alert';
    /** The notice's accessible name, when a reader should hear it before the words. */
    label?: string;
    testid?: string;
    kind?: string;
    /** Test ids for the title and the detail line. */
    ids?: { title?: string; meta?: string; detail?: string };
    actions?: Snippet;
    /** After the detail on the second line: a link, a fold, an excerpt. */
    children?: Snippet;
    ondismiss?: () => void;
    dismissId?: string;
  } = $props();
</script>

<div class="notice" class:docked class:replaces class:floating data-tone={tone} data-testid={testid} data-kind={kind} {role} aria-label={label}>
  <span class="mark" aria-hidden="true"><Icon size={16} strokeWidth={1.75} /></span>
  <div class="notice-body">
  <div class="text">
    <span class="line">
      {#if title}<strong class="title ui-label-box" data-testid={ids?.title} title={tip}><span class="ui-label">{title}</span></strong>{:else if detail}<span class="detail lead" data-testid={ids?.detail} title={tip}>{detail}</span>{/if}
      {#if meta}<span class="meta" data-testid={ids?.meta}>{meta}</span>{/if}
      {#if info}<InfoTip topic={title ?? detail ?? ''} text={info} testid={testid ? `${testid}-info` : undefined} />{/if}
    </span>
    {#if (title && detail) || children}
      <div class="sub">{#if title && detail}<span class="detail" data-testid={ids?.detail}>{detail}</span>{/if}{#if children}{@render children()}{/if}</div>
    {/if}
  </div>
  {#if actions}<span class="actions">{@render actions()}</span>{/if}
  </div>
  {#if ondismiss}
    <button type="button" class="icon-button small dismiss" data-testid={dismissId} aria-label={strings.common.dismiss} title={strings.common.dismiss} onclick={ondismiss}><X size={14} /></button>
  {/if}
</div>

<style>
  .notice {
    --tone: var(--color-subtle);
    --tone-wash: var(--color-surface-2);
    /* The first line of words sits on the middle of a small button: the mark, the words and the close share it. */
    --first-line: max(4px, calc((var(--control-sm) - 1.4em) / 2));
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
    min-height: 40px;
    box-sizing: border-box;
    padding: 6px 6px 6px 12px;
    border-radius: var(--radius-lg);
    background: var(--tone-wash);
    font-size: var(--text-sm);
    line-height: 1.4;
    text-align: left;
    color: var(--color-muted-foreground);
  }
  .notice[data-tone='caution'] { --tone: var(--color-caution); --tone-wash: color-mix(in oklab, var(--color-caution) 7%, var(--color-surface-2)); }
  .notice[data-tone='danger'] { --tone: var(--color-danger); --tone-wash: color-mix(in oklab, var(--color-danger) 10%, var(--color-surface-2)); }
  .notice[data-tone='success'] { --tone: var(--color-success); --tone-wash: color-mix(in oklab, var(--color-success) 10%, var(--color-surface-2)); }
  /* Over the page: the overlays' fill under the wash and their one elevation. */
  .floating { box-shadow: var(--shadow-overlay); }
  /* The composer's own column, so the notice sits on it rather than across the pane. */
  .docked { flex: none; width: min(calc(100% - 40px), var(--content)); margin: 0 auto 8px; }
  /* In the composer's slot, under its strip: the box's width and its bottom gap. */
  .docked.replaces { width: 100%; max-width: var(--content); margin: 0 auto 16px; }
  /* The mark sits on the first line's height, whatever wraps under it. */
  .mark { display: flex; flex: none; align-items: center; height: 1.4em; margin-block: var(--first-line); color: var(--tone); }
  /* The words and the actions wrap together; the close keeps its corner. */
  .notice-body { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: flex-start; gap: 6px 10px; min-width: 0; }
  /* The words take their own width, so the buttons follow them inline; a long sentence takes the row and the buttons wrap under it. */
  .text { display: flex; flex: 0 1 auto; flex-direction: column; gap: 2px; min-width: 0; margin-block: var(--first-line); overflow-wrap: anywhere; }
  .line { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
  .line :global(.info-tip), .line :global(button) { flex: none; }
  /* Its cap height centred on the first line, beside the mark, in every font (app.css `.ui-label`). */
  .title { color: var(--color-foreground); font-weight: 600; }
  .lead { color: var(--color-foreground); }
  .meta { flex: none; margin-left: auto; color: var(--color-subtle); }
  .sub { color: var(--color-subtle); }
  .sub :global(a) { margin-left: 6px; color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .sub :global(a:hover) { color: var(--color-foreground); }
  .actions { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; }
  .dismiss { flex: none; margin-top: calc((var(--control-sm) - var(--icon-button)) / 2); color: var(--color-subtle); }
  @media (max-width: 720px) {
    /* A phone row is short: the words wrap beside the buttons, which go under them only past a few words' width. */
    .text { flex: 1 1 10em; }
    .docked { width: calc(100% - 24px); }
    .docked.replaces { width: 100%; margin-bottom: max(10px, env(safe-area-inset-bottom)); }
  }
</style>
