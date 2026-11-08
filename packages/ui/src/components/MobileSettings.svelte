<script lang="ts">
  import TelemetrySettings from './TelemetrySettings.svelte';
  import { ArrowLeft, ChevronRight } from '@lucide/svelte';
  import type { SettingsTab, Store } from '../lib/store.svelte';
  import { machineName, workspace } from '../lib/workspace.svelte';
  import { strings } from '../lib/strings';
  import { mobileOverlay } from '../lib/mobile-history';
  import { ScreenSlide } from '../lib/screen-slide.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import AccountsPage from './AccountsPage.svelte';
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
  import ArchivedThreads from './ArchivedThreads.svelte';
  import WorktreesCard from './WorktreesCard.svelte';
  import WindowAllowlistCard from './WindowAllowlistCard.svelte';
  import WindowExclusionsCard from './WindowExclusionsCard.svelte';
  import SecretsCard from './SecretsCard.svelte';
  import BrowserProfilesCard from './BrowserProfilesCard.svelte';
  import CompactionSettings from './CompactionSettings.svelte';
  import InfoTip from './InfoTip.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import PolicySettings from './PolicySettings.svelte';
  import { tick, type Snippet } from 'svelte';
  import { holdSettingsCard, revealSettingsCard } from '../lib/settings-flash';
  import { phonePage } from '../lib/settings-tabs';

  /**
   * `target` is the machine the settings bar picked, `store` this window's:
   * the pages of one machine show the target, under the bar.
   */
  let { store, target = store, bar, onopenthread }: { store: Store; target?: Store; bar?: Snippet; onopenthread?: () => void } = $props();
  /**
   * Home lists the desktop's groups (`SETTINGS_GROUPS`) in the desktop's order
   * under the desktop's names, each one a phone has a page for. General and Advanced open an index of their pages: the cards a phone
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
  const UNDER: Record<string, 'general' | 'advanced'> = {
    phone: 'general', voice: 'general', conversations: 'general', archived: 'general', secrets: 'general', windows: 'general', worktrees: 'general',
    'task-manager': 'advanced', diagnostics: 'advanced', experiments: 'advanced'
  };
  /** Home, a group's screen, or a page of a group's index. */
  const depthOf = (screen: string): number => screen === 'home' ? 0 : UNDER[screen] ? 2 : 1;
  let machine = $derived(workspace.machines.find(machine => machine.store === store));
  const titleOf = (page: string): string => page === 'brain' ? strings.brain.heading : page === 'phone' ? strings.mobile.settingsPhone
    : page === 'general' ? strings.settings.tabs.general
    : page === 'advanced' ? strings.settings.tabs.advanced
    : page === 'conversations' ? strings.settings.conversations
    : page === 'accounts' ? strings.settings.tabs.accounts
    : page === 'archived' ? strings.settings.archived.heading
    : page === 'worktrees' ? strings.settings.worktrees.heading
    : page === 'windows' ? strings.windows.settings.allowedHeading
    : page === 'secrets' ? strings.secrets.heading
    : page === 'voice' ? strings.speech.heading : page === 'appearance' ? strings.settings.tabs.appearance
    : page === 'usage' ? strings.usage.heading : page === 'limits' ? strings.usage.limits
    : page === 'task-manager' ? strings.taskManager.title
    : page === 'diagnostics' ? strings.diagnostics.heading
    : page === 'experiments' ? strings.settings.tabs.experiments : strings.settings.tabs.machines;
  /** The page's own title and its info mark step aside for the bar, so the bar carries the mark. */
  const infoOf = (page: string): string => page === 'usage' ? `${strings.usage.intro} ${strings.usage.note}`
    : page === 'secrets' ? strings.secrets.info
    : page === 'worktrees' ? strings.settings.worktrees.intro
    : page === 'experiments' ? strings.settings.experiments.intro : '';
  let detail = $derived(page !== 'home');

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

<!-- A row says where it leads in words: an icon before each said nothing its name did not. -->
{#snippet row(testid: string, label: string, go: () => void)}
  <button class="ghost row" data-testid={testid} onclick={go}><span class="ui-label">{label}</span><ChevronRight size={18} /></button>
{/snippet}

<!-- `settings` gives the detail pages the same grammar as the desktop ones. `data-detail` lets the app drop
     its own header over a page, which carries its own with the way back (App.svelte). -->
<div class="mobile-settings settings" class:sliding={screens.length > 1} data-testid="settings" data-detail={detail || undefined} use:slide.attach>
  {#each screens as shown (shown)}
  <div class="settings-screen" class:left={shown !== page} class:arrived={shown === arrived} data-slide={motionOf(shown)} inert={shown !== page || slide.direction === 'pop'}>
  {#if shown === 'home'}
    <!-- The header already says Settings: the screen opens on the groups, as the desktop's nav lists them. -->
    <div class="home" data-testid="mobile-settings-home">
      <PolicyBanner store={target} />
      <div class="rows">
        {@render row('settings-tab-general', strings.settings.tabs.general, () => store.showSettings('general'))}
        {@render row('settings-tab-appearance', strings.settings.tabs.appearance, () => store.showSettings('appearance'))}
        {#if store.owner}{@render row('settings-tab-accounts', strings.settings.tabs.accounts, () => store.showSettings('accounts'))}{/if}
        {#if store.owner}{@render row('settings-tab-brain', strings.brain.heading, () => store.showSettings('brain'))}{/if}
        <!-- Usage is a page of Limits, as on the desktop: the entry wears the rail's gauge and opens on the limits. -->
        {@render row('settings-tab-limits', strings.usage.limits, () => store.showSettings('limits'))}
        <!-- Machines carries the machine this phone reaches and how. -->
        <button class="ghost row machine-link" data-testid="mobile-settings-connection" onclick={() => store.showSettings('machines')}>
          <span><strong class="ui-label">{strings.settings.tabs.machines}</strong><small>{#if machine}{`${machineName(machine)} · `}{/if}<span class:ready={store.connection === 'ready'}>{store.pairingRequired ? strings.mobile.pairingRequired : strings.connection[store.connection]}</span></small></span><ChevronRight size={18} />
        </button>
        {@render row('settings-tab-advanced', strings.settings.tabs.advanced, () => store.showSettings('advanced'))}
      </div>
      <PolicySettings store={target} />
    </div>
  {:else}
    {@const title = titleOf(shown)}
    {@const info = infoOf(shown)}
    <!-- Usage and Limits are one screen on a phone, two tabs of it. -->
    {@const quota = shown === 'usage' || shown === 'limits'}
    <header class:limits={shown === 'limits'} data-testid="mobile-settings-header">
      <button class="ghost icon" data-testid="mobile-settings-back" aria-label={strings.mobile.settingsBack} onclick={back}><ArrowLeft size={20} /></button>
      <h1>{#if shown === 'limits'}<QuotaMachineScope store={target} fallback={title} />{:else}{title}{/if}{#if info}<InfoTip topic={title} text={info} testid="mobile-settings-info" />{/if}</h1>
    </header>
    <div class="detail" data-testid="mobile-settings-detail">
      {#if bar && ['accounts', 'brain', 'voice', 'limits', 'diagnostics', 'worktrees', 'windows', 'secrets', 'archived'].includes(shown)}<div class="bar">{@render bar()}</div>{/if}
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
            {@render row('mobile-settings-conversations', strings.settings.conversations, () => store.showSettings('general', 'conversations'))}
            {@render row('mobile-settings-phone', strings.mobile.settingsPhone, () => openLocal('phone'))}
            {@render row('settings-tab-voice', strings.speech.heading, () => store.showSettings('voice'))}
            {@render row('mobile-settings-archived', strings.settings.archived.heading, () => store.showSettings('general', 'archived'))}
            {@render row('mobile-settings-secrets', strings.secrets.heading, () => store.showSettings('general', 'secrets'))}
            {#if store.owner}
              {@render row('mobile-settings-windows', strings.windows.settings.allowedHeading, () => store.showSettings('general', 'windows'))}
              {@render row('mobile-settings-worktrees', strings.settings.worktrees.heading, () => store.showSettings('general', 'worktrees'))}
            {/if}
          </div>
          <!-- Privacy is two switches: a card at the index's foot, not a page of its own. -->
          <TelemetrySettings {store} />
        </div>
      {:else if shown === 'advanced'}
        <div class="page index" data-testid="mobile-settings-advanced">
          <div class="rows">
            <!-- The phone follows the desktop app's experiments until it flips one here, and can follow it again from this page. -->
            {@render row('settings-tab-experiments', strings.settings.tabs.experiments, () => store.showSettings('experiments'))}
            <!-- The task manager is Diagnostics' last section (lib/settings-tabs.ts); a paired phone, without the logs, opens it alone. -->
            {#if store.owner}{@render row('settings-tab-diagnostics', strings.diagnostics.heading, () => store.showSettings('diagnostics'))}
            {:else}{@render row('settings-tab-task-manager', strings.taskManager.title, () => store.showSettings('task-manager'))}{/if}
          </div>
          <!-- Compaction is one card: it sits at the index's foot, under the machine it changes. -->
          {#if target.owner}
            {#if bar}<div class="bar inline">{@render bar()}</div>{/if}
            <div class="card-slot" id="settings-auto-compact"><CompactionSettings store={target} /></div>
          {/if}
        </div>
      {:else if shown === 'accounts' && target.owner}
        <AccountsPage store={target} />
      {:else if shown === 'conversations'}
        <!-- General's Conversations card, the switches this phone keeps; the list groups from its own display options. -->
        <div class="page"><section class="card" id="settings-conversations"><ConversationSwitches phone /></section>
          <!-- Quiet changes one machine: its bar sits above it, not above this phone's switches. -->
          {#if target.owner}{#if bar}<div class="bar inline">{@render bar()}</div>{/if}<QuietCard store={target} />{/if}
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
      {:else if shown === 'experiments'}
        <ExperimentsPage {store} {target} {bar} />
      {:else if shown === 'diagnostics' && target.owner}
        <div class="stack">
          <DiagnosticsPage store={target} {onopenthread} />
          <div class="merged" id="settings-resources"><ResourcesPage store={target} /></div>
          <div class="merged" id="settings-task-manager"><TaskManagerLoader {store} {onopenthread} /></div>
        </div>
      {:else if shown === 'worktrees'}
        <div class="page worktrees-page"><WorktreesCard store={target} /></div>
      {:else if shown === 'windows'}
        <div class="page"><WindowAllowlistCard store={target} /><WindowExclusionsCard store={target} /></div>
      {:else if shown === 'secrets'}
        <div class="page secrets-page"><SecretsCard />{#if store.owner}<BrowserProfilesCard />{/if}</div>
      {:else if shown === 'archived'}
        <div class="page archived-page">
          <ArchivedThreads store={target} eager />
        </div>
      {:else}
        <MachinesPage mobile {onopenthread} />
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
  .machine-link { min-height: 56px; }
  .machine-link strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
  .machine-link small { display: block; margin-top: var(--space-1); font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .machine-link small .ready { color: var(--color-success); }
  p { font-size: var(--text-sm); color: var(--color-muted-foreground); line-height: 1.5; margin: var(--space-2) 0 var(--space-3); }
  .rows { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); }
  /* A ghost button is muted; a row title reads like any other settings label. */
  .row { display: flex; align-items: center; width: 100%; height: auto; min-height: 48px; gap: var(--space-3); padding: var(--space-3) var(--space-4); font-size: var(--text-base); font-weight: 400; text-align: left; border-radius: 0; white-space: normal; color: var(--color-foreground); }
  .row + .row { border-top: 1px solid var(--color-border); }
  .row span { flex: 1; min-width: 0; }
  .row :global(svg) { flex: none; color: var(--color-subtle); }
  /* The screen's one header: the app's own steps aside over a page (App.svelte), so this one takes the top inset. */
  header { flex: none; display: flex; align-items: center; gap: var(--space-2); min-height: 52px; padding: max(var(--space-2), env(safe-area-inset-top)) max(var(--space-3), env(safe-area-inset-right)) var(--space-2) max(var(--space-3), env(safe-area-inset-left)); border-bottom: 1px solid var(--color-border); }
  header .icon { width: 44px; min-height: 44px; }
  header h1 { margin: 0; font-size: var(--text-md); font-weight: 600; }
  header.limits h1 { flex: 1; min-width: 0; margin-right: 54px; }
  .phone-page { padding: var(--space-4); }
  /* Usage and Limits: two tabs of one screen, in one track, the chosen one filled. */
  .tabs { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; margin: var(--space-4) var(--space-4) 0; padding: 2px; border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2); }
  .tab { min-width: 0; min-height: var(--touch-target); gap: var(--space-2); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint); }
  .tab.on { background: var(--color-foreground); border-color: var(--color-foreground); color: var(--color-on-foreground); }
  .scope { overflow-wrap: anywhere; margin-top: 0; }
  .phone-page :global(.card) { padding: var(--space-4); }
  .detail :global(.page), .detail :global(.machines-page) { padding: var(--space-4); }
  /* The header already names the screen: its first card starts close under it, its title's room and no more. */
  .detail > :global(.page) { padding-top: var(--space-2); }
  .detail > :global(.page > :is(header + .card, .card:first-child, header + .settings-stack > .card:first-child)) { margin-top: var(--card-head); }
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
  .secrets-page :global(#settings-secrets > h2),
  .worktrees-page :global(#settings-worktrees > h2) { display: none; }
  /* Its title stepped aside, the card keeps no room above it for one. */
  .archived-page :global(#settings-archived),
  .secrets-page :global(#settings-secrets),
  .worktrees-page :global(#settings-worktrees) { margin-top: 0; }
  /* A bar inside a page, above the one card that changes a machine. */
  .bar.inline { padding: var(--space-5) 0 0; }
</style>
