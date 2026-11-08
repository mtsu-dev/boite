<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { ChevronDown, Plug, Sparkles } from '@lucide/svelte';
  import { isNamedModel } from '../lib/model-order';
  import { levelName } from '../lib/format';
  import ProviderLogo from './ProviderLogo.svelte';
  import Deferred, { parts } from './Deferred.svelte';
  import type ModelPickerMenu from './ModelPickerMenu.svelte';
  import { Closing } from '../lib/closing.svelte';
  import { strings } from '../lib/strings';
  import type { Choice, PickPatch, Store } from '../lib/store.svelte';

  /**
   * The model chip. Its popover (`ModelPickerMenu.svelte`) is a chunk of its
   * own that only a click draws: the models in use first, every provider's
   * list behind "All models". It picks a model: the effort and the
   * permission are the composer's chips beside it, its context ring sits
   * beside the name (`trailing`). Desktop opens it from the chip; a phone as a bottom sheet.
   */
  let {
    store,
    choice,
    locked = false,
    single = false,
    disabled = false,
    readonly = false,
    readonlyHint = '',
    anchor,
    trailing,
    onpick
  }: {
    store: Store;
    choice: Choice | null;
    /** Optional restriction for callers that intentionally keep one account. */
    locked?: boolean;
    /** The choice's provider alone: no provider rail and no first level, its models straight away. */
    single?: boolean;
    disabled?: boolean;
    /** The model is set elsewhere (a bot's settings): the chip names it and opens nothing. */
    readonly?: boolean;
    readonlyHint?: string;
    /** What the desktop popover opens above: the chip, or the whole composer while an ask is docked in it, on the chip's side, so it never covers the ask. */
    anchor?: () => HTMLElement | null;
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

  /**
   * A bot's chip opens nothing, so it names the effort its settings run
   * beside the model: "Opus 5.5 · High". Elsewhere the effort is its own chip.
   */
  let effortLabel = $derived.by(() => {
    if (!choice || !readonly) return null;
    const model = store.modelOf(choice);
    const id = choice.effort ?? model?.effort?.default;
    const level = id ? model?.effort?.levels.find((entry) => entry.id === id) : undefined;
    return level ? levelName(level) : null;
  });

  /** Opens the popover once its chunk is there (a slash command, a removed account's chip). */
  export async function reveal() {
    if (!popover.open) toggle();
    await parts.ModelPickerMenu.load().catch(() => undefined);
    await tick();
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
    <button type="button" class="ui-chip trigger connect" data-testid="composer-connect" onclick={() => store.openConnect()}>
      <Plug size={14} strokeWidth={1.75} />
      <span class="label ui-label">{strings.connect.button}</span>
    </button>
  {:else if readonly}
  <span class="ui-chip trigger readonly" data-testid="composer-picker" title={readonlyHint || label}>
    {#if provider}<ProviderLogo providerId={provider.id} size={14} />{/if}
    <span class="label ui-label">{label}</span>
    {#if effortLabel}<span class="effort ui-label" data-testid="composer-picker-effort">· {effortLabel}</span>{/if}
  </span>
  {:else}
  <button
    type="button"
    class="ui-chip trigger"
    aria-haspopup="menu"
    aria-expanded={popover.open}
    aria-label={[label, effortLabel, accountLabel].filter(Boolean).join(', ')}
    title={locked ? strings.composer.lockedHint : strings.composer.picker}
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
    <span class="label ui-label">{label}</span>
    {#if effortLabel}<span class="effort ui-label" data-testid="composer-picker-effort">· {effortLabel}</span>{/if}
    {#if accountLabel}<span class="account ui-label" data-testid="composer-picker-account">{accountLabel}</span>{/if}
    <ChevronDown size={12} strokeWidth={2} />
  </button>
  {/if}
  {@render trailing?.()}

  {#if popover.shown}
    <Deferred part={parts.ModelPickerMenu} floating>
      {#snippet pending()}{/snippet}
      {#snippet children(Menu)}<Menu bind:this={body} {store} {choice} {popover} root={() => root} {locked} {single} {disabled} {anchor} {onpick} />{/snippet}
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

  .trigger[aria-expanded='true'] {
    background: var(--control-glaze) var(--color-control-hover);
    color: var(--color-foreground);
  }

  /* Only under a pointer that hovers: a finger's tap left :hover on the chip, pressed after its sheet closed. */
  @media (hover: hover) {
    .trigger:hover {
      background: var(--control-glaze) var(--color-control-hover);
      color: var(--color-foreground);
    }
  }

  /* Provider marks in one ink, here and in the popover: the names carry them. */
  .picker :global(.logo) { filter: grayscale(1); }

  .trigger .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trigger .account { flex: none; color: var(--color-subtle); font-weight: 400; }
  .trigger .effort { flex: none; color: var(--color-muted-foreground); font-weight: 400; white-space: nowrap; }
  /* A phone keeps the row for the model's whole name: the sheet's head names the login. */
  @media (max-width: 720px) { .trigger .account { display: none; } }
  .trigger.readonly { cursor: default; }
  @media (hover: hover) { .trigger.readonly:hover { background: transparent; color: inherit; } }
  /* The composer's chip: the name and the context ring read as one control. */
  .picker.pill { align-items: center; border-radius: var(--radius-md); }
</style>
