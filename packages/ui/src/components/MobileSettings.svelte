<script lang="ts">
  import { ArrowLeft, ChevronRight, Monitor, MonitorSmartphone, Network } from '@lucide/svelte';
  import { SETTINGS_ICONS, SETTINGS_ICON_SIZE, SETTINGS_ICON_STROKE } from '../lib/settings-icons';
  import type { Store } from '../lib/store.svelte';
  import { machineName, workspace } from '../lib/workspace.svelte';
  import { fill, strings } from '../lib/strings';
  import { mobileOverlay } from '../lib/mobile-history';
  import { ScreenSlide } from '../lib/screen-slide.svelte';
  import InfoTip from './InfoTip.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import SettingsPage from './SettingsPage.svelte';
  import { tick, type Snippet } from 'svelte';
  import { holdSettingsCard, revealSettingsCard } from '../lib/settings-flash';
  import { aliasesOf, machinePage, navOf, pageScopeOf, phonePlace, type SettingsPage as Page } from '../lib/settings-tabs';
  import { PageScope, providePageScope } from '../lib/page-scope.svelte';

  /**
   * `target` is the machine the settings bar picked, `store` this window's:
   * the cards of one machine show the target.
   */
  let { store, target = store, bar, pick, notes, search, found, onopenthread }: {
    store: Store;
    target?: Store;
    /** Whether there is a machine to pick or a default machine to speak of, as its bar. */
    bar?: Snippet;
    /** The machine picker inside a scope phrase it is given ("This machine: [studio v]"), where several machines can be picked. */
    pick?: Snippet<[string]>;
    /** The bar without its picker, under a header that holds it. */
    notes?: Snippet;
    /** The desktop's settings search (`SettingsShell.svelte`), the list's first row. */
    search?: Snippet<[boolean]>;
    /** Its results while a query is typed: they take the list's place. */
    found?: Snippet;
    onopenthread?: () => void;
  } = $props();

  /**
   * Two levels, from the map of Settings (`lib/settings-tabs.ts`): the list of
   * the pages a phone has, in the map's order, then one page with its cards
   * (`SettingsPage.svelte`, the desktop's own). A route, whatever names it,
   * lands where `phonePlace` says.
   */
  /** A paired device reads one card of Safeguards, the admin policy: without a policy the page has nothing for it. */
  let bare = $derived(!store.owner && !store.policy?.present);
  const kept = (page: Page): boolean => !(bare && page === 'safeguards');
  let place = $derived.by(() => {
    const landed = phonePlace(store.settingsTab, store.settingsSection?.id, store.owner);
    return landed.page !== null && kept(landed.page) ? landed : { page: null, section: null };
  });
  let page = $derived<Page | 'home'>(place.page ?? 'home');
  let pages = $derived(navOf(store.owner, true).filter(kept));
  let detail = $derived(page !== 'home');
  let machine = $derived(workspace.machines.find((entry) => entry.store === store));
  let connected = $derived(store.connection === 'ready' && !store.pairingRequired);

  /**
   * A page slides in over the list and back off it, as the conversation does
   * over the thread list (MobileNavigation). From one page to another, a
   * search result or a card's link, the page is simply replaced.
   */
  const slide = new ScreenSlide();
  /**
   * The screen a move deeper or back brought in, slid or not: it shows
   * without the fade a replaced page plays, which after Safari's own swipe
   * back would be a second animation.
   */
  let arrived = $state<string | null>(null);
  slide.follow(() => page, (from, to) => {
    const way = from === 'home' ? 'push' : to === 'home' ? 'pop' : null;
    arrived = way ? to : null;
    return way;
  });
  /** During a slide the screen it leaves stays drawn; the one on top comes last, so it paints over the other. */
  let screens = $derived<(Page | 'home')[]>(slide.direction && slide.from ? (slide.direction === 'push' ? [slide.from as Page | 'home', page] : [page, slide.from as Page | 'home']) : [page]);
  /** Which of `app.css`'s screen keyframes plays on a screen, during a slide. */
  function motionOf(shown: string): string | undefined {
    if (screens.length < 2) return undefined;
    if (slide.direction === 'push') return shown === page ? 'in' : 'under-out';
    return shown === page ? 'under-in' : 'out';
  }

  /** The page drawn, the one sliding off included: its cards keep their tags until it is gone. */
  let drawn = $derived(screens.find((shown): shown is Page => shown !== 'home') ?? null);
  /**
   * Where a page's settings apply, said once under its title as the map
   * declares it; a card that differs says its own at its head, the first
   * machine one then holding the picker.
   */
  const scopes = providePageScope(new PageScope(() => null, () => (bar ? pick : undefined), () => (drawn ? pageScopeOf(drawn) : null)));
  const scopeText = (shown: Page): string => {
    const kind = pageScopeOf(shown);
    if (kind === 'device') return strings.settingsMap.scope.device;
    if (kind === 'group') return strings.settingsMap.scope.group;
    const on = workspace.machines.find((entry) => entry.store === target);
    return fill(strings.settingsMap.scope.machine, { machine: on ? machineName(on) : strings.machines.local });
  };

  /** One history entry for the page, so Back returns to the list. */
  const back = () => store.showSettings();
  $effect(() => { if (detail) return mobileOverlay(back); });

  // A route names a card: the page opens on it, and rings it once when a search result or a
  // settings card in a conversation pointed there. On a page just opened the card jumps into
  // place and holds while the cards above it fill in; on one already open it glides.
  let opened: Page | 'home' | null = null;
  $effect(() => {
    const shown = page, id = place.section, section = store.settingsSection;
    void store.settingsTab;
    void section?.request;
    const stayed = opened === shown;
    opened = shown;
    if (shown === 'home' || !id) return;
    let release = () => {};
    let live = true;
    void tick().then(() => {
      if (!live) return;
      const smooth = stayed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (revealSettingsCard(id, section?.flash === true, smooth ? 'smooth' : 'instant') && !stayed) release = holdSettingsCard(id);
    });
    return () => { live = false; release(); };
  });
</script>

<!-- `settings` gives the pages the same grammar as the desktop ones. `data-detail` lets the app drop
     its own header over a page, which carries its own with the way back (App.svelte). -->
<div class="mobile-settings settings" class:sliding={screens.length > 1} data-testid="settings" data-detail={detail || undefined} use:slide.attach>
  {#each screens as shown (shown)}
  <div class="settings-screen" class:left={shown !== page} class:arrived={shown === arrived} data-slide={motionOf(shown)} inert={shown !== page || slide.direction === 'pop'}>
  {#if shown === 'home'}
    <!-- The header already says Settings: the screen opens on the search, then the pages as the map lists them. -->
    <div class="home" data-testid="mobile-settings-home">
      {@render search?.(true)}
      {#if found}<div class="found">{@render found()}</div>{:else}
      <PolicyBanner store={target} />
      <!-- One list, no head over it: a row is the page's icon and its name. Devices also says which machine this phone reaches. -->
      <div class="rows" data-testid="mobile-settings-pages">
        {#each pages as id (id)}
          {@const Icon = SETTINGS_ICONS[id]}
          <button class="ghost row" data-testid="settings-tab-{id}" onclick={() => store.showSettings(id)}>
            <Icon class="lead" size={SETTINGS_ICON_SIZE} strokeWidth={SETTINGS_ICON_STROKE} aria-hidden="true" /><span class="ui-label">{strings.settingsMap.pages[id]}</span>
            {#if id === 'devices'}<small class="value ui-label" data-testid="mobile-settings-connection-value" title={store.pairingRequired ? strings.mobile.pairingRequired : strings.connection[store.connection]}>{#if connected}<span class="dot" aria-hidden="true"></span>{machine ? machineName(machine) : strings.connection.ready}{:else}{store.pairingRequired ? strings.mobile.pairingRequired : strings.connection[store.connection]}{/if}</small>{/if}
            <ChevronRight size={18} />
          </button>
        {/each}
      </div>
      <!-- The pages from before the map, as routes: a link or a test that names one still opens where its content went. Never drawn, never reached. -->
      {#each aliasesOf(store.owner, true) as alias (alias)}
        <button type="button" hidden style="display: none" tabindex="-1" aria-hidden="true" data-testid="settings-tab-{alias}" onclick={() => store.showSettings(alias)}></button>
      {/each}
      {/if}
    </div>
  {:else}
    {@const title = strings.settingsMap.pages[shown]}
    {@const kind = pageScopeOf(shown)}
    {@const picks = kind === 'machine' && pick !== undefined && bar !== undefined}
    <header data-testid="mobile-settings-header">
      <button class="ghost icon" data-testid="mobile-settings-back" aria-label={strings.mobile.settingsBack} onclick={back}><ArrowLeft size={20} /></button>
      <!-- The thread header's grammar: back, the title, one context line under it (where these settings apply). -->
      <div class="heading">
        <h1 class="ui-label-box"><span class="ui-label">{title}</span><InfoTip topic={title} text={strings.settingsMap.about[shown]} testid="mobile-settings-info" /></h1>
        <p class="scope page-scope" class:picks data-testid="mobile-settings-page-scope" data-scope={kind}>{#if kind === 'device'}<MonitorSmartphone size={14} strokeWidth={1.75} aria-hidden="true" />{:else if kind === 'group'}<Network size={14} strokeWidth={1.75} aria-hidden="true" />{:else if !picks}<Monitor size={14} strokeWidth={1.75} aria-hidden="true" />{/if}{#if picks && pick}{@render pick(strings.settingsMap.scope.machine)}{:else}<span class="ui-label">{scopeText(shown)}</span>{/if}</p>
      </div>
    </header>
    <div class="detail" data-testid="mobile-settings-detail">
      <!-- What the machine's bar says beside its picker (it follows another, it is the default), where the page has a machine's card. -->
      {#if bar && machinePage(shown)}<div class="bar">{@render (notes ?? bar)()}</div>{/if}
      {#key target}
      <PolicyBanner store={target} />
      <SettingsPage {store} {target} page={shown} phone line={scopes.line} {onopenthread} />
      {/key}
    </div>
  {/if}
  </div>
  {/each}
</div>

<style>
  .mobile-settings { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .mobile-settings.sliding { overflow: hidden; }
  .settings-screen { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  /* The screen a slide leaves lies over the same box as the one it opens, out of reach (lib/screen-slide.svelte.ts).
     While a page slides off, the list beneath it is out of reach too: a tap lands on neither. */
  .settings-screen.left { position: absolute; inset: 0; pointer-events: none; }
  .settings-screen[data-slide] { background: var(--screen-background, var(--color-background)); animation: screen-in var(--motion-duration) var(--motion-curve) both; }
  .settings-screen:is([data-slide='in'], [data-slide='out']) { box-shadow: var(--shadow-screen); }
  .settings-screen[data-slide='out'] { animation-name: screen-out; }
  .settings-screen[data-slide='under-in'] { animation-name: screen-under-in; }
  .settings-screen[data-slide='under-out'] { animation-name: screen-under-out; }
  .home, .detail { animation: fade var(--dur-2) var(--ease-out-quint); min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .settings-screen:is([data-slide], .arrived) > :is(.home, .detail) { animation: none; }
  .home { padding: var(--space-4); }
  .home > :global(.policy-banner) { margin-bottom: var(--space-5); }
  /* The list: one card of rows, a finger tall each. */
  .rows { border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
  /* A ghost button is muted; a row's name reads like any other settings label. */
  .row { display: flex; align-items: center; width: 100%; height: auto; min-height: 48px; gap: var(--space-3); padding: var(--space-3) var(--space-4); font-size: var(--text-base); font-weight: 400; text-align: left; border-radius: 0; white-space: normal; color: var(--color-foreground); }
  .row + .row { border-top: 1px solid var(--color-border); }
  .row span { flex: 1; min-width: 0; }
  /* A row's icon leads it in the grey of the chrome's icons; the chevron at its end stays the quietest. */
  .row :global(svg) { flex: none; color: var(--color-subtle); }
  .row :global(svg.lead) { color: var(--color-muted-foreground); }
  /* What a row holds now, quieter than its name, shortened before the name is. */
  .row .value { display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .row .dot { flex: none; width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-success); }
  /* The screen's one header: the app's own steps aside over a page (App.svelte), so this one takes the top inset. */
  header { flex: none; display: flex; align-items: center; gap: var(--space-2); min-height: 52px; padding: max(var(--space-2), env(safe-area-inset-top)) max(var(--space-3), env(safe-area-inset-right)) var(--space-2) max(var(--space-3), env(safe-area-inset-left)); border-bottom: 1px solid var(--color-border); }
  header .icon { width: 44px; min-height: 44px; }
  header h1 { margin: 0; font-size: var(--text-md); font-weight: 600; }
  /* The title and its one context line, stacked as the thread header's (ThreadHeader.svelte). */
  .heading { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .page-scope { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 2px 0 0; color: var(--color-subtle); font-size: var(--text-meta); line-height: 1.3; overflow-wrap: anywhere; }
  .page-scope > .ui-label { min-width: 0; }
  .page-scope > :global(svg) { flex: none; }
  /* A page keeps the phone's inset, the list's own, on every block of the map. */
  .detail { --settings-gutter: var(--space-4); }
  .detail > :global(.policy-banner) { margin: var(--space-4) var(--space-4) 0; }
  .detail :global(.switch-row) { flex-wrap: wrap; gap: var(--space-3); }
  .bar { padding: var(--space-4) var(--space-4) 0; }
  /* Notes alone, with none to give: no band. */
  .bar:not(:has(:global(.machine-bar > *))) { display: none; }
</style>
