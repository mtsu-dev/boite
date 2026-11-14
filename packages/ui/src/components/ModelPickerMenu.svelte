<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Check, ChevronRight, Star, RefreshCw } from '@lucide/svelte';
  import { orderedModels, type FavoriteModel } from '../lib/model-order';
  import type { Account, ModelInfo } from '@boite/contracts';
  import AccountSeats from './AccountSeats.svelte';
  import ModelSearch from './ModelSearch.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import ProviderTiles from './ProviderTiles.svelte';
  import { floating } from '../lib/floating';
  import { focusInitial } from '../lib/focus';
  import { Closing } from '../lib/closing.svelte';
  import { fill, strings } from '../lib/strings';
  import { FIRST_MODELS, favoriteIds, firstModels, groupModels, modelSource } from '../lib/model-list';
  import { pickerKeydown } from '../lib/model-picker-keys';
  import type { Choice, PickPatch, Store } from '../lib/store.svelte';
  import { desktopSettings } from '../lib/settings-tabs';

  /**
   * The model picker's popover, its own chunk: only a click on the chip
   * (`ModelPicker.svelte`) draws it. Provider logos in a rail beside a
   * scrolling model list on desktop, the same tiles as a top strip on a phone;
   * the frame is as tall as the column's content over a floor of a few rows,
   * and a longer rail scrolls inside it. The shown provider's name heads the column; when it has more than
   * one account the name is a button that unfolds them in place, above the
   * search (`AccountSeats.svelte`), and its models fill the rest. A click on a model closes the picker; nothing else does.
   */
  let {
    store,
    choice,
    popover,
    root,
    locked = false,
    single = false,
    disabled = false,
    onpick
  }: {
    store: Store;
    choice: Choice | null;
    /** The chip's open state: this body mounts while it is shown. */
    popover: Closing;
    /** The chip's root, which holds this body: the keys and the anchor read it. */
    root: () => HTMLElement | undefined;
    /** Optional restriction for callers that intentionally keep one account. */
    locked?: boolean;
    /** The choice's provider alone: no provider rail and no favorites, its models straight away. */
    single?: boolean;
    disabled?: boolean;
    onpick: (patch: PickPatch) => void;
  } = $props();

  /** Long lists get prefix groups and a bounded first page. */
  const SEARCH_FROM = 12;

  const legacy = new Closing();
  let mounted = true;
  let pickEpoch = 0;
  onDestroy(() => { mounted = false; pickEpoch += 1; });
  $effect(() => {
    if (!popover.open) { legacy.hide(); pickEpoch += 1; pickPending = false; }
  });
  let legacyOpen = $derived(legacy.open);
  let menu = $state<HTMLDivElement | undefined>(undefined);
  let searchBox = $state<HTMLInputElement | undefined>(undefined);
  /** Filters model names and ids, including legacy entries. */
  let modelQuery = $state('');
  /** The provider whose column is shown: the choice's until another tile is clicked. */
  let shownProviderId = $state<string | null>(null);
  let favoritesOpen = $state(false);
  let pickPending = $state(false);
  /** Shared by every machine; each is resolved to an account of this one (`lib/model-favorites.svelte.ts`). */
  const favorites = $derived(store.favorites);
  const favoriteSet = $derived.by(() => favoriteIds(store.favorites, shown?.id, shownAccountId));
  function favorite(model: ModelInfo): boolean {
    return favoriteSet.has(model.id);
  }
  async function applyPick(instance: { providerId: string; accountId: string }, requested?: string, close = true) {
    if (pickPending || disabled) return;
    const owner = store;
    const generation = owner.clientGeneration;
    const navigation = owner.navigationGeneration;
    const epoch = ++pickEpoch;
    const apply = onpick;
    const current = () => mounted && epoch === pickEpoch && store === owner
      && owner.clientGeneration === generation && owner.navigationGeneration === navigation;
    pickPending = true;
    try {
      const provider = owner.providerOf(instance.providerId);
      if (!provider) return;
      const native = agentListed(provider.protocol);
      // A row from a list the core already gave lands now: a refresh still
      // reading behind it changes nothing, and the core keeps that list meanwhile.
      if (requested !== undefined && (owner.catalogHas(instance.providerId, instance.accountId, requested)
        || (!native && owner.modelsOf(instance.providerId, instance.accountId).some((entry) => entry.id === requested)))) {
        apply({ ...instance, model: requested });
        if (close) popover.hide();
        return;
      }
      if (native) await owner.probeModels(instance.providerId, instance.accountId);
      if (!current()) return;
      const models = owner.modelsOf(instance.providerId, instance.accountId);
      const preferred = owner.defaultModelOf(provider, instance.accountId);
      const model = requested ?? (models.some(entry => entry.id === preferred) ? preferred
        : models.find(entry => entry.default)?.id ?? models[0]?.id ?? null);
      if ((model !== null && !models.some(entry => entry.id === model)) || (native && models.length === 0)) {
        owner.error = strings.composer.favoriteUnavailable;
        return;
      }
      apply({ ...instance, model });
      if (close) popover.hide();
    } finally { if (epoch === pickEpoch) pickPending = false; }
  }

  /** The agent owns its list, so the core only accepts a model it read from it. */
  function agentListed(protocol: string | undefined): boolean {
    return protocol === 'claude-sdk' || protocol === 'acp' || protocol === 'codex-appserver' || protocol === 'muse' || protocol === 'pi';
  }

  function pickFavorite(entry: FavoriteModel) {
    return applyPick(entry, entry.model.id);
  }

  let provider = $derived(choice ? store.providerOf(choice.providerId) : null);
  /** A provider turned off has no column: the rail's first one shows instead. */
  const offered = (id: string | null | undefined) => (id && store.providerOn(id) ? store.providerOf(id) : null);
  let shown = $derived(offered(shownProviderId) ?? offered(provider?.id) ?? store.offeredProviders[0] ?? null);
  /** The account the right column belongs to: an agent lists its models per login. */
  let shownAccountId = $derived.by((): string | null => {
    if (!shown) return null;
    if (choice && choice.providerId === shown.id) return choice.accountId;
    return (store.usableAccountOf(shown.id) ?? store.accountsOf(shown.id)[0])?.id ?? null;
  });
  let seats = $derived(shown ? store.accountsOf(shown.id) : []);
  /**
   * The files are still to download, so this provider has no models to offer
   * yet. An agent the user installed on their own is there whatever Boite's own
   * release says.
   */
  let needsInstall = $derived.by((): boolean => {
    if (!shown || shown.available) return false;
    const install = store.installOf(shown.id);
    return install !== null && install.state !== 'installed';
  });
  let shownModels = $derived(shown ? orderedModels(store.modelsOf(shown.id, shownAccountId)) : []);
  let probing = $derived(shown ? store.isProbing(shown.id, shownAccountId) : false);
  /** No answer yet for this instance: the descriptor's list would be replaced once it lands. */
  let pending = $derived(shown ? store.modelsPending(shown.id, shownAccountId) : false);

  /** The favorites' instances are being read again, one after the other. */
  let refreshingFavorites = $state(false);
  /** The refresh reads the view on screen: the favorites', or the shown provider's column. */
  let refreshing = $derived(favoritesOpen ? refreshingFavorites : probing);

  async function refreshModels() {
    if (favoritesOpen) {
      refreshingFavorites = true;
      try {
        const seen = new Set<string>();
        for (const entry of favorites) {
          const key = entry.providerId + '::' + entry.accountId;
          if (seen.has(key)) continue;
          seen.add(key);
          await store.probeModels(entry.providerId, entry.accountId, true);
        }
      } finally { refreshingFavorites = false; }
    } else if (shown && shownAccountId) await store.probeModels(shown.id, shownAccountId, true);
  }

  // An ACP agent owns its model list, so the descriptor cannot carry it: the
  // core reads it from one short-lived agent process. Reopening also refreshes
  // a catalog whose cached answer has expired.
  // Nothing is asked of a provider whose executable is not on the machine.
  $effect(() => {
    if (!popover.open || favoritesOpen || !shown || needsInstall) return;
    if (!agentListed(shown.protocol)) return;
    const accountId = shownAccountId;
    if (accountId === null) return;
    void store.probeModels(shown.id, accountId);
  });

  // Keep the shown provider visible in the vertical rail or phone strip.
  $effect(() => {
    const current = favoritesOpen ? 'favorites' : shown?.id;
    if (!popover.shown || !menu || !current) return;
    const rail = menu.querySelector<HTMLElement>('[data-testid=picker-rail-tiles]');
    const tile = rail?.querySelector<HTMLElement>(`[data-provider="${current}"]`);
    if (!rail || !tile) return;
    const railBox = rail.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    if (!window.matchMedia('(max-width: 720px)').matches) {
      if (tileBox.bottom > railBox.bottom) rail.scrollTop += tileBox.bottom - railBox.bottom;
      else if (tileBox.top < railBox.top) rail.scrollTop -= railBox.top - tileBox.top;
      return;
    }
    const visibleRight = railBox.right - (parseFloat(getComputedStyle(rail).paddingRight) || 0);
    if (tileBox.right > visibleRight) rail.scrollLeft += tileBox.right - visibleRight;
    else if (tileBox.left < railBox.left) rail.scrollLeft -= railBox.left - tileBox.left;
  });

  let currentModels = $derived(shownModels.filter((m) => !m.legacy));
  let legacyModels = $derived(shownModels.filter((m) => m.legacy));

  // An ACP agent can list hundreds of models (OpenCode answered 534 here), and a
  // plain scroll is useless at that length: group by the `provider/` prefix.
  let grouped = $derived(shownModels.length > SEARCH_FROM || shownModels.some(model => modelSource(model) !== ''));
  let searchable = $derived(!favoritesOpen && !needsInstall);
  let words = $derived(
    searchable ? modelQuery.toLowerCase().split(/\s+/).filter((word) => word.length > 0) : []
  );

  function matches(model: ModelInfo): boolean {
    if (words.length === 0) return true;
    const hay = `${model.id} ${model.name}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  }

  /** A matching default stays above long lists; filtering never changes the selection. */
  let pinnedModel = $derived.by((): ModelInfo | null => {
    if (!grouped || !shown) return null;
    const id = store.defaultModelOf(shown);
    return shownModels.find((m) => m.id === id && matches(m)) ?? null;
  });

  let filteredCurrent = $derived(
    (words.length ? shownModels : currentModels).filter((m) => m.id !== pinnedModel?.id && matches(m))
  );
  let filteredLegacy = $derived(words.length ? [] : legacyModels);

  // Nothing typed on a long list: its first rows, the current model and a show-all row.
  let expandedFor = $state<string | null>(null);
  let capped = $derived(expandedFor !== shown?.id && words.length === 0 && filteredCurrent.length > FIRST_MODELS);
  let groups = $derived(groupModels(capped ? firstModels(filteredCurrent, isCurrentModel) : filteredCurrent));

  function isCurrentModel(model: ModelInfo): boolean {
    return shown !== null && choice?.providerId === shown.id && choice?.model === model.id;
  }

  // Desktop can type immediately. Phones keep their keyboard closed until tapped.
  $effect(() => {
    if (!popover.open || !searchable) return;
    focusInitial(searchBox, menu);
  });

  /** Each opening starts on the favorites when there are some, else on the choice's provider. */
  export function reset() {
    shownProviderId = choice?.providerId ?? null;
    favoritesOpen = !single && favorites.length > 0;
    legacy.hide();
    modelQuery = '';
    expandedFor = null;
  }
  reset();

  /** A tile only moves the column: the choice follows a model or an account chip. */
  function pickTile(providerId: string) {
    pickEpoch += 1;
    pickPending = false;
    favoritesOpen = false;
    shownProviderId = providerId;
    legacy.hide();
    modelQuery = '';
  }

  function pickSeat(seat: Account) {
    if (!shown) return;
    modelQuery = '';
    return applyPick({ providerId: shown.id, accountId: seat.id }, undefined, false);
  }

  /** A signed-out account signs in again where the composer's reconnect chip sends it. */
  function signInSeat(seat: Account) {
    popover.hide();
    store.openConnect(seat.providerId, seat.id);
  }

  function pickModel(model: ModelInfo) {
    if (!shown) return;
    const instance =
      choice && choice.providerId === shown.id
        ? { providerId: choice.providerId, accountId: choice.accountId }
        : firstInstanceOf(shown.id);
    if (instance) return applyPick(instance, model.id);
  }

  /**
   * Installing and signing in happen on the Providers page, so the picker sends
   * the owner there; a phone has no such page, so it offers no way to it.
   */
  const phoneWidth = new MediaQuery('(max-width: 720px)');
  let providersReachable = $derived(store.owner && desktopSettings(phoneWidth.current));
  function openInstall() {
    popover.hide();
    store.showSettings('accounts');
  }

  function firstInstanceOf(providerId: string): { providerId: string; accountId: string } | null {
    const entry = store.providerOf(providerId);
    if (!entry || !entry.available || !store.providerOn(providerId)) return null;
    const seat = store.usableAccountOf(providerId) ?? store.accountsOf(providerId)[0];
    return seat ? { providerId, accountId: seat.id } : null;
  }

  /** It hangs off its own chip, its start edge on the chip's. In the composer it opens up over the chip, as the
   * effort and permission menus do; elsewhere (a setting's picker) under it, room allowing. */
  const anchorBox = (): HTMLElement | null => root() ?? null;
  const placement = $derived(root()?.closest('[data-testid=composer]') ? 'top' as const : undefined);

  /** The keys of the whole picker; the chip hands its own to it. */
  const onkeydown = pickerKeydown({
    get popover() { return popover; },
    legacy,
    root: () => root(),
    menu: () => menu,
    searchBox: () => searchBox,
    legacyOpen: () => legacyOpen,
    searchable: () => searchable,
    modelQuery: () => modelQuery,
    clearQuery: () => { modelQuery = ''; }
  });

  export function keydown(event: KeyboardEvent) {
    onkeydown(event);
  }
</script>

<div
  class="popover"
  class:closing={popover.closing}
  class:single
  role="menu"
  tabindex="-1"
  aria-label={strings.composer.picker}
  data-testid="composer-picker-menu"
  bind:this={menu}
  use:floating={{ anchor: anchorBox, placement, dismiss: () => popover.hide() }}
  use:popover.attach
  onanimationend={popover.end}
  {onkeydown}
>
  {#snippet refresh()}
    <button class="refresh" type="button" data-testid="picker-refresh" aria-label={strings.composer.refreshModels} title={strings.composer.refreshModels} disabled={disabled || refreshing || pickPending || (!favoritesOpen && needsInstall)} onclick={() => void refreshModels()}><RefreshCw size={14} class={refreshing || pickPending ? 'spin' : ''} /></button>
  {/snippet}
  {#if single}
    {@render refresh()}
  {:else}
    <div class="rail-cell">
      <ProviderTiles {store} {choice} {locked} current={shown?.id ?? null} {favoritesOpen} onfavorites={() => { favoritesOpen = true; modelQuery = ''; }} onpick={pickTile} onmore={providersReachable ? openInstall : undefined} foot={refresh} />
    </div>
  {/if}

  <div class="column models main-models">
    {#snippet modelRow(model: ModelInfo)}
      <div class="model-entry" class:current={isCurrentModel(model)}>
      <button
        type="button"
        class="row model"
        class:current={isCurrentModel(model)}
        role="menuitem"
        aria-current={isCurrentModel(model) || undefined}
        data-row
        data-model={model.id}
        title={model.id}
        disabled={disabled || pickPending}
        onclick={() => pickModel(model)}
      >
        <span class="mark" aria-hidden="true">{#if isCurrentModel(model)}<Check size={14} />{/if}</span>
        <span class="name ui-label">{model.name}</span>
        {#if model.badge === 'new'}
          <span class="badge ui-label-box"><span class="ui-label">{strings.composer.newBadge}</span></span>
        {/if}
      </button>
      {#if store.owner}
        <button type="button" class="favorite-button" data-testid="model-favorite" data-favorite-model={model.id} aria-label={favorite(model) ? strings.composer.unfavorite : strings.composer.favorite} aria-pressed={favorite(model)} onclick={() => { if (shown && shownAccountId) store.toggleFavorite(shown.id, shownAccountId, model); }}><Star size={14} fill={favorite(model) ? 'currentColor' : 'none'} /></button>
      {:else if favorite(model)}
        <span class="favorite-button favorite-mark" aria-hidden="true"><Star size={14} fill="currentColor" /></span>
      {/if}
      </div>
    {/snippet}

    {#if favoritesOpen}
      <div class="head"><span class="provider-name ui-label">{strings.composer.favorites}</span></div>
      <div class="model-list">
      {#each favorites as entry (`${entry.providerId}:${entry.accountId}:${entry.model.id}`)}
        <div class="model-entry">
          <button type="button" class="row model favorite-row" role="menuitem" data-row data-testid="favorite-model" title={entry.model.id} disabled={disabled || pickPending || !store.providerOf(entry.providerId)?.available} onclick={() => void pickFavorite(entry)}>
            <ProviderLogo providerId={entry.providerId} size={16} /><span class="name">{store.modelsOf(entry.providerId, entry.accountId).find(m => m.id === entry.model.id)?.name ?? entry.model.name}{#if modelSource(entry.model)}<span class="account-label">{modelSource(entry.model)}</span>{/if}{#if favorites.some(other => other.providerId === entry.providerId && other.model.id === entry.model.id && other.accountId !== entry.accountId)}<span class="account-label">{store.accountOf(entry.accountId)?.label}</span>{/if}</span>
          </button>
          {#if store.owner}
            <button type="button" class="favorite-button" aria-label={strings.composer.unfavorite} onclick={() => store.toggleFavorite(entry.providerId, entry.accountId, entry.model)}><Star size={14} fill="currentColor" /></button>
          {:else}
            <span class="favorite-button favorite-mark" aria-hidden="true"><Star size={14} fill="currentColor" /></span>
          {/if}
        </div>
      {:else}<p class="none subtle" data-testid="favorites-empty">{strings.composer.favoritesEmpty}</p>{/each}
      </div>
    {:else}
    <div class="head provider-head">
      <AccountSeats name={shown ? shown.name : strings.composer.models} {shown} {seats} {shownAccountId} {choice} {locked} {disabled} busy={disabled || pickPending} onpick={pickSeat} onsignin={store.owner ? signInSeat : undefined} />
      <!-- The search shares the name's line, so the list keeps that row for models. -->
      {#if !needsInstall && !pending}<div class="head-search"><ModelSearch bind:value={modelQuery} bind:input={searchBox} /></div>{/if}
    </div>
    {#key `${shown?.id}:${shownAccountId}`}
    <div class="model-list">
    {#if locked && seats.length > 1}
      <span class="locked-note">{strings.composer.lockedHint}</span>
    {/if}

    {#if needsInstall}
      <p class="none subtle" data-testid="picker-not-installed">{strings.composer.notInstalled}</p>
      <!-- The Providers page is `accounts.*` and `providers.install`, and
           desktop only, so a device or a phone is told the provider is
           missing and nothing more. -->
      {#if providersReachable}
        <button
          type="button"
          class="quiet small to-settings"
          data-testid="picker-install-settings"
          onclick={openInstall}
        >
          <span class="ui-label">{strings.composer.installInSettings}</span>
        </button>
      {/if}
    {:else if pending}
      <!-- The first answer is on its way: the descriptor's list would jump
           to another one, so the column holds placeholders until it lands.
           The reading line comes first, where a short phone column still shows it. -->
      <p class="none subtle probing first" data-testid="picker-probing">{strings.composer.probing}</p>
      <div class="skeletons" aria-hidden="true">
        {#each [0, 1, 2] as index (index)}<span class="skeleton"></span>{/each}
      </div>
    {:else}
      {#if grouped}
        {#if pinnedModel}
          {@render modelRow(pinnedModel)}
        {/if}
        {#each groups as group (group.key)}
          {#if group.key}
            <span class="section-label group" data-group={group.key}>{group.key}</span>
          {/if}
          {#each group.models as model (model.id)}
            {@render modelRow(model)}
          {/each}
        {/each}
        {#if capped}
          <button type="button" class="row fold small" data-row data-testid="picker-show-all" onclick={() => { expandedFor = shown?.id ?? null; focusInitial(searchBox, menu); }}><span class="ui-label">{fill(strings.composer.showAllModels, { count: String(filteredCurrent.length) })}</span></button>
        {/if}
      {:else}
        {#each filteredCurrent as model (model.id)}
          {@render modelRow(model)}
        {/each}
      {/if}
      {#if !pinnedModel && filteredCurrent.length === 0 && (modelQuery.trim() !== '' || (shownModels.length === 0 && !probing))}
        <p class="none subtle" data-testid="picker-no-models">{shownModels.length === 0 ? strings.composer.noModelsAvailable : strings.composer.noModels}</p>
      {/if}

      {#if filteredLegacy.length > 0}
        <button
          type="button"
          class="row fold small"
          data-row
          data-testid="picker-legacy"
          aria-expanded={legacyOpen}
          onclick={() => legacy.toggle()}
        >
          <span class="name muted ui-label">{strings.composer.legacyModels}</span>
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      {/if}
      {#if probing}
        <p class="none subtle probing" data-testid="picker-probing">{strings.composer.probing}</p>
      {/if}
    {/if}
    </div>
    {/key}
    {/if}
  </div>
</div>
{#if popover.shown && legacy.shown && !favoritesOpen && !pending && filteredLegacy.length > 0}
<div class="popover legacy-menu" class:closing={legacy.closing} role="menu" tabindex="-1" data-testid="picker-legacy-menu" aria-label={strings.composer.legacyModels} use:legacy.attach onanimationend={legacy.end} use:floating={{ anchor: () => menu ?? null, side: 'right' }} {onkeydown}>
  <div class="column models">
    <div class="head"><button type="button" class="icon-button legacy-back" aria-label={strings.settings.back} onclick={() => legacy.hide()}><ChevronRight size={14} style="transform: rotate(180deg)" /></button><span class="provider-name ui-label">{strings.composer.legacyModels}</span></div>
            {#each filteredLegacy as model (model.id)}
              <div class="model-entry" class:current={isCurrentModel(model)}>
              <button
                type="button"
                class="row model legacy"
                class:current={isCurrentModel(model)}
                role="menuitem"
                tabindex={legacyOpen ? 0 : -1}
                data-row={legacyOpen || undefined}
                data-model={legacyOpen ? model.id : undefined}
                title={model.id}
                disabled={disabled || pickPending}
                onclick={() => pickModel(model)}
              >
                <span class="mark" aria-hidden="true">{#if isCurrentModel(model)}<Check size={14} />{/if}</span>
                <span class="name ui-label">{model.name}</span>
              </button>
              {#if store.owner}
                <button type="button" class="favorite-button" tabindex={legacyOpen ? 0 : -1} aria-label={favorite(model) ? strings.composer.unfavorite : strings.composer.favorite} aria-pressed={favorite(model)} onclick={() => { if (shown && shownAccountId) store.toggleFavorite(shown.id, shownAccountId, model); }}><Star size={14} fill={favorite(model) ? 'currentColor' : 'none'} /></button>
              {:else if favorite(model)}
                <span class="favorite-button favorite-mark" aria-hidden="true"><Star size={14} fill="currentColor" /></span>
              {/if}
              </div>
            {/each}
  </div>
</div>
{/if}

<style>
  /* A model's row and its star are one entry: the hover and the current model's fill span both. */
  .model-entry { display: flex; align-items: center; border-radius: var(--radius-overlay-row); }
  .model-entry .model { flex: 1; min-width: 0; }
  .model-entry.current { background: var(--color-accent-soft); }
  .model-entry:not(.current):has(> .row:focus-visible) { background: var(--color-hover); }
  @media (hover: hover) {
    .model-entry:not(.current):hover:has(> .row:not(:disabled)) { background: var(--color-hover); }
    .model-entry > .row:hover:not(:disabled) { background: transparent; }
  }
  .model-entry > .row:focus-visible { background: transparent; }
  /* The star's target is a control's box (44 px on a phone), its glyph keeps its size, the row its height. */
  .favorite-button { display: inline-flex; align-items: center; justify-content: center; width: var(--control); height: var(--control); padding: 0; flex: none; color: var(--color-muted-foreground); background: transparent; border: none; }
  .favorite-button[aria-pressed='true'] { color: var(--color-foreground); }
  /** A paired device reads the owner's stars without changing them. */
  .favorite-mark { display: inline-flex; align-items: center; justify-content: center; color: var(--color-foreground); }
  .account-label { margin-left: 8px; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .row.favorite-row { min-height: 42px; }
  .popover.legacy-menu { width: min(320px, calc(100vw - 24px)); height: auto; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); z-index: 41; }
  .popover {
    position: fixed;
    z-index: 40;
    display: grid;
    grid-template-columns: calc(var(--control-lg) + 20px) minmax(0, 1fr);
    width: min(440px, calc(100vw - 32px));
    /* One size whichever provider is picked: a short list leaves room, a long one scrolls, and nothing
       jumps under the pointer between two rail tiles. */
    height: min(360px, 45dvh);
    grid-template-rows: minmax(0, 1fr);
    /* floating() puts the menu in the top layer as a [popover], whose 0.25em
       padding left the rail 7px short of its tiles. */
    padding: 0;
    /* Every menu's one card: its fill, edge, corner and shadow (app.css). */
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    animation: pop var(--dur-2) var(--ease-out-quint);
    transform-origin: top left;
    overflow: hidden;
  }

  .popover.closing {
    animation-name: pop-out;
    pointer-events: none;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }

  /* The rail's cell is as tall as the column beside it: its size containment keeps its tiles out of the menu's height. */
  .rail-cell {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    contain: size;
    background: var(--color-surface);
  }

  .models > * { flex-shrink: 0; }
  .main-models { grid-area: 1 / 2; overflow: hidden; padding: 0; gap: 0; border-left: 1px solid var(--color-border); }
  .main-models .head { flex-direction: column; align-items: stretch; justify-content: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--color-border); }
  /* The favorites' heading stands as tall as a provider's name line (AccountSeats). */
  .main-models .head > .provider-name { min-height: var(--control-sm); display: flex; align-items: center; }
  /* The provider's name, then the search filling the rest of its line. An open
     account list takes the head's width and puts the search under it. */
  .main-models .provider-head { flex-direction: row; align-items: center; gap: 8px; }
  .main-models .provider-head:has(:global(.accounts)) { flex-direction: column; align-items: stretch; }
  .head-search { flex: 1 1 120px; min-width: 0; }
  .head-search :global(.search-bar) { position: static; margin: 0; padding: 0; background: none; }
  .model-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; padding: 6px; }
  /* One provider: its model list is the whole popover, the refresh sits in the list's head. */
  .popover.single { grid-template-columns: minmax(0, 1fr); width: min(320px, calc(100vw - 32px)); height: auto; max-height: min(360px, 45dvh); }
  .single .main-models { grid-area: 1 / 1; border-left: none; }
  .single .main-models .head { padding-right: 44px; }
  .single .refresh { position: absolute; top: 4px; right: 4px; margin: 0; width: var(--control); height: var(--control); padding: 0; border: none; background: transparent; }
  .refresh { position: relative; z-index: 3; display: grid; place-items: center; width: var(--control-lg); height: var(--control-lg); margin-top: 2px; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-muted-foreground); }
  @media (hover: hover) { .refresh:hover:not(:disabled) { background: linear-gradient(var(--color-hover) 0 0), var(--color-surface); color: var(--color-foreground); } }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--control-sm);
    padding: 2px 4px 6px;
  }

  .provider-name {
    font-size: var(--text-base);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .locked-note {
    padding: 0 4px 6px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  .to-settings {
    align-self: flex-start;
    margin: 2px 0 0 4px;
  }

  .group {
    padding: 8px 8px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    min-height: var(--row);
    padding: 3px 8px;
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    white-space: normal;
  }

  /* The keyboard's row wears the accent ring inside its box (app.css); a finger's tap leaves no fill behind. */
  .row:focus-visible {
    background: var(--color-hover);
  }
  @media (hover: hover) {
    .row:hover:not(:disabled) { background: var(--color-hover); }
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .row:active:not(:disabled) {
    transform: none;
    background: color-mix(in srgb, var(--color-surface-3) 85%, var(--color-foreground));
  }

  /* The current model wears every menu's selection form (Menu.svelte): the accent check and the selected fill. */
  .mark {
    display: inline-flex;
    flex: none;
    width: 14px;
    justify-content: center;
    color: var(--color-accent);
  }


  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model .name {
    flex: 1;
  }

  .legacy .name {
    font-weight: 400;
    color: var(--color-muted-foreground);
  }

  .badge {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 1px 5px;
    border-radius: 999px;
    border: 1px solid var(--color-edge);
    color: var(--color-muted-foreground);
  }

  .fold {
    margin-top: 4px;
    min-height: var(--control);
  }

  p.none {
    padding: 6px 8px;
    font-size: var(--text-sm);
  }

  /* The agent is being asked for its models; on a refresh the listed ones stay above. */
  p.probing {
    margin-top: 2px;
    font-size: var(--text-sm);
  }
  p.probing.first { margin: 0 0 4px; }

  /* Placeholder rows while the first answer is read, the size of a model row. */
  .skeletons { display: flex; flex-direction: column; gap: 1px; }
  .skeleton {
    display: block;
    min-height: var(--row);
    margin: 0 8px;
    border-radius: var(--radius-sm);
    background: var(--color-hover);
    animation: breathe calc(var(--dur-whip) * 3) var(--ease-out-quint) infinite alternate var(--loops);
  }
  .skeleton:nth-child(2) { margin-right: 25%; }
  .skeleton:nth-child(3) { margin-right: 40%; }
  @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
  :global(html[data-motion='reduced']) .skeleton { animation: none; }

  @media (max-width: 720px) {
    .popover {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      width: calc(100vw - 24px);
      height: min(460px, 62dvh);
      /* The sheet runs edge to edge: the rail strip and the list keep off its sides. */
      padding-inline: var(--space-1);
    }

    /* The strip across the top: as tall as its tiles, as wide as the sheet. */
    .rail-cell {
      grid-area: 1 / 1;
      contain: inline-size;
      border-bottom: 1px solid var(--color-border);
    }

    /* The rail is the finger's first stop on a phone, so its tiles (ProviderTiles)
       and the refresh button take a full touch target like every other control. */
    .main-models { grid-area: 2 / 1; border-left: none; }
    /* The refresh ends the logo strip on its ground, no box of its own. */
    .refresh {
      width: var(--touch-target);
      height: var(--touch-target);
      margin: 0;
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
    }
    .popover.single { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); height: auto; max-height: min(460px, 62dvh); }
    .single .main-models { grid-area: 1 / 1; }
    .single .main-models .head { padding-right: calc(var(--touch-target) + 8px); }
    /* Show all and Legacy models are rows a finger takes like any other. */
    .fold { min-height: var(--touch-target); }
    .single .refresh { top: 0; right: 0; }
  }
</style>
