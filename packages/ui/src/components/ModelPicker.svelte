<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { ChevronDown, Plug, Sparkles } from '@lucide/svelte';
  import { isNamedModel } from '../lib/model-order';
  import ProviderLogo from './ProviderLogo.svelte';
  import Deferred, { parts } from './Deferred.svelte';
  import type ModelPickerMenu from './ModelPickerMenu.svelte';
  import type PickerMore from './PickerMore.svelte';
  import { Closing } from '../lib/closing.svelte';
  import { strings } from '../lib/strings';
  import type { Choice, PickPatch, Store } from '../lib/store.svelte';

  /**
   * The model chip. Its popover (`ModelPickerMenu.svelte`) is a chunk of its
   * own that only a click draws: provider logos beside a scrolling model list.
   * The composer's chip adds its effort and permission rows under the models
   * (`settings`) and its context ring beside the name (`trailing`); a phone
   * gets the whole thing as one sheet, providers above the models.
   */
  let {
    store,
    choice,
    locked = false,
    single = false,
    disabled = false,
    readonly = false,
    readonlyHint = '',
    compact = false,
    anchor,
    settings,
    trailing,
    onpick
  }: {
    store: Store;
    choice: Choice | null;
    /** Optional restriction for callers that intentionally keep one account. */
    locked?: boolean;
    /** The choice's provider alone: no provider rail and no favorites, its models straight away. */
    single?: boolean;
    disabled?: boolean;
    /** The model is set elsewhere (a bot's settings): the chip names it and opens nothing. */
    readonly?: boolean;
    readonlyHint?: string;
    /** Stepped back behind a decision: the provider's mark alone, its name said on hover. */
    compact?: boolean;
    /** What the popover opens above: the chip, or the whole composer while an ask is docked in it, so it never covers the ask. */
    anchor?: () => HTMLElement | null;
    /** The rows under the models; the menu hands them its More row, which loads with it. */
    settings?: Snippet<[typeof PickerMore]>;
    trailing?: Snippet;
    onpick: (patch: PickPatch) => void;
  } = $props();

  const popover = new Closing();
  let root = $state<HTMLDivElement | undefined>(undefined);
  let body = $state<ModelPickerMenu | undefined>(undefined);

  let provider = $derived(choice ? store.providerOf(choice.providerId) : null);
  // The model's name, or its agent's while the agent picks the model itself;
  // the login only when the agent has several to tell apart.
  let label = $derived.by(() => {
    if (!choice || !provider) return strings.composer.noProvider;
    const model = store.modelOf(choice);
    return model && isNamedModel(model) ? model.name : provider.name;
  });
  /** The chip names the model; the account only when it is another seat than the provider's own login. */
  let accountLabel = $derived.by(() => {
    if (!choice || !provider || store.accountsOf(provider.id).length < 2) return null;
    const account = store.accountOf(choice.accountId);
    return account && account.isolationDir !== null ? account.label : null;
  });

  /** Opens the popover, then brings one of its rows (`composer-effort`, `composer-mode`, `effort-speed`) to the keyboard. */
  export async function reveal(testid?: string) {
    if (!popover.open) toggle();
    await parts.ModelPickerMenu.load().catch(() => undefined);
    await tick();
    const find = () => testid ? root?.querySelector<HTMLElement>(`[data-testid="composer-picker-menu"] [data-testid="${testid}"]`) : null;
    let row = find();
    // Speed and permissions wait behind the More row: unfold it to reach them.
    if (testid && !row) {
      root?.querySelector<HTMLElement>('[data-testid="composer-picker-more"][aria-expanded="false"]')?.click();
      await tick();
      row = find();
    }
    row?.scrollIntoView?.({ block: 'nearest' });
    // A row of named choices takes the focus on its picked one; a button row opens.
    if (row && !(row instanceof HTMLButtonElement)) (row.querySelector<HTMLElement>('[role=radio][tabindex="0"]') ?? row).focus();
    else row?.click();
  }

  function toggle(event?: MouseEvent) {
    event?.stopPropagation();
    popover.toggle();
    // A body still playing its exit is shown again: it starts over like a fresh one.
    if (popover.open) body?.reset();
  }

  /** The keys belong to the body; before its chunk lands, Escape still closes. */
  function onkeydown(event: KeyboardEvent) {
    if (body) body.keydown(event);
    else if (event.key === 'Escape' && popover.open) { event.stopPropagation(); popover.hide(); }
  }

  function onWindowPointerdown(event: PointerEvent) {
    if (!popover.open) return;
    if (root && event.target instanceof Node && root.contains(event.target)) return;
    popover.hide();
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

<div class="picker" class:pill={!!trailing} bind:this={root}>
  {#if !choice && store.owner}
    <!-- Nothing to pick from yet: the chip is the way to get something. -->
    <button type="button" class="chip trigger connect" data-testid="composer-connect" onclick={() => store.openConnect()}>
      <Plug size={14} strokeWidth={1.75} />
      <span class="label ui-label">{strings.connect.button}</span>
    </button>
  {:else if readonly}
  <span class="chip trigger readonly" data-testid="composer-picker" title={readonlyHint || label}>
    {#if provider}<ProviderLogo providerId={provider.id} size={14} />{/if}
    <span class="label ui-label">{label}</span>
  </span>
  {:else}
  <button
    type="button"
    class="chip trigger"
    class:compact
    aria-haspopup="menu"
    aria-expanded={popover.open}
    aria-label={accountLabel ? `${label}, ${accountLabel}` : label}
    title={locked ? strings.composer.lockedHint : compact ? label : strings.composer.picker}
    data-testid="composer-picker"
    {disabled}
    onclick={toggle}
    {onkeydown}
  >
    {#if provider}
      <ProviderLogo providerId={provider.id} size={14} />
    {:else}
      <Sparkles size={14} strokeWidth={1.75} />
    {/if}
    {#if !compact}
    <span class="label ui-label">{label}</span>
    {#if accountLabel}<span class="account ui-label" data-testid="composer-picker-account">{accountLabel}</span>{/if}
    <ChevronDown size={12} strokeWidth={2} />
    {/if}
  </button>
  {/if}
  {@render trailing?.()}

  {#if popover.shown}
    <Deferred part={parts.ModelPickerMenu} floating>
      {#snippet pending()}{/snippet}
      {#snippet children(Menu)}<Menu bind:this={body} {store} {choice} {popover} root={() => root} {locked} {single} {disabled} {anchor} {settings} {onpick} />{/snippet}
    </Deferred>
  {/if}
</div>

<style>
  .picker {
    display: inline-flex;
    min-width: 0;
  }

  .trigger {
    cursor: pointer;
    height: var(--control-sm);
    max-width: 260px;
    padding-right: 6px;
    transition:
      background var(--dur-2) var(--ease-out-quint),
      color var(--dur-2) var(--ease-out-quint);
  }

  .trigger:hover,
  .trigger[aria-expanded='true'] {
    background: var(--control-glaze) var(--color-control-hover);
    color: var(--color-foreground);
  }

  /* Provider marks in one ink, here and in the popover: the names carry them. */
  .picker :global(.logo) { filter: grayscale(1); }

  .trigger .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trigger .account { flex: none; color: var(--color-subtle); font-weight: 400; }
  /* A phone keeps the row for the model's whole name: the sheet's head names the login. */
  @media (max-width: 720px) { .trigger .account { display: none; } }
  .trigger.readonly { cursor: default; }
  .trigger.readonly:hover { background: transparent; color: inherit; }
  /* The composer's chip: the name and the context ring read as one control. */
  .picker.pill { align-items: center; border-radius: var(--radius-md); }
</style>
