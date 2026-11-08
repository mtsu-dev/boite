<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Check, ChevronRight, Star, RefreshCw } from '@lucide/svelte';
  import { isNamedModel, orderedModels } from '../lib/model-order';
  import { shortlist, type ShortModel } from '../lib/model-shortlist';
  import type { Account, ModelInfo } from '@boite/contracts';
  import AccountSeats from './AccountSeats.svelte';
  import ModelSearch from './ModelSearch.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import ProviderTiles from './ProviderTiles.svelte';
  import PickerMore from './PickerMore.svelte';
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
   * (`ModelPicker.svelte`) draws it. Two levels. The first lists the models in
   * use (stars, then the latest threads' models, `lib/model-shortlist.ts`),
   * one row each, and one "All models" row. The second is the full frame:
   * providers beside a scrolling model list, the provider's logins beside its
   * name. A click on a model closes the picker; nothing else does.
   * `settings` holds the composer's effort row and its More row (`PickerMore`)
   * under either level. Desktop anchors it to its chip; a phone gets the same
   * bottom sheet as its other menus, grabber and title on top.
   */
  let {
    store,
    choice,
    popover,
    root,
    locked = false,
    single = false,
    disabled = false,
    anchor,
    settings,
    onpick
  }: {
    store: Store;
    choice: Choice | null;
    /** The chip's open state: this body mounts while it is shown. */
    popover: Closing;
    /** The chip's root, which holds this body: the keys and the anchor read it. */
    root: () => HTMLElement | undefined;
    locked?: boolean;
    single?: boolean;
    disabled?: boolean;
    anchor?: () => HTMLElement | null;
    settings?: Snippet<[typeof PickerMore]>;
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
  /** The first level (the models in use) or every provider's list. */
  let level = $state<'home' | 'all'>('all');
  let pickPending = $state(false);
  // Nothing typed on a long list: its first rows, the current model and a show-all row.
  let expandedFor = $state<string | null>(null);
  const favoriteSet = $derived.by(() => favoriteIds(store.favorites, shown?.id, shownAccountId));

  /** Each opening starts on the models in use, or on the choice's column when there are not two of them to pick from. */
  export function reset() {
    shownProviderId = choice?.providerId ?? null;
    level = hasHome ? 'home' : 'all';
    legacy.hide();
    modelQuery = '';
    expandedFor = null;
  }

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

  /**
   * The first level's rows. A row is drawn only where a click lands: its
   * provider is offered and its account lists the model. A held choice
   * (`locked`) keeps the rows of its own account.
   */
  let home = $derived.by((): ShortModel[] => {
    if (single) return [];
    const find = (providerId: string, accountId: string, modelId: string): ModelInfo | null => {
      if (!store.providerOn(providerId)) return null;
      // The current choice reads as the chip does, even before its account's list is read.
      const own = choice && choice.providerId === providerId && choice.accountId === accountId ? store.modelOf({ ...choice, model: modelId }) : null;
      const model = store.modelsOf(providerId, accountId).find((entry) => entry.id === modelId) ?? own;
      return model && isNamedModel(model) ? model : null;
    };
    const rows = shortlist(store.favorites, store.threads, choice && { ...choice, model: choiceModel }, find);
    return locked ? rows.filter((row) => row.providerId === choice?.providerId && row.accountId === choice?.accountId) : rows;
  });
  /** A choice left on its provider's default still names the model it runs. */
  let choiceModel = $derived.by(() => {
    if (!choice) return null;
    const provider = store.providerOf(choice.providerId);
    return choice.model ?? (provider ? store.defaultModelOf(provider, choice.accountId) : null);
  });
  /** One row alone is no choice: the picker then opens on the full list. */
  let hasHome = $derived(home.length >= 2);
  reset();

  function isChoice(row: ShortModel): boolean {
    return choice?.providerId === row.providerId && choice.accountId === row.accountId && choiceModel === row.model.id;
  }

  /** Several providers among the rows: two rows of one name then say whose each is. */
  let mixed = $derived(new Set(home.map((row) => row.providerId)).size > 1);
  /**
   * The row's quiet text, only where a name alone is not enough: the login
   * when its provider has two, and the provider or gateway route when another
   * row bears the same name. A row of its own needs none.
   */
  function sourceOf(row: ShortModel): string {
    const parts: string[] = [];
    if (home.some((other) => other !== row && other.model.name === row.model.name)) {
      if (mixed) parts.push(store.providerOf(row.providerId)?.name ?? row.providerId);
      const route = modelSource(row.model);
      if (route) parts.push(route);
    }
    if (store.accountsOf(row.providerId).length > 1) {
      const account = store.accountOf(row.accountId);
      if (account && account.isolationDir !== null && account.label) parts.push(account.label);
    }
    return parts.join(' · ');
  }

  function openAll() {
    level = 'all';
    modelQuery = '';
  }

  function backHome() {
    pickEpoch += 1;
    pickPending = false;
    level = 'home';
    legacy.hide();
    modelQuery = '';
  }

  let provider = $derived(choice ? store.providerOf(choice.providerId) : null);
  /** A provider turned off has no tile: the row's first one shows instead. */
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

  async function refreshModels() {
    if (shown && shownAccountId) await store.probeModels(shown.id, shownAccountId, true);
  }

  // An ACP agent owns its model list, so the descriptor cannot carry it: the
  // core reads it from one short-lived agent process. Reopening also refreshes
  // a catalog whose cached answer has expired.
  // Nothing is asked of a provider whose executable is not on the machine.
  $effect(() => {
    if (!popover.open || level === 'home' || !shown || needsInstall) return;
    if (!agentListed(shown.protocol)) return;
    const accountId = shownAccountId;
    if (accountId === null) return;
    void store.probeModels(shown.id, accountId);
  });

  // Keep the shown provider visible in the phone's sideways row (a desktop's wraps, every tile in view).
  $effect(() => {
    const current = level === 'all' ? shown?.id : null;
    if (!popover.shown || !menu || !current) return;
    const rail = menu.querySelector<HTMLElement>('.rail');
    const tile = rail?.querySelector<HTMLElement>(`[data-provider="${current}"]`);
    if (!rail || !tile) return;
    const railBox = rail.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    const visibleRight = railBox.right - (parseFloat(getComputedStyle(rail).paddingRight) || 0);
    if (tileBox.right > visibleRight) rail.scrollLeft += tileBox.right - visibleRight;
    else if (tileBox.left < railBox.left) rail.scrollLeft -= railBox.left - tileBox.left;
  });

  let currentModels = $derived(shownModels.filter((m) => !m.legacy));
  let legacyModels = $derived(shownModels.filter((m) => m.legacy));

  // An ACP agent can list hundreds of models (OpenCode answered 534 here), and a
  // plain scroll is useless at that length: group by the `provider/` prefix.
  let grouped = $derived(shownModels.length > SEARCH_FROM || shownModels.some(model => modelSource(model) !== ''));
  let searchable = $derived(level === 'all' && !needsInstall);
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
  // The first level has no field: the keys start on the current row, so arrows, Enter and Escape work at once.
  $effect(() => {
    if (!popover.open || level !== 'home') return;
    focusInitial(menu?.querySelector<HTMLElement>('.short-list .row.current') ?? menu?.querySelector<HTMLElement>('.short-list [data-row]:not(:disabled)'), menu);
  });

  /** A tile only moves the column: the choice follows a model or an account chip. */
  function pickTile(providerId: string) {
    pickEpoch += 1;
    pickPending = false;
    shownProviderId = providerId;
    legacy.hide();
    modelQuery = '';
  }

  function pickSeat(seat: Account) {
    if (!shown) return;
    modelQuery = '';
    return applyPick({ providerId: shown.id, accountId: seat.id }, undefined, false);
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

  /**
   * What the desktop popover opens above: the whole composer around the chip,
   * so it covers neither a docked ask nor the text being written; a chip
   * outside a composer (an agent's settings) is its own anchor.
   */
  function anchorBox(): HTMLElement | null {
    return anchor?.() ?? root()?.closest<HTMLElement>('[data-testid="composer"]') ?? root() ?? null;
  }

  /**
   * Which edge the popover shares with its anchor: the chip's side, so it
   * opens over its chip (at the composer's end while an ask is docked).
   * Read at each placement (a getter): the ask can leave while the picker is open.
   */
  function chipSide(): 'start' | 'end' {
    const chip = root()?.getBoundingClientRect();
    const box = anchorBox()?.getBoundingClientRect();
    if (!chip || !box) return 'start';
    return chip.left + chip.width / 2 > box.left + box.width / 2 ? 'end' : 'start';
  }

  /** The keys of the whole picker; the chip hands its own to it. */
  export const keydown = pickerKeydown({
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
</script>

<div
  class="popover"
  class:closing={popover.closing}
  class:single
  class:home={level === 'home'}
  role="menu"
  tabindex="-1"
  aria-label={strings.composer.picker}
  data-testid="composer-picker-menu"
  bind:this={menu}
  use:floating={{ anchor: anchorBox, placement: 'top', get align() { return chipSide(); }, cap: 560, dismiss: () => popover.hide() }}
  use:popover.attach
  onanimationend={popover.end}
  onkeydown={keydown}
>
  <!-- A phone sheet's title, as on its other sheets; the chip names the model on desktop. -->
  <span class="sheet-title ui-label">{strings.composer.model}</span>
  {#if level === 'home'}
  <div class="column models short-list" data-testid="picker-shortlist">
    <!-- Name and provider only: stars are set under All models. -->
    {#each home as row (`${row.providerId}:${row.accountId}:${row.model.id}`)}
      <button type="button" class="row model" class:current={isChoice(row)} role="menuitem" data-row data-testid={row.favorite ? 'favorite-model' : 'recent-model'}
        title={row.model.id} disabled={disabled || pickPending || !store.providerOf(row.providerId)?.available} onclick={() => void applyPick(row, row.model.id)}>
        <span class="mark" aria-hidden="true">{#if isChoice(row)}<Check size={14} strokeWidth={2.25} />{/if}</span>
        <span class="name ui-label">{row.model.name}</span>
        {#if sourceOf(row)}<span class="source ui-label">{sourceOf(row)}</span>{/if}
      </button>
    {/each}
    <button type="button" class="row fold all" data-row data-testid="picker-all-models" onclick={openAll} onkeydown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); openAll(); } }}>
      <!-- The check's empty column: "All models" starts where the model names do. -->
      <span class="mark" aria-hidden="true"></span>
      <span class="name ui-label">{strings.composer.allModels}</span>
      <ChevronRight size={14} strokeWidth={2} />
    </button>
  </div>
  {:else}
  <button class="refresh" type="button" data-testid="picker-refresh" aria-label={strings.composer.refreshModels} title={strings.composer.refreshModels} disabled={disabled || probing || pickPending || needsInstall} onclick={() => void refreshModels()}><RefreshCw size={14} class={probing || pickPending ? 'spin' : ''} /></button>
  {#if !single}
    <div class="column rail">
      <ProviderTiles {store} {choice} {locked} current={shown?.id ?? null} onback={hasHome ? backHome : undefined} onpick={pickTile} onmore={providersReachable ? openInstall : undefined} />
    </div>
  {/if}

  <div class="column models main-models">
    {#snippet modelRow(model: ModelInfo)}
      <div class="model-entry">
      <button
        type="button"
        class="row model"
        class:current={isCurrentModel(model)}
        role="menuitem"
        data-row
        data-model={model.id}
        title={model.id}
        disabled={disabled || pickPending}
        onclick={() => pickModel(model)}
      >
        <span class="mark" aria-hidden="true">{#if isCurrentModel(model)}<Check size={14} strokeWidth={2.25} />{/if}</span>
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

    <!-- The row of providers already names the one shown: its head is for a provider with two logins (which one), or for one provider alone. -->
    {#if single || seats.length > 1}
    <div class="head">
      <span class="provider-name ui-label">{shown ? shown.name : strings.composer.models}</span>
      <AccountSeats {shown} {seats} {shownAccountId} {choice} {locked} busy={disabled || pickPending} onpick={pickSeat} />
    </div>
    {/if}
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
      <ModelSearch bind:value={modelQuery} bind:input={searchBox} />
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
  </div>
  {/if}
  {#if settings}<div class="settings" data-picker-settings>{@render settings(PickerMore)}</div>{/if}
</div>
{#if popover.shown && legacy.shown && level === 'all' && !pending && filteredLegacy.length > 0}
<div class="popover legacy-menu" class:closing={legacy.closing} role="menu" tabindex="-1" data-testid="picker-legacy-menu" aria-label={strings.composer.legacyModels} use:legacy.attach onanimationend={legacy.end} use:floating={{ anchor: () => menu ?? null, side: 'right' }} onkeydown={keydown}>
  <div class="column models">
    <div class="head"><button type="button" class="icon small legacy-back" aria-label={strings.settings.back} onclick={() => legacy.hide()}><ChevronRight size={14} style="transform: rotate(180deg)" /></button><span class="provider-name ui-label">{strings.composer.legacyModels}</span></div>
            {#each filteredLegacy as model (model.id)}
              <div class="model-entry">
              <button
                type="button"
                class="row model legacy"
                class:current={isCurrentModel(model)}
                role="menuitem"
                tabindex={legacyOpen ? 0 : -1}
                data-row={legacyOpen || undefined}
                data-model={legacyOpen ? model.id : undefined}
                title={model.id}
                onclick={() => pickModel(model)}
              >
                <span class="mark" aria-hidden="true">{#if isCurrentModel(model)}<Check size={14} strokeWidth={2.25} />{/if}</span>
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
  .model-entry { display: flex; align-items: center; }
  .model-entry .model { flex: 1; min-width: 0; }
  .favorite-button { width: var(--control-sm); height: var(--control-sm); padding: 0; flex: none; color: var(--color-muted-foreground); background: transparent; border: none; }
  .favorite-button[aria-pressed='true'] { color: var(--color-foreground); }
  /** A paired device reads the owner's stars without changing them. */
  .favorite-mark { display: inline-flex; align-items: center; justify-content: center; color: var(--color-foreground); }
  /* The first level stacks its title (phone), its rows and the effort: no grid areas to hold. */
  .popover.home { display: flex; flex-direction: column; }
  /* The first level has the phone sheet's air: the same rows, a finger tall, and room around them. */
  .home .short-list { padding: 8px; gap: 2px; }
  .home .short-list .row { min-height: var(--touch-target); padding: 4px 10px; }
  .home .settings { padding: 8px; gap: 4px; }
  .source { flex: 0 1 auto; min-width: 0; text-align: right; font-size: var(--text-sm); color: var(--color-subtle); }
  .all { color: var(--color-muted-foreground); }
  .all .name { flex: 1; font-weight: 400; }
  .sheet-title { display: none; }
  .popover.legacy-menu { width: min(320px, calc(100vw - 24px)); height: auto; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); z-index: 41; }
  /* One column on every width, read top to bottom: the title (a phone's),
     the providers in a row with the refresh at its end, their models, then
     the effort and the permission. No side column. */
  .popover {
    position: fixed;
    z-index: 40;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    width: min(400px, calc(100vw - 32px));
    /* Floating caps it to the room above. */
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-e2);
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

  /* The providers in a row; on a desktop they wrap, every one in view. */
  .rail {
    grid-area: 2 / 1;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 6px;
    overflow: visible;
  }

  .models > * { flex-shrink: 0; }
  .main-models { grid-area: 3 / 1 / 4 / 3; overflow: hidden; padding: 0; gap: 0; border-top: 1px solid var(--color-border); }
  .main-models .head { gap: 8px; padding: 6px 6px 6px 12px; border-bottom: 1px solid var(--color-border); }
  .main-models .head .provider-name { flex: 1; min-width: 0; }
  .model-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; padding: 6px; }
  .model-list { max-height: 300px; }
  .settings { grid-area: 4 / 1 / 5 / 3; display: flex; flex-direction: column; gap: 2px; padding: 6px; border-top: 1px solid var(--color-border); }
  /* One provider: no row of providers, its model list is the whole popover and the refresh sits at its top corner. */
  .popover.single { width: min(320px, calc(100vw - 32px)); }
  .single .main-models { grid-area: 2 / 1 / 4 / 3; border-top: none; }
  .single .main-models .head { padding-right: 44px; }
  .single .refresh { position: absolute; top: 6px; right: 6px; margin: 0; width: var(--control-sm); height: var(--control-sm); border: none; background: transparent; }
  .refresh { grid-area: 2 / 2; align-self: start; margin: 6px 6px 0 0; position: relative; z-index: 3; display: grid; place-items: center; width: var(--control-sm); height: var(--control-sm); padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); }
  @media (hover: hover) { .refresh:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); } }
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
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    white-space: normal;
  }

  .row:focus-visible {
    background: var(--color-hover);
  }

  /* A finger's last row kept its fill once the sheet closed and opened again. */
  @media (hover: hover) {
    .row:hover:not(:disabled) { background: var(--color-hover); }
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .row:active:not(:disabled) {
    transform: none;
    background: color-mix(in srgb, var(--color-surface-3) 85%, var(--color-foreground));
  }

  /* The current model's check, a small mark in the accent; the other rows keep its room so the names line up. */
  .mark {
    display: inline-flex;
    width: 14px;
    flex: none;
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
    padding: 1px 5px;
    border-radius: 999px;
    border: 1px solid var(--color-edge);
    color: var(--color-muted-foreground);
  }

  .fold {
    margin-top: 4px;
    min-height: var(--control-sm);
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
    /* The phone's bottom sheet: the same rows under its title, the providers
       scrolling sideways under a finger rather than wrapping. */
    .popover { width: calc(100vw - 24px); }
    .sheet-title { display: block; grid-area: 1 / 1 / 2 / 3; padding-bottom: var(--space-2); text-align: center; font-weight: 600; }
    .rail { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; touch-action: pan-x; padding: 8px; scrollbar-width: none; }
    .rail :global(.tile) { padding: 0 12px; }
    .refresh { align-self: center; margin: 0 6px 0 0; }
    .model-list { max-height: none; }
    .settings { padding: 8px; }
    .refresh, .single .refresh { width: var(--touch-target); height: var(--touch-target); }
    /* One provider: no rail, the refresh beside the title. */
    .single .refresh { position: static; grid-area: 1 / 2; align-self: start; margin: calc(var(--space-2) * -1) 6px 0 0; }
    .single .main-models { grid-area: 2 / 1 / 4 / 3; }
    .single .main-models .head { padding-right: 6px; }
    .short-list { padding: 0 8px 8px; }
    .short-list .row { min-height: var(--touch-target); }
  }
</style>