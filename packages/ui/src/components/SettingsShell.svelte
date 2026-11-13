<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { tick, untrack } from 'svelte';
  import { ChevronDown, ChevronLeft, ChevronRight, Monitor, MonitorSmartphone, Network, Search } from '@lucide/svelte';
  import MobileSettings from './MobileSettings.svelte';
  import SettingsPage from './SettingsPage.svelte';
  import InfoTip from './InfoTip.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import SettingsMachineBar from './SettingsMachineBar.svelte';
  import Menu from './Menu.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import { SETTINGS_ICONS, SETTINGS_ICON_SIZE, SETTINGS_ICON_STROKE } from '../lib/settings-icons';
  import { COMMAND_GROUPS } from '../lib/keybindings';
  import { experimentsListed, experimentsShown } from '../lib/experiments.svelte';
  import { experimentCopy } from '../lib/experiment-copy';
  import { fill, strings } from '../lib/strings';
  import type { SettingsTab, Store } from '../lib/store.svelte';
  import { providerGroups } from '../lib/provider-family';
  import { isThisPC, listedName, machineName, workspace } from '../lib/workspace.svelte';
  import { holdSettingsCard, revealSettingsCard } from '../lib/settings-flash';
  import { aliasesOf, desktopPlace, desktopSettings, machinePage, navOf, navSectionsOf, pageScopeOf, phonePlace, settingsHas, type SettingsCardId, type SettingsPage as Page } from '../lib/settings-tabs';
  import { cardWords, searchSettings, settingsEntries, type ExtraEntry, type SettingsEntry } from '../lib/settings-index';
  import { PageScope, providePageScope } from '../lib/page-scope.svelte';
  import { titleSlot } from '../lib/title-slot.svelte';

  let { store, onopenthread }: { store: Store; onopenthread?: () => void } = $props();

  /**
   * Settings is nine pages (`lib/settings-tabs.ts`), one per question a person
   * asks. A route names one of them, or a page or a card from before the map:
   * `desktopPlace` says where it lands. Each page is a column of blocks, an
   * older page whole or a single card, in the order the map gives.
   */
  /** A paired device reads one card of Safeguards, the admin policy: without a policy the page has nothing for it. */
  let bare = $derived(!store.owner && !store.policy?.present);
  const narrow = new MediaQuery('(max-width: 720px)');
  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  /** A phone browser: the list of pages, then a page (`MobileSettings.svelte`), with the cards a phone has. */
  let phone = $derived(!desktopSettings(narrow.current));
  let place = $derived.by((): { page: Page; section: string | null } => {
    // A phone on its list picks no machine: its place is its first page's, until a page opens.
    const found = phone ? phonePlace(store.settingsTab, store.settingsSection?.id, store.owner) : desktopPlace(store.settingsTab, store.settingsSection?.id, store.owner);
    return found.page === null || (bare && found.page === 'safeguards') ? { page: navOf(false, phone)[0]!, section: null } : { page: found.page, section: found.section };
  });
  let tab = $derived(place.page);

  /** Machines this window controls, and the window's own whatever its role there. */
  let choices = $derived(workspace.machines.filter((machine) => machine.store === store || (machine.store.connection === 'ready' && machine.store.owner)));
  let picked = $state<string | null>(null);
  /**
   * Until one is picked, a page shows the window's machine. A route to the
   * plugins opens on this PC instead: desktop apps run where they were installed.
   */
  let chosen = $derived(choices.find((machine) => machine.id === picked)
    ?? (place.section === 'plugins' ? choices.find(isThisPC) : undefined)
    ?? choices.find((machine) => machine.store === store));
  /** The machine a page's machine cards change (`machinePage`): the one picked in the line under its title. */
  let target = $derived(machinePage(tab) ? chosen?.store ?? store : store);
  /** A plugin card's Preview reads the repository on the card's machine, where the agent that asked runs. */
  $effect(() => {
    if (!store.pluginSource) return;
    untrack(() => { picked = choices.find((machine) => machine.store === store)?.id ?? picked; });
  });
  /** The bar when there is a machine to pick or a default machine to speak of. */
  let bar = $derived(machinePage(tab) && chosen !== undefined && (choices.length > 1 || chosen.store.group?.settingsHome !== undefined));
  /**
   * A page reads the card it was asked to show off its own machine's layout:
   * on another machine than the window's, that layout follows the window's.
   */
  $effect(() => {
    const machine = target, route = store.settingsTab, section = store.settingsSection;
    if (machine === store) return;
    untrack(() => { machine.settingsTab = route; machine.settingsSection = section; });
  });

  // Derived, not built once: the nav is written in the language the app is
  // speaking, and the language changes without a reload. Each entry wears its
  // icon (`SETTINGS_ICONS`), so the list scans by shape as well as by word.
  let pages = $derived(navOf(store.owner).filter((id) => !(bare && id === 'safeguards')).map((id) => ({ id, label: strings.settingsMap.pages[id] })));
  let words = $derived(cardWords());
  /** A long page lists its sections under its entry while it is open. */
  let sections = $derived(navSectionsOf(tab, store.owner).map((card) => ({ id: card.id, label: words[card.id as SettingsCardId].title })));

  /** One title per screen, and what the page answers behind the "i" beside it. */
  let title = $derived(strings.settingsMap.pages[tab]);
  let info = $derived(strings.settingsMap.about[tab]);
  let scopePicks = $derived(bar && choices.length > 1 && chosen !== undefined);
  /**
   * Where the page's settings apply, said once under the title as the map
   * declares it ("This device", "This machine: studio", "All your machines",
   * the name the picker where there are several); a card that differs says
   * its own at its head, the first machine one then holding the picker.
   */
  const scopes = providePageScope(new PageScope(() => null, () => (scopePicks ? scopePicker : undefined), () => pageScopeOf(tab)));
  let scopeKind = $derived(scopes.line ?? pageScopeOf(tab));
  let scope = $derived.by((): string => {
    if (scopeKind === 'device') return strings.settingsMap.scope.device;
    if (scopeKind === 'group') return strings.settingsMap.scope.group;
    const machine = workspace.machines.find((m) => m.store === target);
    return fill(strings.settingsMap.scope.machine, { machine: machine ? machineName(machine) : strings.machines.local });
  });

  /**
   * On a desktop the card carries the screen's one title, a step over the
   * cards' own, as a phone's screen does; the bar above stays empty but for a
   * page's buttons (UsagePage.svelte). The list's head leads back to the
   * threads, as the bots column's does (SideHead.svelte).
   */
  $effect(() => {
    if (!desktopSettings(narrow.current)) return;
    titleSlot.current = blank;
    return () => { if (titleSlot.current === blank) titleSlot.current = null; };
  });

  /**
   * What the search looks through: every page, card and control of the map
   * (`lib/settings-index.ts`), and the rows only the live data names: a
   * provider's, an experiment's, a group of shortcuts.
   */
  let providerList = $derived(providerGroups(store.providers, store.shownAccounts()));
  let extras = $derived<ExtraEntry[]>([
    ...COMMAND_GROUPS.map((group) => ({ page: 'input' as const, section: `keys-${group.id}`, label: strings.keyboard.groups[group.id], card: 'keyboard' as const })),
    ...(store.owner ? [...providerList.connected, ...providerList.rest, ...providerList.off].map((row) => ({ page: 'ai' as const, section: `provider-${row.id}`, label: row.name, card: 'providers' as const })) : []),
    ...(experimentsShown() ? experimentsListed().map((id) => ({ page: 'version' as const, section: id as string, label: experimentCopy()[id]?.title ?? id, card: 'experiments' as const })) : [])
  ]);
  /** Rows only the app draws: a browser has no tray, no sign-in start and no zoom of its own. */
  let shellOnly = $derived(new Set([strings.settings.closeToTray, strings.settings.launchAtLogin, strings.settings.zoom, strings.features.openChatLinks.title]));
  /** A phone finds only what it can open: the map leaves the desktop cards (the shortcuts, the toolbar) out of its entries. */
  let entries = $derived(settingsEntries(store.owner, extras.filter((extra) => settingsHas(extra.page, extra.section, store.owner, phone)), phone)
    .filter((entry) => !(bare && entry.page === 'safeguards') && (inShell || !shellOnly.has(entry.label))));

  const motion = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

  /**
   * The search heads the nav: while it holds words, the card lists what they
   * find in place of the page; a result or a nav entry opens its page and
   * empties it.
   */
  let query = $state('');
  let field = $state<HTMLInputElement>();
  let panel = $state<HTMLElement>();
  /** The result Enter opens: the arrows move it, a new query puts it back on top. */
  let active = $state(0);
  let results = $derived(searchSettings(entries, query));
  let searching = $derived(query.trim() !== '');

  /** A result opens its page on its card, and rings the card once so the eye lands on it. */
  function open(entry: SettingsEntry) {
    query = '';
    store.showSettings(entry.page, entry.section, { flash: entry.section !== null });
  }

  function go(page: SettingsTab, section: string | null = null) {
    query = '';
    store.showSettings(page, section);
  }

  // The gear opens Settings to be searched: the keyboard lands in the field. A
  // touch screen would answer with its keyboard over the page, so it waits for a tap.
  $effect(() => {
    if (untrack(() => store.settingsTab) === 'home' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) field?.focus({ preventScroll: true });
  });

  function onkey(event: KeyboardEvent) {
    const picked = results[Math.min(active, results.length - 1)];
    if (event.key === 'Enter' && picked) {
      event.preventDefault();
      open(picked);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length > 0) {
      event.preventDefault();
      active = (Math.min(active, results.length - 1) + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      query = '';
    }
  }

  // A caller can name a card before this lazy settings subtree is mounted.
  // Effects run after its DOM is present, so the normal navigation path can
  // perform the first scroll without timing guesses in the caller. On a page
  // already open the card glides into view; on one just opened it jumps and
  // holds, since the blocks above it are still filling in.
  let shown: Page | null = null;
  $effect(() => {
    // A phone's screen reveals its own card (`MobileSettings.svelte`).
    if (phone) return;
    const page = tab, id = place.section, section = store.settingsSection;
    void store.settingsTab;
    void section?.request;
    const stayed = shown === page;
    shown = page;
    let release = () => {};
    let live = true;
    void tick().then(() => {
      if (!live) return;
      if (!id) { if (stayed && panel) panel.scrollTop = 0; return; }
      if (revealSettingsCard(id, section?.flash === true, stayed ? motion() : 'instant') && !stayed) release = holdSettingsCard(id);
    });
    return () => { live = false; release(); };
  });
</script>

{#snippet blank()}<span class="crumb" aria-hidden="true"></span>{/snippet}

{#snippet machineBar()}
  {#if chosen}<SettingsMachineBar machine={chosen} machines={choices} onpick={(id) => { picked = id; }} />{/if}
{/snippet}
<!-- A scope phrase with its machine as the picker, "This machine: [studio v]": it says where they apply and switches it. -->
{#snippet scopePicker(template: string)}
  {@const scopeWords = template.split('{machine}')}
  {#if chosen}
    {#if scopeWords[0]?.trim()}<span class="ui-label">{scopeWords[0].trim()}</span>{/if}
    <Menu items={choices.map((entry) => ({ id: entry.id, label: listedName(entry), active: entry === chosen }))} label={strings.machines.pick} placement="bottom" variant="text" testid="settings-machine" onpick={(id) => { picked = id; }}>
      <MachineIcon icon={chosen.icon} os={chosen.store.core?.os} size={14} /><span class="pick-name ui-label">{listedName(chosen)}</span><ChevronDown size={13} aria-hidden="true" />
    </Menu>
    {#if scopeWords[1]?.trim()}<span class="ui-label">{scopeWords[1].trim()}</span>{/if}
  {/if}
{/snippet}
<!-- The search heads Settings: it finds every page, card and single setting. The phone's home opens on the same field. -->
{#snippet searchField(phone: boolean)}
  <label class="search" class:phone data-testid="settings-home">
    <Search size={14} strokeWidth={1.75} aria-hidden="true" />
    <input type="search" bind:this={field} bind:value={query} oninput={() => (active = 0)} placeholder={strings.settings.search} aria-label={strings.settings.search} data-testid="settings-search" onkeydown={onkey} spellcheck="false" autocomplete="off" />
  </label>
{/snippet}
{#snippet searchResults()}
  {#if results.length === 0}
    <p class="hint" data-testid="settings-search-empty">{strings.settings.searchEmpty}</p>
  {:else}
    <div class="card flush results" data-testid="settings-search-results">
      {#each results as entry, index (`${entry.page}:${entry.section}:${entry.label}`)}
        <button type="button" class="ghost result" class:active={index === Math.min(active, results.length - 1)} data-testid="settings-search-result" data-page={entry.page} data-section={entry.section} onpointermove={() => (active = index)} onclick={() => open(entry)}>
          <span class="label ui-label">{entry.label}</span>
          {#if entry.trail}<span class="trail ui-label">{entry.trail}</span>{/if}
          <ChevronRight size={15} />
        </button>
      {/each}
    </div>
  {/if}
{/snippet}
<!-- Under a title whose scope line is the picker: only the bar's notes (follows, default machine). -->
{#snippet machineNotes()}
  {#if chosen}<SettingsMachineBar machine={chosen} machines={choices} picker={false} onpick={(id) => { picked = id; }} />{/if}
{/snippet}

{#if phone}
  <MobileSettings {store} {target} bar={bar ? machineBar : undefined} pick={bar && choices.length > 1 ? scopePicker : undefined} notes={machineNotes} search={searchField} found={searching ? searchResults : undefined} {onopenthread} />
{:else}
<div class="settings" data-testid="settings">
  <nav aria-label={strings.settings.heading} style:--list-width={`${store.sidebarWidth}px`}>
    <!-- The list's head leads back to the threads, like the bots column's. -->
    <button type="button" class="ghost title" data-testid="settings-back" title={strings.settings.back} onclick={() => { store.showChat(); store.sidebarCollapsed = false; }}>
      <ChevronLeft size={16} aria-hidden="true" /><span class="ui-label">{strings.settings.heading}</span>
    </button>
    {@render searchField(false)}
    <!-- Nine pages, one list, no head over them. -->
    {#each pages as page (page.id)}
      {@const here = !searching && tab === page.id}
      {@const Icon = SETTINGS_ICONS[page.id]}
      <button type="button" class="ghost tab" class:active={here} data-testid="settings-tab-{page.id}" aria-current={here ? 'page' : undefined} onclick={() => go(page.id)}>
        <Icon size={SETTINGS_ICON_SIZE} strokeWidth={SETTINGS_ICON_STROKE} aria-hidden="true" />
        <span class="ui-label">{page.label}</span>
      </button>
      {#if here && sections.length > 0}
        <div class="subs" role="group" aria-label={page.label} data-testid="settings-sections">
          {#each sections as section (section.id)}
            <button type="button" class="ghost tab sub" data-testid="settings-section-{section.id}" onclick={() => go(page.id, section.id)}><span class="ui-label">{section.label}</span></button>
          {/each}
        </div>
      {/if}
    {/each}
    <!-- The pages from before the map, as routes: a link or a test that names one still opens where its content went. Never drawn, never reached by the keyboard. -->
    {#each aliasesOf(store.owner) as alias (alias)}
      <button type="button" hidden style="display: none" tabindex="-1" aria-hidden="true" data-testid="settings-tab-{alias}" onclick={() => go(alias)}></button>
    {/each}
  </nav>

  <!-- The panel is keyed on the page, so switching pages fades the new one in
       rather than swapping it in one frame. -->
  {#key tab}
    <section class="framed" bind:this={panel}>
      {#if searching}
        <div class="found">{@render searchResults()}</div>
      {:else}
        <header class="screen" data-testid="settings-crumb">
          <h1 class="ui-label-box"><span class="ui-label">{title}</span><InfoTip topic={title} text={info} testid="settings-info" /></h1>
          <p class="scope" data-testid="settings-scope" data-scope={scopeKind}>
            {#if scopeKind === 'device'}<MonitorSmartphone size={14} strokeWidth={1.75} aria-hidden="true" />{:else if scopeKind === 'group'}<Network size={14} strokeWidth={1.75} aria-hidden="true" />{:else if !scopePicks}<Monitor size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
            {#if scopeKind === 'machine' && scopePicks}{@render scopePicker(strings.settingsMap.scope.machine)}{:else}<span class="ui-label">{scope}</span>{/if}
          </p>
        </header>
        {#if bar}{@render machineNotes()}{/if}
        {#key target}
        <PolicyBanner store={target} />
        <SettingsPage {store} {target} page={tab} line={scopeKind} {onopenthread} />
        {/key}
      {/if}
    </section>
  {/key}
</div>
{/if}

<style>
  /* The panel scrolls title, bar and page together, on one column. */
  .framed { scrollbar-gutter: stable both-edges; }
  .framed > :global(.machine-bar) { padding: 24px var(--settings-gutter) 0; }
  .framed > :global(.policy-banner) { margin: 24px var(--settings-gutter) 0; }
  @media (min-width: 721px) {
    .framed > :global(.machine-bar) { padding-inline: max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); max-width: none; }
    .framed > :global(.policy-banner) { margin-inline: max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); }
  }
  @media (max-width: 720px) {
    .framed > :global(.machine-bar) { padding: 16px 16px 0; }
    .framed > :global(.policy-banner) { margin: 16px 16px 0; }
  }
  .tab span { flex: 1; text-align: left; }
  .tab { gap: 10px; }
  .tab :global(svg) { flex: none; color: var(--color-subtle); }
  .tab.active :global(svg) { color: var(--color-foreground); }
  /* The sections of a long page, under its entry while it is open: one step in, no icon, the quiet tier. */
  .subs { display: flex; flex-direction: column; gap: 2px; margin: 0 0 var(--space-1); }
  .tab.sub { min-height: var(--control); padding: var(--space-1) 10px var(--space-1) calc(10px + 16px + 10px); font-size: var(--text-sm); color: var(--color-subtle); }
  .tab.sub:hover:not(:disabled) { color: var(--color-foreground); }

  /* The search heads the nav, on the chrome like the rows under it. */
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--control);
    margin: 0 0 var(--space-2);
    padding: 0 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-hover);
    color: var(--color-subtle);
    transition: border-color var(--dur-2);
  }
  /* A field brightens its edge on focus, as every field does (app.css): an autofocused search wore an accent frame. */
  .search:focus-within { border-color: var(--color-composer-focus); }
  .search :global(svg) { flex: none; }
  .search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; box-shadow: none; outline: none; font-size: var(--text-sm); color: var(--color-foreground); }
  .search input::-webkit-search-cancel-button { display: none; }
  /* The phone's home: the field spans its column, first under the header, a finger tall. */
  .search.phone { width: auto; height: var(--touch-target); margin: 0 0 var(--space-5); background: var(--color-surface); }
  .search.phone input { font-size: var(--text-md); }

  /* What the search finds, in the page's column. */
  .found { padding: var(--space-8) max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); }
  .hint { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-base); }
  .results { display: grid; grid-template-columns: minmax(0, 1fr); }
  .result {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    height: auto;
    min-height: var(--row);
    padding: var(--space-2) var(--space-4);
    border-radius: 0;
    color: var(--color-foreground);
    text-align: left;
  }
  button.result.active { background: var(--color-hover); }
  .result + .result { border-top: 1px solid var(--color-border); }
  .result .label { flex: none; max-width: 60%; }
  .result .trail { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result :global(svg) { flex: none; color: var(--color-subtle); }
  /* A phone's row is too short for both: the place goes under the name, each cut at the card's edge. */
  @media (max-width: 720px) {
    .result { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--space-3); }
    .result .label { grid-column: 1; max-width: 100%; overflow-wrap: anywhere; }
    .result .trail { grid-column: 1; }
    .result :global(svg) { grid-column: 2; grid-row: 1 / span 2; }
  }

  /* The pages' list stands in the thread list's column, on the chrome, and
     the page in the inset card beside it, as in the rest of the frame. */
  .settings {
    display: flex;
    flex: 1;
    gap: var(--frame-gap);
    min-height: 0;
    min-width: 0;
  }

  nav {
    width: var(--list-width);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 6px 12px;
    overflow-y: auto;
  }

  /* The thread list's head: same height, size and inset, so the switch reads as one column changing.
     It leads back to the threads (SideHead.svelte's back title), so it only lights under the pointer. */
  .title { flex: none; justify-content: flex-start; gap: 2px; height: 36px; margin: 16px 4px 4px; padding: 0 8px 0 2px; font-size: 15px; font-weight: 600; letter-spacing: -0.015em; color: var(--color-subtle); }
  .title .ui-label { color: var(--color-foreground); }
  .title:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }

  .crumb { flex: 1; min-width: 0; }
  /* The screen's one title, at the top of its card in the settings column, one step over a card's. */
  .screen { display: flex; flex-direction: column; align-items: flex-start; padding: var(--space-8) max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)) 0; }
  .screen h1 { min-width: 0; margin: 0; color: var(--color-foreground); font-size: var(--text-lg); font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
  /* The machine's name in the scope line is the picker: a word with an edge and a chevron, so it reads as one at rest. */
  :global(.settings .scope .trigger.text) { margin: -2px 0; color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  :global(.settings .scope .pick-name) { overflow: hidden; max-width: 28ch; text-overflow: ellipsis; white-space: nowrap; }

  .tab {
    justify-content: flex-start;
    width: 100%;
    min-height: var(--row);
    height: auto;
    padding: 6px 10px;
    white-space: normal;
    line-height: 1.35;
    color: var(--color-muted-foreground);
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .tab:active:not(:disabled) {
    transform: none;
    background: color-mix(in srgb, var(--color-surface-3) 85%, var(--color-foreground));
  }

  .tab.active {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  .framed {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    animation: fade var(--dur-2) var(--ease-out-quint);
  }

  /* Up to the window's top, like the thread list (App.svelte's bar starts right of it). */
  @media (min-width: 721px) {
    nav { margin-top: calc(-1 * var(--titlebar)); }
  }

  @media (max-width: 720px) {
    .settings {
      flex-direction: column;
    }

    nav {
      width: auto;
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 8px 12px;
      align-items: flex-start;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    }

    .settings { gap: 0; }
    /* In a row, the head is the first chip, then the search, then each page a chip. */
    .title { height: var(--control); margin: 0; font-size: var(--text-sm); white-space: nowrap; }
    .search { width: 180px; margin: 0; }
    .tab { width: auto; white-space: nowrap; padding-left: 10px; }
    .subs { display: none; }
  }
</style>
