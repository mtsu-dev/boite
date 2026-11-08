<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Check, ChevronDown, ChevronRight, Star, RefreshCw } from '@lucide/svelte';
  import { isNamedModel, orderedModels } from '../lib/model-order';
  import { shortlist, type ShortModel } from '../lib/model-shortlist';
  import type { Account, ModelInfo, ProviderSummary } from '@boite/contracts';
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
  import { listedProviders } from '../lib/picker-providers';

  /**
   * The model picker's popover, its own chunk: only a click on the chip
   * (`ModelPicker.svelte`) draws it. One sheet, read top to bottom: a search
   * row (a query searches every provider's models; beside it the source of the
   * list), then the list. It picks a model and nothing else: the composer's
   * effort and permission are chips of their own. The list is the models in use (stars,
   * then the latest threads' models, `lib/model-shortlist.ts`) or one
   * provider's catalogue; the source button unfolds the providers in place,
   * so no level stacks a title over another. A click on a model closes the
   * picker; nothing else does. Desktop anchors it to its chip; a phone gets
   * the same bottom sheet as its other menus, its one title on top.
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
  /** The list: the models in use, or the shown provider's catalogue. */
  let level = $state<'home' | 'all'>('all');
  /** The providers unfolded in place under the search row. */
  let choosing = $state(false);
  let pickPending = $state(false);
  // Nothing typed on a long list: its first rows, the current model and a show-all row.
  let expandedFor = $state<string | null>(null);
  const favoriteSet = $derived.by(() => favoriteIds(store.favorites, shown?.id, shownAccountId));

  /** Each opening starts on the models in use, or on the choice's column when there are not two of them to pick from. */
  export function reset() {
    shownProviderId = choice?.providerId ?? null;
    level = hasHome ? 'home' : 'all';
    choosing = false;
    legacy.hide();
    modelQuery = '';
    expandedFor = null;
  }

  function favorite(model: ModelInfo, providerId = shown?.id, accountId = shownAccountId): boolean {
    return providerId === shown?.id && accountId === shownAccountId ? favoriteSet.has(model.id)
      : favoriteIds(store.favorites, providerId, accountId).has(model.id);
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

  /** The source button unfolds the sources over the list on screen, or folds them; a source row then changes the list. */
  function toggleSources() {
    choosing = !choosing;
    modelQuery = '';
  }

  function backHome() {
    pickEpoch += 1;
    pickPending = false;
    level = 'home';
    choosing = false;
    legacy.hide();
    modelQuery = '';
    afterSource();
  }

  /** The picked source row folds away with the focus on it: the keys go back to the search field (the source button on a touch screen). */
  function afterSource() {
    queueMicrotask(() => focusInitial(searchBox, menu?.querySelector<HTMLElement>('[data-testid=picker-all-models]') ?? menu));
  }

  let provider = $derived(choice ? store.providerOf(choice.providerId) : null);
  /** A provider turned off has no tile: the row's first one shows instead. */
  const offered = (id: string | null | undefined) => (id && store.providerOn(id) ? store.providerOf(id) : null);
  let shown = $derived(offered(shownProviderId) ?? offered(provider?.id) ?? store.offeredProviders[0] ?? null);
  /** The account the right column belongs to: an agent lists its models per login. */
  let shownAccountId = $derived(shown ? accountFor(shown.id) : null);
  /** The login a provider's list is read for: the choice's on its own provider, else the first usable one. */
  function accountFor(providerId: string): string | null {
    if (choice && choice.providerId === providerId) return choice.accountId;
    return (store.usableAccountOf(providerId) ?? store.accountsOf(providerId)[0])?.id ?? null;
  }
  let seats = $derived(shown ? store.accountsOf(shown.id) : []);
  /**
   * The files are still to download, so this provider has no models to offer
   * yet. An agent the user installed on their own is there whatever Boite's own
   * release says.
   */
  let needsInstall = $derived(shown ? installPending(shown) : false);
  function installPending(entry: ProviderSummary): boolean {
    if (entry.available) return false;
    const install = store.installOf(entry.id);
    return install !== null && install.state !== 'installed';
  }
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

  let currentModels = $derived(shownModels.filter((m) => !m.legacy));
  let legacyModels = $derived(shownModels.filter((m) => m.legacy));

  // An ACP agent can list hundreds of models (OpenCode answered 534 here), and a
  // plain scroll is useless at that length: group by the `provider/` prefix.
  let grouped = $derived(shownModels.length > SEARCH_FROM || shownModels.some(model => modelSource(model) !== ''));
  /** A query searches every provider's list; a picker held to one provider searches its own. */
  let global = $derived(!single);
  let searchable = $derived(global || !needsInstall);
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

  function isCurrentModel(model: ModelInfo, providerId = shown?.id): boolean {
    return providerId !== undefined && choice?.providerId === providerId && choice?.model === model.id;
  }

  /**
   * A query's answer across providers: each provider's matches under one
   * compact line naming it (and its login when it has two). A held choice
   * searches its own login only.
   */
  let found = $derived.by(() => {
    if (!global || words.length === 0) return [];
    const listed = listedProviders(store, choice);
    // The shown provider answers first: a query reads as a search of the list on screen, then of the rest.
    const providers = locked ? listed.filter((entry) => entry.id === choice?.providerId)
      : [...listed.filter((entry) => entry.id === shown?.id), ...listed.filter((entry) => entry.id !== shown?.id)];
    return providers.flatMap((entry) => {
      const accountId = accountFor(entry.id);
      if (installPending(entry) || !store.providerOn(entry.id)) return [];
      const models = orderedModels(store.modelsOf(entry.id, accountId)).filter(matches);
      if (models.length === 0) return [];
      const account = store.accountsOf(entry.id).length > 1 ? store.accountOf(accountId ?? '')?.label : undefined;
      const grouped = models.length > SEARCH_FROM || models.some((model) => modelSource(model) !== '');
      // As in a catalogue, a long list's own default leads whatever the query.
      const pinned = grouped ? models.find((model) => model.id === store.defaultModelOf(entry)) ?? null : null;
      const rest = pinned ? models.filter((model) => model !== pinned) : models;
      return [{ provider: entry, accountId, label: account ? `${entry.name} · ${account}` : entry.name, pinned, groups: grouped ? groupModels(rest) : [{ key: '', models }] }];
    });
  });

  // A query reads every agent's own list, once per login (the store keeps each answer).
  $effect(() => {
    if (!popover.open || !global || words.length === 0) return;
    for (const entry of listedProviders(store, choice)) {
      const accountId = accountFor(entry.id);
      if (accountId && agentListed(entry.protocol) && !installPending(entry) && store.providerOn(entry.id)) void store.probeModels(entry.id, accountId);
    }
  });

  // Desktop can type at once, the arrows going down into the rows. Phones keep their keyboard closed until tapped.
  $effect(() => {
    if (!popover.open || !searchable) return;
    focusInitial(searchBox, menu);
  });

  /** A tile only moves the column: the choice follows a model or an account chip. */
  function pickTile(providerId: string) {
    pickEpoch += 1;
    pickPending = false;
    shownProviderId = providerId;
    level = 'all';
    choosing = false;
    legacy.hide();
    modelQuery = '';
    afterSource();
  }

  function pickSeat(seat: Account) {
    if (!shown) return;
    modelQuery = '';
    return applyPick({ providerId: shown.id, accountId: seat.id }, undefined, false);
  }

  function pickModel(model: ModelInfo, providerId = shown?.id) {
    if (!providerId) return;
    const instance =
      choice && choice.providerId === providerId
        ? { providerId: choice.providerId, accountId: choice.accountId }
        : firstInstanceOf(providerId);
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

  /** The keys of the whole picker; the chip hands its own to it. Escape folds the providers first. */
  const pickerKeys = pickerKeydown({
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
    if (event.key === 'Escape' && choosing && popover.open && words.length === 0) {
      event.stopPropagation();
      choosing = false;
      menu?.querySelector<HTMLElement>('[data-testid=picker-all-models]')?.focus();
      return;
    }
    pickerKeys(event);
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
  use:floating={{ anchor: anchorBox, placement: 'top', get align() { return chipSide(); }, cap: 560, dismiss: () => popover.hide() }}
  use:popover.attach
  onanimationend={popover.end}
  onkeydown={keydown}
>
  {#snippet modelRow(model: ModelInfo, providerId: string | undefined, accountId: string | null)}
    <div class="model-entry">
    <button
      type="button"
      class="row model"
      class:current={isCurrentModel(model, providerId)}
      role="menuitem"
      data-row
      data-model={model.id}
      title={model.id}
      disabled={disabled || pickPending}
      onclick={() => pickModel(model, providerId)}
    >
      <span class="mark" aria-hidden="true">{#if isCurrentModel(model, providerId)}<Check size={14} />{/if}</span>
      <span class="name ui-label">{model.name}</span>
      {#if model.badge === 'new'}
        <span class="badge ui-label-box"><span class="ui-label">{strings.composer.newBadge}</span></span>
      {/if}
    </button>
    {#if store.owner}
      <button type="button" class="favorite-button" data-testid="model-favorite" data-favorite-model={model.id} aria-label={favorite(model, providerId, accountId) ? strings.composer.unfavorite : strings.composer.favorite} aria-pressed={favorite(model, providerId, accountId)} onclick={() => { if (providerId && accountId) store.toggleFavorite(providerId, accountId, model); }}><Star size={14} fill={favorite(model, providerId, accountId) ? 'currentColor' : 'none'} /></button>
    {:else if favorite(model, providerId, accountId)}
      <span class="favorite-button favorite-mark" aria-hidden="true"><Star size={14} fill="currentColor" /></span>
    {/if}
    </div>
  {/snippet}

  <!-- A phone sheet's one title, as on its other sheets; the chip names the model on desktop. -->
  <span class="sheet-title">{strings.composer.model}</span>
  <!-- One row on top: the search across providers, the list's source, and its refresh while a catalogue shows. -->
  <div class="find">
    {#if !(single && needsInstall)}<ModelSearch bind:value={modelQuery} bind:input={searchBox} />{/if}
    {#if !single}
      <button type="button" class="source" data-testid="picker-all-models" aria-expanded={choosing} title={strings.composer.allModels}
        onclick={toggleSources} onkeydown={(event) => { if (event.key === 'ArrowRight' && !choosing) { event.preventDefault(); toggleSources(); } }}>
        {#if level === 'all' && shown}<ProviderLogo providerId={shown.id} size={14} />{/if}
        <span class="ui-label">{level === 'all' && shown ? shown.name : strings.composer.yourModels}</span>
        <ChevronDown size={14} strokeWidth={2} />
      </button>
    {/if}
    {#if level === 'all' || single}
      <button class="refresh" type="button" data-testid="picker-refresh" aria-label={strings.composer.refreshModels} title={strings.composer.refreshModels} disabled={disabled || probing || pickPending || needsInstall} onclick={() => void refreshModels()}><RefreshCw size={14} class={probing || pickPending ? 'spin' : ''} /></button>
    {/if}
  </div>

  <div class="column models main-models">
    {#if !single}
      <!-- The sources, unfolded in the list's place: the models in use, then each provider. Folded, the same rows stay off the arrows' path. -->
      <div class="sources" hidden={!choosing || words.length > 0}>
        {#if hasHome}
          <button type="button" class="tile home-source" role="menuitem" data-row={(choosing && words.length === 0) || undefined} data-provider="home" data-testid="picker-back" onclick={backHome}>
            <span class="mark" aria-hidden="true">{#if level === 'home'}<Check size={14} />{/if}</span>
            <!-- In the logo column, so the name lines up with the providers' names. -->
            <Star size={14} strokeWidth={2} class="home-mark" />
            <span class="name ui-label">{strings.composer.yourModels}</span>
          </button>
        {/if}
        <ProviderTiles {store} {choice} {locked} open={choosing && words.length === 0} current={level === 'all' ? shown?.id ?? null : null} onpick={pickTile} onmore={providersReachable ? openInstall : undefined} />
      </div>
    {/if}

    {#if words.length > 0 && global}
      <!-- A query's answer from every provider, one compact line naming each. -->
      <div class="model-list found" data-testid="picker-found">
        {#each found as column (column.provider.id)}
          <div class="found-source" data-source={column.provider.id}>
            <span class="section-label source-line">{column.label}</span>
            {#if column.pinned}{@render modelRow(column.pinned, column.provider.id, column.accountId)}{/if}
            {#each column.groups as group (group.key)}
              {#if group.key}<span class="section-label group" data-group={group.key}>{group.key}</span>{/if}
              {#each group.models as model (model.id)}{@render modelRow(model, column.provider.id, column.accountId)}{/each}
            {/each}
          </div>
        {/each}
        {#if found.length === 0}
          <p class="none subtle" data-testid="picker-no-models">{strings.composer.noModels}</p>
        {/if}
      </div>
    {:else if choosing && !single}
      <!-- The sources stand in for the list until one is picked: one list at a time. -->
    {:else if level === 'home'}
    <div class="short-list" data-testid="picker-shortlist">
      <!-- Name, and its provider and login only where the name alone is not enough: stars are set on a catalogue. -->
      {#each home as row (`${row.providerId}:${row.accountId}:${row.model.id}`)}
        <button type="button" class="row model" class:current={isChoice(row)} role="menuitem" data-row data-testid={row.favorite ? 'favorite-model' : 'recent-model'}
          title={row.model.id} disabled={disabled || pickPending || !store.providerOf(row.providerId)?.available} onclick={() => void applyPick(row, row.model.id)}>
          <span class="mark" aria-hidden="true">{#if isChoice(row)}<Check size={14} />{/if}</span>
          <span class="name ui-label">{row.model.name}</span>
          {#if sourceOf(row)}<span class="source ui-label">{sourceOf(row)}</span>{/if}
        </button>
      {/each}
    </div>
    {:else}
    <!-- A provider with two logins names which one; the source button already names the provider, so only a lone provider names itself here. -->
    {#if single || seats.length > 1}
    <div class="head">
      {#if single}<span class="provider-name ui-label">{shown ? shown.name : strings.composer.models}</span>{/if}
      <AccountSeats {shown} {seats} {shownAccountId} {choice} {locked} start={!single} busy={disabled || pickPending} onpick={pickSeat} />
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
      {#if grouped}
        {#if pinnedModel}
          {@render modelRow(pinnedModel, shown?.id, shownAccountId)}
        {/if}
        {#each groups as group (group.key)}
          {#if group.key}
            <span class="section-label group" data-group={group.key}>{group.key}</span>
          {/if}
          {#each group.models as model (model.id)}
            {@render modelRow(model, shown?.id, shownAccountId)}
          {/each}
        {/each}
        {#if capped}
          <button type="button" class="row fold small" data-row data-testid="picker-show-all" onclick={() => { expandedFor = shown?.id ?? null; focusInitial(searchBox, menu); }}><span class="ui-label">{fill(strings.composer.showAllModels, { count: String(filteredCurrent.length) })}</span></button>
        {/if}
      {:else}
        {#each filteredCurrent as model (model.id)}
          {@render modelRow(model, shown?.id, shownAccountId)}
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
          <span class="mark" aria-hidden="true"></span>
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
  .model-entry { display: flex; align-items: center; }
  .model-entry .model { flex: 1; min-width: 0; }
  .favorite-button { width: var(--control-sm); height: var(--control-sm); padding: 0; flex: none; color: var(--color-muted-foreground); background: transparent; border: none; }
  .favorite-button[aria-pressed='true'] { color: var(--color-foreground); }
  /** A paired device reads the owner's stars without changing them. */
  .favorite-mark { display: inline-flex; align-items: center; justify-content: center; color: var(--color-foreground); }
  .source { flex: 0 1 auto; min-width: 0; text-align: right; font-size: var(--text-sm); color: var(--color-subtle); }
  .sheet-title { display: none; }
  .popover.legacy-menu { width: min(320px, calc(100vw - 24px)); height: auto; z-index: 41; }
  /* One column on every width, read top to bottom: the title (a phone's),
     the search row, the list, then the effort, the permission and the one
     More row. Each part as tall as its rows; only the list scrolls. */
  .popover {
    position: fixed;
    z-index: 40;
    display: flex;
    flex-direction: column;
    width: min(400px, calc(100vw - 32px));
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
    padding: var(--overlay-pad);
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }

  /* The search, the source button and the refresh share one line: no title, tile row or level head above the list. */
  .find { display: flex; align-items: center; gap: var(--space-1); flex: none; padding: var(--overlay-pad) var(--overlay-pad) 0; }
  .find > :global(.search-bar) { flex: 1 1 auto; min-width: 0; }
  /* Never squeezed: the search field gives way first, and a long name ends in an ellipsis at half the row. */
  .source {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 50%;
    height: var(--control-sm);
    padding: 0 6px 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  .source > .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .source :global(svg) { flex: none; }
  .source :global(.logo) { flex: none; filter: grayscale(1); }
  .source[aria-expanded='true'] { background: var(--color-hover); color: var(--color-foreground); }
  @media (hover: hover) { .source:hover { background: var(--color-hover); color: var(--color-foreground); } }

  .models > * { flex-shrink: 0; }
  .main-models { flex: 0 1 auto; padding: var(--overlay-pad); }
  .main-models .head { gap: 8px; padding: 0 0 0 var(--overlay-row-pad); }
  .main-models .head:has(:global(.seats.start)) { padding: 0; }
  .main-models .head .provider-name { flex: 1; min-width: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .sources { display: flex; flex-direction: column; gap: 1px; }
  .sources[hidden] { display: none; }
  .tile.home-source { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; min-height: var(--overlay-row); padding: var(--space-1) var(--overlay-row-pad); border: none; border-radius: var(--radius-overlay-row); background: transparent; color: var(--color-foreground); text-align: left; }
  .tile.home-source :global(.home-mark) { flex: none; color: var(--color-muted-foreground); }
  .tile.home-source .name { flex: 1; min-width: 0; font-size: var(--text-base); }
  .tile.home-source:focus-visible { background: var(--color-hover); }
  @media (hover: hover) { .tile.home-source:hover { background: var(--color-hover); } }
  .short-list, .model-list { display: flex; flex-direction: column; gap: 1px; }
  .model-list { max-height: 300px; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; }
  .source-line { padding: 8px var(--overlay-row-pad) 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .found-source { display: flex; flex-direction: column; gap: 1px; }
  .found-source:first-child .source-line { padding-top: 2px; }
  /* One provider: its model list is the whole popover. */
  .popover.single { width: min(320px, calc(100vw - 32px)); }
  .refresh { display: grid; flex: none; place-items: center; width: var(--control-sm); height: var(--control-sm); padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); }
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
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
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

  /* The selected row's check, every menu's one mark: 14 px in the accent; the other rows keep its room so the names line up. */
  .mark {
    display: inline-flex;
    width: 14px;
    flex: none;
    color: var(--color-accent);
  }

  .name {
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model .name {
    flex: 1;
  }

  .legacy .name {
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
  }
  .fold .name { flex: 1; }

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
    /* The phone's bottom sheet: its one title, then the same rows, a finger tall. */
    .popover { width: calc(100vw - 24px); }
    .sheet-title { display: block; flex: none; padding-bottom: var(--space-1); text-align: center; font-weight: 600; }
    .find { padding: 0 var(--space-2); }
    .source, .refresh { height: var(--touch-target); }
    .refresh { width: var(--touch-target); }
    .model-list { max-height: none; }
    .main-models { padding: var(--space-1) var(--space-2); }
  }
</style>
