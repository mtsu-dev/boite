<script lang="ts">
  // The explanation behind a setting, one "i" away. A mouse shows it on hover,
  // a finger or a click pins it open, Escape or a press elsewhere puts it away.
  // Screen readers get it as the button's description while it is shown, and
  // the button names what it explains, so nothing hides from them.
  import { Info } from '@lucide/svelte';
  import { Closing } from '../lib/closing.svelte';
  import { floating } from '../lib/floating';
  import { fill, strings } from '../lib/strings';

  /**
   * `icon` replaces the "i" where the mark itself says more, as the lock of a control the policy holds.
   * `gather`: the one "i" of a section, beside its title. It also says what every
   * other "i" of its card says, and those step aside (app.css), so a section
   * carries one "i" rather than one a row. The "i" beside a settings card's
   * title gathers on its own.
   */
  let { text, topic, testid, icon: Icon = Info, gather = false }: { text: string; topic: string; testid?: string; icon?: typeof Info; gather?: boolean } = $props();
  let titled = $state(false);
  let gathering = $derived(gather || titled);
  /** A plain "i" its section's tip may gather: a lock or another mark stays on its row. */
  let plain = $derived(Icon === Info && !gathering);

  const tip = new Closing();
  const id = `info-${Math.random().toString(36).slice(2, 10)}`;
  let trigger = $state<HTMLButtonElement>();
  let bubble = $state<HTMLElement>();
  /** Opened by a click or a tap: a pointer leaving does not close it. */
  let pinned = $state(false);

  /** The rows' tips of the section, read again when the bubble opens: the rows a page shows can change. */
  let rows = $state<{ topic: string; text: string }[]>([]);
  function gathered(): { topic: string; text: string }[] {
    const scope = trigger?.closest('.card');
    return scope ? [...scope.querySelectorAll<HTMLElement>('.info-tip[data-tip-text]')]
      .map((row) => ({ topic: row.dataset.tipTopic ?? '', text: row.dataset.tipText ?? '' }))
      .filter((row) => row.text) : [];
  }
  $effect(() => {
    titled = Icon === Info && trigger?.closest('.settings .card > h2, .settings .card > header > h2') != null;
  });
  $effect(() => {
    if (gathering) rows = gathered();
  });
  function open(): void {
    if (gathering) rows = gathered();
    tip.show();
  }

  function close(): void {
    pinned = false;
    tip.hide();
  }

  function onclick(event: MouseEvent): void {
    // Inside a `label`, the click must not also flip the switch it sits beside.
    event.preventDefault();
    if (pinned) close();
    else {
      pinned = true;
      open();
    }
  }

  function onpointerenter(event: PointerEvent): void {
    if (event.pointerType === 'mouse') open();
  }

  function onpointerleave(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && !pinned) tip.hide();
  }

  $effect(() => {
    if (!tip.open) return;
    const onkey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      trigger?.focus();
    };
    const onpress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (trigger?.contains(target) || bubble?.contains(target))) return;
      close();
    };
    window.addEventListener('keydown', onkey, true);
    document.addEventListener('pointerdown', onpress, true);
    return () => {
      window.removeEventListener('keydown', onkey, true);
      document.removeEventListener('pointerdown', onpress, true);
    };
  });
</script>

<button
  type="button"
  class="info-tip ghost icon"
  aria-label={fill(strings.common.moreInfo, { topic })}
  aria-expanded={tip.open}
  aria-describedby={tip.shown ? id : undefined}
  data-testid={testid ?? 'info-tip'}
  data-tip-topic={plain ? topic : undefined}
  data-tip-text={plain ? text : undefined}
  data-gather={gathering ? '' : undefined}
  hidden={gathering && !text && rows.length === 0}
  bind:this={trigger}
  {onclick}
  {onpointerenter}
  {onpointerleave}
  onfocus={(event) => { if (event.currentTarget.matches(':focus-visible')) open(); }}
  onblur={() => { if (!pinned) tip.hide(); }}
>
  <Icon size={14} strokeWidth={1.75} />
</button>
{#if tip.shown}
  <span
    {id}
    class="info-bubble"
    class:closing={tip.closing}
    role="tooltip"
    data-testid="{testid ?? 'info-tip'}-text"
    bind:this={bubble}
    use:tip.attach
    use:floating={{ anchor: () => trigger ?? null, dismiss: close }}
    onanimationend={tip.end}
  >{#if gathering}{#if text}<span class="lead">{text}</span>{/if}{#each rows as row, index (index)}<span class="gathered"><strong>{row.topic}</strong> {row.text}</span>{/each}{:else}{text}{/if}</span>
{/if}

<style>
  /* A 24 px target around the 14 px mark; the negative margin keeps the line's height. */
  .info-tip {
    width: 24px;
    height: 24px;
    margin: -4px -2px -4px 2px;
    padding: 0;
    border-radius: 50%;
    vertical-align: middle;
    color: var(--color-muted-foreground);
  }

  .info-tip[hidden] { display: none; }

  .info-tip[aria-expanded='true'] {
    color: var(--color-foreground);
    background: var(--color-surface-3);
  }

  .info-bubble {
    position: fixed;
    z-index: 60;
    display: block;
    max-width: min(340px, calc(100vw - 24px));
    padding: 8px 10px;
    /* The overlay card every menu and popover wears (app.css). */
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    background: var(--overlay-surface);
    box-shadow: var(--shadow-overlay);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: normal;
    text-transform: none;
    white-space: normal;
    animation: pop var(--motion-in);
  }

  /* A section's tip: its rows' tips one after another, each led by the row it explains. */
  .info-bubble:has(.gathered) { max-width: min(420px, calc(100vw - 24px)); max-height: min(60vh, 520px); overflow-y: auto; }
  .lead, .gathered { display: block; }
  .lead + .gathered, .gathered + .gathered { margin-top: var(--space-2); }
  .gathered strong { font-weight: 600; }

  .info-bubble.closing {
    animation: pop-out var(--motion-out);
  }

  /* A phone gets it as a sheet, where there is room to read. */
  .info-bubble:global([data-mobile-sheet='true']) {
    max-width: none;
    padding: 14px 16px;
    font-size: var(--text-md);
  }

  /* A finger gets a bigger target that takes no more room on the line, and
     the open state shows in the icon alone: a filled disc that size is loud. */
  @media (max-width: 720px) {
    .info-tip { width: 30px; height: 30px; margin: -8px -6px -8px -2px; }
    .info-tip[aria-expanded='true'] { background: transparent; color: var(--color-foreground); }
  }
</style>
