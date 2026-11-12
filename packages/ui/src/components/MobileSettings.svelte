<script lang="ts">
  import TelemetrySettings from './TelemetrySettings.svelte';
  import { ArrowLeft, ChevronRight, Monitor, MonitorSmartphone } from '@lucide/svelte';
  import CardScope from './CardScope.svelte';
  import { SETTINGS_ICONS, SETTINGS_ICON_SIZE, SETTINGS_ICON_STROKE } from '../lib/settings-icons';
  import type { SettingsTab, Store } from '../lib/store.svelte';
  import { machineName, workspace } from '../lib/workspace.svelte';
  import { fill, strings } from '../lib/strings';
  import { mobileOverlay } from '../lib/mobile-history';
  import { ScreenSlide } from '../lib/screen-slide.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import AccountsPage from './AccountsPage.svelte';
  import BrowserPage from './BrowserPage.svelte';
  import AgentRepliesSettings from './AgentRepliesSettings.svelte';
  import ConversationSwitches from './ConversationSwitches.svelte';
  import ExperimentsPage from './ExperimentsPage.svelte';
  import DiagnosticsPage from './DiagnosticsPage.svelte';
  import LimitsPage from './LimitsPage.svelte';
  import QuotaMachineScope from './QuotaMachineScope.svelte';
  import ResourcesPage from './ResourcesPage.svelte';
  import QuietCard from './QuietCard.svelte';
  import TaskManagerLoader from './TaskManagerLoader.svelte';
  import MachinesPage from './MachinesPage.svelte';
  import PhoneSettings from './PhoneSettings.svelte';
  import UsagePage from './UsagePage.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import BrainPage from './BrainPage.svelte';
  import PluginsPage from './PluginsPage.svelte';
  import ArchivedThreads from './ArchivedThreads.svelte';
  import WorktreesCard from './WorktreesCard.svelte';
  import CompactionSettings from './CompactionSettings.svelte';
  import InfoTip from './InfoTip.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import PolicySettings from './PolicySettings.svelte';
  import { tick, type Snippet } from 'svelte';
  import { holdSettingsCard, revealSettingsCard } from '../lib/settings-flash';
  import { phonePage } from '../lib/settings-tabs';
  import { PageScope, providePageScope } from '../lib/page-scope.svelte';
  import { readTheme } from '../lib/theme';
  import { activeLocale } from '../lib/i18n.svelte';

  /**
   * `target` is the machine the settings bar picked, `store` this window's:
   * the pages of one machine show the target, under the bar.
   */
  let { store, target = store, bar, pick, notes, search, found, onopenthread }: {
    store: Store;
    target?: Store;
    bar?: Snippet;
    /** The machine picker inside a scope phrase it is given ("Agent settings apply on [studio v]"), where several machines can be picked. */
    pick?: Snippet<[string]>;
    /** The bar without its picker, under a header that holds it. */
    notes?: Snippet;
    /** The desktop's settings search (`SettingsShell.svelte`), the home's first row. */
    search?: Snippet<[boolean]>;
    /** Its results while a query is typed: they take the families' place. */
    found?: Snippet;
    onopenthread?: () => void;
  } = $props();
  /**
   * Home lists the desktop's families (`SETTINGS_FAMILIES`) in the desktop's order
   * under the desktop's names, each page a phone has. General opens an index of its cards: the cards a phone
   * needs from the desktop's long pages, the archive or the keys, get a page
   * of their own, which a jump to the desktop's card (the palette, the project
   * menu) lands on too (`lib/settings-tabs.ts`). Notifications is this
   * phone's own screen, opened from General: it holds while the route that
   * showed it does.
   */
  let local = $state.raw<{ screen: 'phone'; tab: SettingsTab; section: unknown } | null>(null);
  const openLocal = (screen: 'phone') => { local = { screen, tab: store.settingsTab, section: store.settingsSection }; };
  let routed = $derived(phonePage(store.settingsTab, store.settingsSection?.id, store.owner));
  let page = $derived(local && local.tab === store.settingsTab && local.section === store.settingsSection ? local.screen : routed);
  const UNDER: Record<string, 'general'> = {
    phone: 'general', conversations: 'general', archived: 'general', worktrees: 'general'
  };
  /** Home, a group's screen, or a page of a group's index. */
  const depthOf = (screen: string): number => screen === 'home' ? 0 : UNDER[screen] ? 2 : 1;
  let machine = $derived(workspace.machines.find(machine => machine.store === store));
  const titleOf = (page: string): string => page === 'brain' ? strings.brain.heading : page === 'phone' ? strings.mobile.settingsPhone
    : page === 'general' ? strings.settings.tabs.general
    : page === 'advanced' ? strings.settings.tabs.advanced
    : page === 'conversations' ? strings.settings.conversations
    : page === 'accounts' ? strings.settings.tabs.accounts
    : page === 'browser' ? strings.settings.tabs.browser
    : page === 'archived' ? strings.settings.archived.heading
    : page === 'worktrees' ? strings.settings.worktrees.heading
    : page === 'voice' ? strings.speech.heading : page === 'appearance' ? strings.settings.tabs.appearance
    : page === 'usage' ? strings.usage.heading : page === 'limits' ? strings.usage.limits
    : page === 'plugins' ? strings.settings.tabs.plugins
    : page === 'task-manager' ? strings.taskManager.title
    : page === 'diagnostics' ? strings.diagnostics.heading
    : page === 'experiments' ? strings.settings.tabs.experiments : strings.settings.tabs.machines;
  /** The page's own title and its info mark step aside for the bar, so the bar carries the mark. */
  const infoOf = (page: string): string => page === 'usage' ? `${strings.usage.intro} ${strings.usage.note}`
    : page === 'worktrees' ? strings.settings.worktrees.intro
    : page === 'plugins' ? strings.plugins.intro
    : page === 'experiments' ? strings.settings.experiments.intro : '';
  let detail = $derived(page !== 'home');
  /** The pages that change one machine whole, its bar under their header. */
  const MACHINE_PAGES = ['accounts', 'plugins', 'brain', 'voice', 'limits', 'diagnostics', 'worktrees', 'archived'];
  /**
   * A page of one machine's agent settings says so under its header, the machine's name the picker
   * where there are several; other pages show their title alone. Limits names its machine in its title already.
   */
  const scopeOf = (page: string): string | null => {
    if (scopes.line === 'device') return strings.settings.scopeDevice;
    if (scopes.line !== 'machine' || page === 'limits' || (bar && !pick)) return null;
    const shown = workspace.machines.find((m) => m.store === target);
    return shown ? fill(strings.settings.scopeMachine, { machine: machineName(shown) }) : null;
  };
  /** The phone's pages by where they save: on a mixed one (Conversations, with the machine's card) only the card that differs tags itself (`lib/page-scope.svelte.ts`). */
  const DEVICE_PAGES = ['appearance', 'browser', 'conversations'];
  const scopes = providePageScope(new PageScope(
    () => (page === 'limits' ? null : MACHINE_PAGES.includes(page) ? 'machine' : DEVICE_PAGES.includes(page) ? 'device' : null),
    () => (bar ? pick : undefined)
  ));

  /**
   * A page slides in over the screen it opens from and back off it, as the
   * conversation does over the list (MobileNavigation). From one page to
   * another at the same depth, the two tabs of Usage included, the page is
   * simply replaced.
   */
  const slide = new ScreenSlide();
  /**
   * The screen a move deeper or back brought in, slid or not: it shows
   * without the fade a replaced page plays, which after Safari's own swipe
   * back would be a second animation.
   */
  let arrived = $state<string | null>(null);
  slide.follow(() => page, (from, to) => {
    const way = depthOf(to) > depthOf(from) ? 'push' : depthOf(to) < depthOf(from) ? 'pop' : null;
    arrived = way ? to : null;
    return way;
  });
  /**
   * What Home's rows hold now, read again each time Home shows: the theme and
   * the language the app speaks, whether dictation is ready on the machine
   * Voice shows (unknown, no word, on a machine that cannot say).
   */
  let appearance = $derived.by(() => {
    void page;
    // Read through `strings` each time, so the theme word follows a language just picked.
    const words = { system: strings.settings.themeSystem, dark: strings.settings.themeDark, light: strings.settings.themeLight, grain: strings.settings.themeGrain };
    return `${words[readTheme()]} · ${strings.settings.languageNames[activeLocale()]}`;
  });
  let connected = $derived(store.connection === 'ready' && !store.pairingRequired);
  /** The last answer and the machine it came from: shown only while that machine is the one picked and in reach. */
  let voice = $state.raw<{ of: Store; ready: boolean } | null>(null);
  let voiceReady = $derived(voice && voice.of === target && target.connection === 'ready' ? voice.ready : null);
  $effect(() => {
    const client = target.client, of = target;
    if (page !== 'home' || !client || target.connection !== 'ready') return;
    let live = true;
    client.call('speech.status', {}).then((status) => { if (live) voice = { of, ready: status.ready }; }, () => { if (live) voice = null; });
    return () => { live = false; };
  });
  /** During a slide the screen it leaves stays drawn; the one on top comes last, so it paints over the other. */
  let screens = $derived(slide.direction && slide.from ? (slide.direction === 'push' ? [slide.from, page] : [page, slide.from]) : [page]);
  /** Which of `app.css`'s screen keyframes plays on a screen, during a slide. */
  function motionOf(shown: string): string | undefined {
    if (screens.length < 2) return undefined;
    if (slide.direction === 'push') return shown === page ? 'in' : 'under-out';
    return shown === page ? 'under-in' : 'out';
  }
  /** One history entry a level, so Back climbs from a page to its group, then Home. */
  let deeper = $derived(depthOf(page) >= 2);
  $effect(() => { if (detail) return mobileOverlay(() => { local = null; store.showSettings(); }); });
  $effect(() => { if (deeper) return mobileOverlay(back); });

  $effect(() => {
    if (page === 'phone' && store.connection === 'ready') void store.loadSessions();
  });
  function back() {
    const group = UNDER[page];
    local = null;
    store.showSettings(group);
  }

  // Resources and the task manager are Diagnostics' last sections: their route scrolls to its section, or to its card.
  $effect(() => {
    const route = store.settingsTab, section = store.settingsSection?.id;
    if (page !== 'diagnostics' || (route !== 'task-manager' && route !== 'resources')) return;
    let release = () => {};
    let live = true;
    void tick().then(() => {
      const id = section && document.getElementById(`settings-${section}`) ? section : route;
      if (live && revealSettingsCard(id, false, 'instant')) release = holdSettingsCard(id);
    });
    return () => { live = false; release(); };
  });

  // A settings card in a conversation opened this page to show one card: scroll to it and light it up.
  $effect(() => {
    const section = store.settingsSection;
    if (!section?.flash) return;
    void tick().then(() => revealSettingsCard(section.id, true, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'));
  });
</script>

<!-- A row says where it leads by its icon and its words, the icon the desktop's nav gives the same entry,
     and what it holds now, when that fits a word, before its chevron. -->
{#snippet row(testid: string, label: string, go: () => void, icon: keyof typeof SETTINGS_ICONS, value?: string)}
  {@const Icon = SETTINGS_ICONS[icon]}
  <button class="ghost row" data-testid={testid} onclick={go}><Icon class="lead" size={SETTINGS_ICON_SIZE} strokeWidth={SETTINGS_ICON_STROKE} aria-hidden="true" /><span class="ui-label">{label}</span>{#if value}<small class="value ui-label" data-testid="{testid}-value">{value}</small>{/if}<ChevronRight size={18} /></button>
{/snippet}

<!-- `settings` gives the detail pages the same grammar as the desktop ones. `data-detail` lets the app drop
     its own header over a page, which carries its own with the way back (App.svelte). -->
<div class="mobile-settings settings" class:sliding={screens.length > 1} data-testid="settings" data-detail={detail || undefined} use:slide.attach>
  {#each screens as shown (shown)}
  <div class="settings-screen" class:left={shown !== page} class:arrived={shown === arrived} data-slide={motionOf(shown)} inert={shown !== page || slide.direction === 'pop'}>
  {#if shown === 'home'}
    <!-- The header already says Settings: the screen opens on the desktop's search, then the groups as its nav lists them. -->
    <div class="home" data-testid="mobile-settings-home">
      {@render search?.(true)}
      {#if found}<div class="found">{@render found()}</div>{:else}
      <PolicyBanner store={target} />
      <!-- The desktop's family heads (lib/settings-tabs.ts `SETTINGS_FAMILIES`), each over its own card of rows. -->
      <section class="family" aria-labelledby="mobile-family-app" data-testid="settings-family" data-family="app">
        <h2 class="family-head ui-label" id="mobile-family-app">{strings.settings.families.app}</h2>
        <div class="rows">
          {@render row('settings-tab-general', strings.settings.tabs.general, () => store.showSettings('general'), 'general')}
          {@render row('settings-tab-voice', strings.speech.heading, () => store.showSettings('voice'), 'voice', voiceReady === null ? undefined : voiceReady ? strings.settings.homeOn : strings.settings.homeOff)}
          {@render row('settings-tab-appearance', strings.settings.tabs.appearance, () => store.showSettings('appearance'), 'appearance', appearance)}
        </div>
      </section>
      <section class="family" aria-labelledby="mobile-family-agents" data-testid="settings-family" data-family="agents">
        <h2 class="family-head ui-label" id="mobile-family-agents">{strings.settings.families.agents}</h2>
        <div class="rows">
          {#if store.owner}{@render row('settings-tab-accounts', strings.settings.tabs.accounts, () => store.showSettings('accounts'), 'accounts')}{/if}
          {#if store.owner}{@render row('settings-tab-plugins', strings.settings.tabs.plugins, () => store.showSettings('plugins'), 'plugins')}{/if}
          {#if store.owner}{@render row('settings-tab-brain', strings.brain.heading, () => store.showSettings('brain'), 'brain')}{/if}
          <!-- Limits and Usage are peers, as on the desktop; their screen keeps both as two tabs. -->
          {@render row('settings-tab-limits', strings.usage.limits, () => store.showSettings('limits'), 'limits')}
          {@render row('settings-tab-usage', strings.usage.heading, () => store.showSettings('usage'), 'usage')}
        </div>
      </section>
      <section class="family" aria-labelledby="mobile-family-connections" data-testid="settings-family" data-family="connections">
        <h2 class="family-head ui-label" id="mobile-family-connections">{strings.settings.families.connections}</h2>
        <div class="rows">
          {#if store.owner}{@render row('settings-tab-browser', strings.settings.tabs.browser, () => store.showSettings('browser'), 'browser')}{/if}
          <!-- Machines carries the machine this phone reaches, a green dot while connected, and the state word otherwise. -->
          <button class="ghost row machine-link" data-testid="mobile-settings-connection" onclick={() => store.showSettings('machines')}>
            <Monitor class="lead" size={SETTINGS_ICON_SIZE} strokeWidth={SETTINGS_ICON_STROKE} aria-hidden="true" /><span class="ui-label">{strings.settings.tabs.machines}</span>
            <small class="value ui-label" data-testid="mobile-settings-connection-value" title={store.pairingRequired ? strings.mobile.pairingRequired : strings.connection[store.connection]}>{#if connected}<span class="dot" aria-hidden="true"></span>{machine ? machineName(machine) : strings.connection.ready}{:else}{store.pairingRequired ? strings.mobile.pairingRequired : strings.connection[store.connection]}{/if}</small><ChevronRight size={18} />
          </button>
        </div>
      </section>
      <section class="family" aria-labelledby="mobile-family-advanced" data-testid="settings-family" data-family="advanced">
        <h2 class="family-head ui-label" id="mobile-family-advanced">{strings.settings.families.advanced}</h2>
        <div class="rows">
          <!-- System holds one card on a phone, the machine's compaction: a paired phone has none to show. -->
          {#if target.owner}{@render row('settings-tab-advanced', strings.settings.tabs.advanced, () => store.showSettings('advanced'), 'advanced')}{/if}
          <!-- The phone follows the desktop app's experiments until it flips one here, and can follow it again from this page. -->
          {@render row('settings-tab-experiments', strings.settings.tabs.experiments, () => store.showSettings('experiments'), 'experiments')}
          <!-- The task manager is Diagnostics' last section (lib/settings-tabs.ts); a paired phone, without the logs, opens it alone. -->
          {#if store.owner}{@render row('settings-tab-diagnostics', strings.diagnostics.heading, () => store.showSettings('diagnostics'), 'diagnostics')}
          {:else}{@render row('settings-tab-task-manager', strings.taskManager.title, () => store.showSettings('task-manager'), 'task-manager')}{/if}
        </div>
      </section>
      <PolicySettings store={target} />
      {/if}
    </div>
  {:else}
    {@const title = titleOf(shown)}
    {@const info = infoOf(shown)}
    {@const scope = scopeOf(shown)}
    <!-- Usage and Limits are one screen on a phone, two tabs of it. -->
    {@const quota = shown === 'usage' || shown === 'limits'}
    <header class:limits={shown === 'limits'} data-testid="mobile-settings-header">
      <button class="ghost icon" data-testid="mobile-settings-back" aria-label={strings.mobile.settingsBack} onclick={back}><ArrowLeft size={20} /></button>
      <!-- The thread header's grammar: back, the title, one context line under it (where these settings apply). -->
      <div class="heading">
        <h1>{#if shown === 'limits'}<QuotaMachineScope store={target} fallback={title} />{:else}{title}{/if}{#if info}<InfoTip topic={title} text={info} testid="mobile-settings-info" />{/if}</h1>
        {#if scope}
          {@const picks = scopes.line === 'machine' && pick && bar}
          <p class="scope page-scope" class:picks data-testid="mobile-settings-page-scope" data-scope={scopes.line}>{#if scopes.line === 'device'}<MonitorSmartphone size={14} strokeWidth={1.75} aria-hidden="true" />{:else if !picks}<Monitor size={14} strokeWidth={1.75} aria-hidden="true" />{/if}{#if picks && pick}{@render pick(strings.settings.scopeMachine)}{:else}<span class="ui-label">{scope}</span>{/if}</p>
        {/if}
      </div>
    </header>
    <div class="detail" data-testid="mobile-settings-detail">
      {#if bar && MACHINE_PAGES.includes(shown)}<div class="bar">{@render (pick && shown !== 'limits' && notes ? notes : bar)()}</div>{/if}
      {#key target}
      {#if quota}
        <div class="tabs" role="tablist" aria-label={strings.usage.heading} data-testid="mobile-usage-tabs">
          <button type="button" role="tab" class="tab" class:on={shown === 'limits'} aria-selected={shown === 'limits'} data-testid="mobile-usage-tab-limits" onclick={() => store.showSettings('limits')}><span class="ui-label">{strings.usage.limits}</span></button>
          <button type="button" role="tab" class="tab" class:on={shown === 'usage'} aria-selected={shown === 'usage'} data-testid="mobile-usage-tab-usage" onclick={() => store.showSettings('usage')}><span class="ui-label">{strings.usage.heading}</span></button>
        </div>
      {/if}
      {#if shown === 'general'}
        <div class="page index" data-testid="mobile-settings-general">
          <div class="rows">
            {@render row('mobile-settings-conversations', strings.settings.conversations, () => store.showSettings('general', 'conversations'), 'conversations')}
            {@render row('mobile-settings-phone', strings.mobile.settingsPhone, () => openLocal('phone'), 'phone')}
            {@render row('mobile-settings-archived', strings.settings.archived.heading, () => store.showSettings('general', 'archived'), 'archived')}
            <!-- The keys agents ask for live under Providers, the windows agents may see under Machines. -->
            {#if store.owner}
              {@render row('mobile-settings-worktrees', strings.settings.worktrees.heading, () => store.showSettings('general', 'worktrees'), 'worktrees')}
            {/if}
          </div>
          <!-- Privacy is two switches: a card at the index's foot, not a page of its own. -->
          <TelemetrySettings {store} />
        </div>
      {:else if shown === 'advanced'}
        <div class="page index" data-testid="mobile-settings-advanced">
          <!-- Compaction is the one card of System a phone carries, under the machine it changes. -->
          {#if target.owner}
            {#if bar}<div class="bar inline">{@render bar()}</div>{/if}
            <div class="card-slot" id="settings-auto-compact"><CompactionSettings store={target} /></div>
          {/if}
        </div>
      {:else if shown === 'accounts' && target.owner}
        <AccountsPage store={target} />
      {:else if shown === 'browser' && store.owner}
        <BrowserPage />
      {:else if shown === 'conversations'}
        <!-- General's Conversations card, the switches this phone keeps; the list groups from its own display options. -->
        <div class="page"><section class="card" id="settings-conversations"><h2><span class="ui-label">{strings.settings.inConversation}</span><CardScope /></h2><ConversationSwitches part="conversation" phone /></section>
          <!-- How agents answer and Quiet change one machine: the first one's scope phrase holds the picker, the bar above keeps its notes. -->
          {#if target.owner}{#if bar}<div class="bar inline">{@render (pick && notes ? notes : bar)()}</div>{/if}<AgentRepliesSettings store={target} /><QuietCard store={target} />{/if}
        </div>
      {:else if shown === 'brain' && target.owner}
        <BrainPage store={target} />
      {:else if shown === 'phone'}
        <div class="page phone-page">
          <!-- Which machine these apply to, once there is a choice, and the connection when it is not working. -->
          {#if workspace.machines.length > 1 || store.connection !== 'ready'}
            <p class="scope" data-testid="mobile-settings-scope">{[workspace.machines.length > 1 ? (machine ? machineName(machine) : store.endpointUrl ?? strings.connection.current) : null, store.connection === 'ready' ? null : strings.connection[store.connection]].filter(Boolean).join(' · ')}</p>
          {/if}
          <PhoneSettings {store} showServerSettings={false} />
        </div>
      {:else if shown === 'voice'}
        <VoiceSettings store={target} readOnly />
      {:else if shown === 'appearance'}
        <AppearancePage {store} phone />
      {:else if shown === 'usage'}
        <UsagePage {store} />
      {:else if shown === 'limits'}
        <LimitsPage store={target} showTitle={false} />
      {:else if shown === 'task-manager'}
        <TaskManagerLoader {store} {onopenthread} />
      {:else if shown === 'plugins' && target.owner}
        <PluginsPage store={target} />
      {:else if shown === 'experiments'}
        <ExperimentsPage {store} {target} {bar} />
      {:else if shown === 'diagnostics' && target.owner}
        <div class="stack">
          <DiagnosticsPage store={target} {onopenthread} />
          <div class="merged" id="settings-resources"><ResourcesPage store={target} /></div>
          <div class="merged" id="settings-task-manager"><TaskManagerLoader store={target} {onopenthread} /></div>
        </div>
      {:else if shown === 'worktrees'}
        <div class="page worktrees-page"><WorktreesCard store={target} /></div>
      {:else if shown === 'archived'}
        <div class="page archived-page">
          <ArchivedThreads store={target} eager />
        </div>
      {:else}
        <MachinesPage mobile {onopenthread} {store} />
      {/if}
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
     While a page slides off, the home beneath it is out of reach too: a tap lands on neither. */
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
  /* The group's first row is the machine itself: its name over its connection. */
  /* What a row holds now, quieter than its name, shortened before the name is. */
  .row .value { flex: 0 1 auto; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .machine-link .value { display: inline-flex; align-items: center; gap: 6px; }
  .machine-link .dot { flex: none; width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-success); }
  p { font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.5; margin: var(--space-2) 0 var(--space-3); }
  /* A family: its head in the meta size over its card of rows, air between two. */
  .family + .family { margin-top: var(--space-5); }
  .family-head { margin: 0 0 var(--space-2) var(--space-1); color: var(--color-subtle); font-size: var(--text-meta); font-weight: var(--weight-title); }
  .rows { border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
  /* A ghost button is muted; a row title reads like any other settings label. */
  .row { display: flex; align-items: center; width: 100%; height: auto; min-height: 48px; gap: var(--space-3); padding: var(--space-3) var(--space-4); font-size: var(--text-base); font-weight: 400; text-align: left; border-radius: 0; white-space: normal; color: var(--color-foreground); }
  .row + .row { border-top: 1px solid var(--color-border); }
  .row span { flex: 1; min-width: 0; }
  .row :global(svg) { flex: none; color: var(--color-subtle); }
  /* The screen's one header: the app's own steps aside over a page (App.svelte), so this one takes the top inset. */
  header { flex: none; display: flex; align-items: center; gap: var(--space-2); min-height: 52px; padding: max(var(--space-2), env(safe-area-inset-top)) max(var(--space-3), env(safe-area-inset-right)) var(--space-2) max(var(--space-3), env(safe-area-inset-left)); border-bottom: 1px solid var(--color-border); }
  header .icon { width: 44px; min-height: 44px; }
  header h1 { margin: 0; font-size: var(--text-md); font-weight: 600; }
  header.limits h1 { flex: 1; min-width: 0; }
  .phone-page { padding: var(--space-4); }
  /* Usage and Limits: two tabs of one screen, in one track, the chosen one filled. */
  .tabs { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; margin: var(--space-4) var(--space-4) 0; padding: 2px; border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2); }
  .tab { min-width: 0; min-height: var(--touch-target); gap: var(--space-2); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint); }
  .tab.on { background: var(--color-foreground); border-color: var(--color-foreground); color: var(--color-on-foreground); }
  .scope { overflow-wrap: anywhere; margin-top: 0; }
  .phone-page :global(.card) { padding: var(--space-4); }
  .detail :global(.page), .detail :global(.machines-page) { padding: var(--space-4); }
  /* The header already names the screen: its first card starts close under it, its title's room and no more;
     a first card without a title (Voice's status) keeps no room for one. */
  .detail > :global(.page) { padding-top: var(--space-2); }
  .detail > :global(.page > :is(header + .card, .card:first-child, header + .settings-stack > .card:first-child)) { margin-top: var(--card-head); }
  .detail > :global(.page > :is(header + .card, .card:first-child, header + .settings-stack > .card:first-child):not(:has(> h2:first-child))) { margin-top: 0; }
  .bar { padding: var(--space-4) var(--space-4) 0; }
  /* Diagnostics then the task manager, one scroll: neither page scrolls on its own. */
  .stack > :global(.page), .stack > .merged > :global(.page) { height: auto; overflow: visible; }
  .stack > .merged > :global(.page) { padding-top: 0; }
  /* A merged page's title is its section's title. */
  .detail .stack > .merged > :global(.page > header) { display: flex; }
  .stack > .merged :global(.page > header h1) { font-size: var(--text-md); }
  .bar + :global(.page) { padding-top: var(--space-3); }
  /* The bar above already names the page, so its own title steps aside. */
  .detail :global(.page:not(.machines-page):not(.limits-page):not(.usage) > header),
  .detail :global(.machines-page .head h1),
  .detail :global(.limits-page > header h1),
  .detail :global(.usage > header h1) { display: none; }
  /* Their refresh joins the bar, at the right end: alone on a row it pushed the cards down. */
  .detail :global(.limits-page > header),
  .detail :global(.usage > header) { position: absolute; top: max(8px, env(safe-area-inset-top)); right: 12px; margin: 0; }
  .detail :global(.limits-page > header .refresh),
  .detail :global(.usage > header .refresh) { width: 44px; height: 44px; }
  .detail :global(.switch-row) { flex-wrap: wrap; gap: var(--space-3); }
  /* The bar names the page and the line above says what it holds: the card's own heading and tip step aside. */
  .archived-page :global(#settings-archived > h2) { display: none; }
  .worktrees-page :global(#settings-worktrees > h2) { display: none; }
  /* Its title stepped aside, the card keeps no room above it for one. */
  .archived-page :global(#settings-archived),
  .worktrees-page :global(#settings-worktrees) { margin-top: 0; }
  /* The title and its one context line, stacked as the thread header's (ThreadHeader.svelte). */
  .heading { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  header.limits .heading h1 { margin-right: 54px; }
  .page-scope { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 2px 0 0; color: var(--color-subtle); font-size: var(--text-meta); line-height: 1.3; }
  .page-scope > .ui-label { min-width: 0; }
  .page-scope > :global(svg) { flex: none; }
  /* A row's icon leads it in the grey of the chrome's icons; the chevron at its end stays the quietest. */
  .row :global(svg.lead) { color: var(--color-muted-foreground); }
  /* A bar inside a page, above the one card that changes a machine. */
  .bar.inline { padding: var(--space-5) 0 0; }
  /* Notes alone, with none to give: no band. */
  .bar.inline:not(:has(:global(.machine-bar > *))) { display: none; }
</style>
