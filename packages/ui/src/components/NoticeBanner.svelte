<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import type { Component, Snippet } from 'svelte';
  import { strings } from '../lib/strings';

  /**
   * One system notice in a thread (memory stop, folder or worktree gone, a held
   * or retried turn, policy, firewall, contact hold): a 36 px line with its
   * icon, its title, a muted summary that ends in an ellipsis when the line is
   * too short, and its actions as small buttons. Details, and the summary the
   * line cut, open below behind a disclosure, so the notice never grows into a
   * card on its own. When the line leaves the summary only a few letters (a
   * phone), the summary leaves the line to the title and reads in the details:
   * never two cut fragments side by side.
   */
  let {
    icon: Icon,
    tone = 'neutral',
    title,
    titleTip,
    text = '',
    testid,
    kind,
    label,
    role = 'status',
    inline = false,
    timer = false,
    actions,
    details
  }: {
    icon: Component<{ size?: number; strokeWidth?: number }>;
    /** `warning` is amber (the user's turn to act), `danger` red (something failed). */
    tone?: 'neutral' | 'warning' | 'danger';
    title: string;
    titleTip?: string;
    /** The one-line summary after the title. */
    text?: string;
    testid: string;
    kind?: string;
    label?: string;
    role?: 'status' | 'alert' | 'note';
    /** In the timeline rather than on the composer: the message column's width, not the composer's. */
    inline?: boolean;
    /** The summary counts down: screen readers are not read every second of it. */
    timer?: boolean;
    actions?: Snippet;
    details?: Snippet;
  } = $props();

  let open = $state(false);
  let summary = $state<HTMLElement | undefined>(undefined);
  let cut = $state(false);
  let tight = $state(false);
  const id = $props.id();
  /** Below this, a cut summary is a fragment, not a sentence. */
  const TIGHT_PX = 160;

  // The disclosure is offered when there is more to read: details, or a summary the line cut.
  // A hidden summary keeps its place in the line, so its width is still the room it would have.
  $effect(() => {
    const node = summary;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      cut = node.scrollWidth > node.clientWidth + 1;
      tight = cut && !!title && node.clientWidth < TIGHT_PX;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });
  let disclosable = $derived(!!details || cut);
</script>

<aside class="notice {tone}" class:inline class:open class:tight data-testid={testid} data-kind={kind} {role} aria-label={label ?? title}>
  <div class="line">
    <span class="mark" aria-hidden="true"><Icon size={15} strokeWidth={1.9} /></span>
    <!-- `ui-label` trims each text to its cap height, so the icon centres on the words in every font. -->
    {#if title}<strong class="title ui-label" title={titleTip}>{title}</strong>{/if}
    {#if text}<span class="summary ui-label" bind:this={summary} role={timer ? 'timer' : undefined} aria-live={timer ? 'off' : undefined}>{text}</span>{:else}<span class="fill"></span>{/if}
    {#if actions}<span class="actions">{@render actions()}</span>{/if}
    {#if disclosable}
      <button type="button" class="disclose" aria-expanded={open} aria-controls={id} title={open ? strings.chat.noticeLess : strings.chat.noticeMore} aria-label={open ? strings.chat.noticeLess : strings.chat.noticeMore} data-testid="notice-disclose" onclick={() => (open = !open)}>
        <ChevronDown size={14} strokeWidth={2} />
      </button>
    {/if}
  </div>
  {#if disclosable}
    <div class="details" {id} hidden={!open}>
      {#if cut && text}<p class="full">{text}</p>{/if}
      {#if details}{@render details()}{/if}
    </div>
  {/if}
</aside>

<style>
  .notice {
    flex: none;
    box-sizing: border-box;
    /* The composer's own column: the notice reads as part of what the next send meets. */
    width: min(calc(100% - 40px), var(--content));
    margin: 0 auto 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    font-size: var(--text-sm);
  }
  .notice.inline { width: 100%; max-width: 640px; margin: 0; }
  .line { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 4px 0 12px; }
  .mark { display: flex; flex: none; color: var(--color-muted-foreground); }
  .warning .mark { color: var(--color-live); }
  .danger .mark { color: var(--color-danger); }
  .title { flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--color-foreground); }
  .summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .fill { flex: 1; }
  /* The title takes the line; the summary waits in the details. */
  .tight .title { flex: 0 1 auto; min-width: 0; max-width: none; }
  .tight .summary { visibility: hidden; }
  .actions { display: flex; flex: none; align-items: center; gap: 4px; }
  .actions :global(button) { height: 26px; min-height: 0; padding: 0 9px; font-size: var(--text-xs); }
  .disclose { display: inline-grid; place-items: center; flex: none; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--color-muted-foreground); cursor: pointer; }
  .disclose:hover, .disclose:focus-visible { background: var(--color-hover); color: var(--color-foreground); }
  .disclose :global(svg) { transition: rotate var(--dur-2) var(--ease-out-quint); }
  .open .disclose :global(svg) { rotate: 180deg; }
  .details { padding: 0 12px 10px 35px; color: var(--color-muted-foreground); line-height: 1.5; overflow-wrap: anywhere; }
  .details[hidden] { display: none; }
  .full { margin: 0 0 6px; }
  .details :global(p) { margin: 0 0 6px; }
  .details :global(p:last-child) { margin-bottom: 0; }
  .details :global(a) { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  @media (max-width: 720px) {
    .notice { width: calc(100% - 20px); }
    .notice.inline { width: 100%; }
    .title { max-width: 50%; }
    /* A finger's target grows past the line; the line keeps its height. */
    .actions :global(button), .disclose { position: relative; }
    .actions :global(button)::after, .disclose::after { content: ''; position: absolute; inset: -9px -2px; }
  }
</style>
