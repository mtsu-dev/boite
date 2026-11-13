<script lang="ts">
  import { needsYou, rowAsks } from '../lib/status-order';
  import { tick } from 'svelte';
  import WindowList from './WindowList.svelte';
  import MobileTabs from './MobileTabs.svelte';
  import ThreadHeader from './ThreadHeader.svelte';
  import { ArrowLeft, ArrowUpDown, ChevronDown, ChevronRight, Ellipsis, MessageSquare, Monitor, Plus, Search, Settings, X } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import MobileConnect from './MobileConnect.svelte';
  import type { Store } from '../lib/store.svelte';
  import { machineName, workspace } from '../lib/workspace.svelte';
  import { fill, strings } from '../lib/strings';
  import { count, projectName } from '../lib/format';
  import { mobileOverlay } from '../lib/mobile-history';
  import { groupWorkingThread, recentPreferences } from '../lib/recent.svelte';
  import { pickThreadAction, threadMenuItems } from '../lib/thread-menu';
  import { projectMenu } from '../lib/project-menu';
  import type { MenuItem } from '../lib/menu';
  import type { ThreadSummary } from '@boite/contracts';
  import Menu from './Menu.svelte';
  import { whipEntry } from '../lib/whip-entry.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { mobileChrome } from '../lib/mobile-chrome.svelte';
  import { focusOnMount } from '../lib/actions';
  import { watchRowCut } from '../lib/row-cut';
  import MobileThreadRow from './MobileThreadRow.svelte';
  import FoldMore from './FoldMore.svelte';
  import DisplayOptions from './DisplayOptions.svelte';
  import ViewSwitch from './ViewSwitch.svelte';
  import FilterChips from './FilterChips.svelte';
  import RecentGroup from './RecentGroup.svelte';
  import RecentDone from './RecentDone.svelte';
  import ProjectThreadCounters from './ProjectThreadCounters.svelte';
  import ProjectShelf from './ProjectShelf.svelte';
  import ProjectCardsSection from './ProjectCardsSection.svelte';
  import DraftRow from './DraftRow.svelte';
  import GroupLabel from './GroupLabel.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import MachinePlace from './MachinePlace.svelte';
  import MachineOffline from './MachineOffline.svelte';
  import ProjectRollup from './ProjectRollup.svelte';
  import { projectKey, projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { activeProject, archiveCount, projectSections, projectThreadView } from '../lib/project-threads.svelte';
  import { workingThread } from '../lib/recent.svelte';
  import { compareEntries, compareRecent } from '../lib/thread-order';
  import { rowPlaces, type RowPlace } from '../lib/row-place';
  import { feedWhere } from '../lib/feed-row';
  import { hostName } from '../lib/machine-host';
  import { activityFeed, feedGroups, storeNeeds, type FeedKind, type FeedVerb } from '../lib/activity-feed';
  import { tabHeader } from '../lib/tab-header.svelte';
  import EmptyState from './EmptyState.svelte';
  import MarkAllRead from './MarkAllRead.svelte';
  import { threadsNeedingYou } from '../lib/app-rail';
  import { needsUser, projectRollup, threadState } from '../lib/thread-state';
  import { foldQuiet } from '../lib/card-fold';
  import { minuteClock } from '../lib/clock.svelte';
  import { needsAnAI } from '../lib/first-run';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { contactsParts } from '../lib/contacts-entry';
  import { ScreenSlide } from '../lib/screen-slide.svelte';
  import { doneFilter, feedPlace, feedThread, inbox } from '../lib/inbox.svelte';
  import { followActivityReturn, leaveForAct, restoreActivity } from '../lib/activity-return.svelte';

  let { store, recover = false, screen = $bindable('chat'), tabbed = $bindable(false) }: { store: Store; recover?: boolean; screen: 'chat' | 'threads' | 'activity'; tabbed?: boolean } = $props();
  const narrow = new MediaQuery('(max-width: 720px)');
  /**
   * A conversation slides in over the list it opens from, and back off it to
   * the list; between the bottom bar's places, or to a page, nothing slides.
   * The stage is the app's grid, around this header: the conversation is its `.body`.
   */
  const slide = new ScreenSlide();
  slide.follow(() => narrow.current && store.page === 'chat' && !recover ? (screen === 'chat' ? 'chat' : 'list') : null, (_, to) => to === 'chat' ? 'push' : 'pop');
  let header = $state<HTMLElement>();
  $effect(() => { if (header?.parentElement) return slide.watch(header.parentElement); });
  /** The list a conversation opens from stays under it, as it was, while the conversation slides in. */
  let lastList = $state<'threads' | 'activity'>('threads');
  $effect.pre(() => { if (screen !== 'chat') lastList = screen; });
  const leaving = $derived(slide.direction === 'push');
  const listScreen = $derived(leaving ? lastList : screen);
  // The contacts under the projects, loaded with their experiment; a desktop window shows them in the column on the right.
  let SidebarContacts = $state<typeof import('./home/SidebarContacts.svelte').default>();
  let ContactRequestNotice = $state<typeof import('./home/ContactRequestNotice.svelte').default>();
  let ContactInboxRows = $state<typeof import('./home/ContactInboxRows.svelte').default>();
  $effect(() => {
    if (!contactsShown(store) || SidebarContacts) return;
    void contactsParts?.SidebarContacts().then(module => { SidebarContacts = module.default; }).catch(() => {});
    void contactsParts?.ContactRequestNotice().then(module => { ContactRequestNotice = module.default; }).catch(() => {});
    void contactsParts?.ContactInboxRows().then(module => { ContactInboxRows = module.default; }).catch(() => {});
  });
  let search = $state('');
  const query = $derived(search.trim().toLocaleLowerCase());
  const chatting = $derived(screen === 'chat' && !recover && store.page === 'chat');
  /** No AI yet and no thread open: the screen is the first run's, with nothing to go back to and no thread to name. */
  const firstRun = $derived(chatting && !store.openThread && needsAnAI(store));
  /** The bottom bar: on every list and page, the recovery screen too, not in a conversation nor in one a page opened. Only a phone's width draws it. */
  $effect.pre(() => { tabbed = !chatting && store.page !== 'settings' && !(store.page === 'agents' && mobileChrome.detail); });
  /** What the header names: the page, or the list on screen; the thread list by its view, so Projects and Recent tell apart. */
  const title = $derived(store.page === 'settings' ? strings.settings.heading : store.page === 'agents' ? strings.agents.heading : store.page === 'home' ? strings.contacts.heading
    : recover ? 'Boite' : screen === 'activity' ? strings.mobile.activity : workspace.view === 'recent' ? strings.sidebar.recentView : strings.sidebar.projectsView);
  let scrollRoot = $state<HTMLElement>();
  /** How far above the foot the list's fade ends at rest, so no row shows half above the tabs (lib/row-cut.ts). */
  let cut = $state(0);
  $effect(() => { const box = scrollRoot; if (box) return watchRowCut(box, value => { cut = value; }); });
  const scrollPositions = new Map<string, number>();
  const measuredRows = new Map<string, Map<string, number>>();
  function measurements(key: string): Map<string, number> {
    if (!measuredRows.has(key)) measuredRows.set(key, new Map());
    return measuredRows.get(key)!;
  }
  const listKey = $derived(`${listScreen}:${workspace.view}:${projectView.filter}`);
  $effect(() => { if (narrow.current && scrollRoot) { const saved = scrollPositions.get(listKey) ?? 0; void tick().then(() => { if (scrollRoot) scrollRoot.scrollTop = saved; }); } });
  /** The clock the rows' times read: a minute's precision is all they show. */
  const now = $derived(minuteClock.now);
  let machines = $derived(workspace.machinesOr(store));
  let machine = $derived(machines.find(m => m.store === store));
  let several = $derived(machines.length > 1);
  /** The project cards whose quiet threads were asked for, by project key, for this session. */
  let unfolded = $state<Record<string, true>>({});
  /** Shows a card's quiet threads, or folds them back. */
  function toggleFold(key: string) {
    const { [key]: was, ...rest } = unfolded;
    unfolded = was ? rest : { ...rest, [key]: true };
  }
  /**
   * The machine line names where the page reads: worth a line only once there is another to pick, or this one is not
   * there. Activity, Bots and Contacts gather every machine's rows, so there it only says trouble.
   */
  let gathered = $derived(store.page === 'agents' || store.page === 'home' || (store.page === 'chat' && listScreen === 'activity'));
  let placeShown = $derived((several && !gathered) || store.connection !== 'ready' || store.pairingRequired);
  /** With the bots on, Contacts is the Bots tab's other side (MobileTabs.svelte): its page's name is the switch between them. */
  let botsAndContacts = $derived((store.page === 'agents' || store.page === 'home') && !recover && experimentOn('resident-agents') && contactsShown(store));
  let place = $derived(store.pairingRequired ? strings.mobile.pairingRequired : store.connection === 'ready' ? (machine ? machineName(machine) : strings.mobile.computer) : strings.connection[store.connection]);
  let project = $derived(store.openProject ?? store.projects.find(p => p.archived !== true));
  let groups = $derived(projectView.sorted(machines.flatMap(machine => machine.store.projects.filter(project => !project.archived).map(project => ({ machine, project })))));
  /** The thread list on screen, with projects to show: its header names its two views. */
  let threadViews = $derived(listScreen === 'threads' && store.page === 'chat' && !recover && groups.length > 0);
  /** At work on top when working grouping is on, open, then set aside; idle projects go to their fold, as on the desktop. */
  let sections = $derived(projectSections(groups, recentPreferences.groupOtherProjects, recentPreferences.groupWorking));
  let shelved = $derived(machines.flatMap(machine => machine.store.projects.filter(project => project.archived === true).map(project => ({ machine, project }))));
  let selected = $derived(projectView.selected(groups));
  let draftOwner = $derived(listScreen === 'threads' && workspace.view === 'recent' && selected ? selected.machine.store : store);
  let entries = $derived(machines.flatMap(machine => {
    const byId = new Map(machine.store.projects.map(p => [p.id, p]));
    // A team's chat is listed with the bots (`agents/AgentsRail.svelte`), not among the threads.
    return machine.store.threads.filter(feedThread).map(thread => ({ machine, thread, project: thread.projectId === null ? undefined : byId.get(thread.projectId) }));
  }));
  let waiting = $derived(entries.filter(e => needsUser(e.thread)));
  /** What waits on the user besides the conversation on screen: Back carries its mark. */
  let elsewhere = $derived(waiting.filter(e => !(e.machine.store === store && e.thread.id === store.openThread?.id)).length);
  const matches = (e: typeof entries[number]) => !query || [e.thread.title, projectName(e.project), e.thread.branch, e.machine.label].some(value => value?.toLocaleLowerCase().includes(query));
  /** Activity: what needs the user, failures included, then the updates, each with its reason; sub-agents under their parent. */
  let rows: (typeof entries[number] & { reason?: string; place?: string; at?: number; nested?: boolean; section?: 'needs' | 'updates'; verb?: FeedVerb | null; kind?: FeedKind | null })[] = $derived(listScreen === 'activity'
    ? activityFeed(entries.filter(matches), feedPlace)
    : entries.filter(e => matches(e) && !e.thread.parentThreadId && !e.project?.archived && (workspace.view !== 'recent' || !selected || (e.machine.id === selected.machine.id && e.thread.projectId === selected.project.id)))
      // Recent is a flat history, newest first under the pins, as on the desktop; the cards rank by status.
      .sort(listScreen === 'threads' && workspace.view === 'recent' ? compareRecent : compareEntries));
  const inRecent = $derived(listScreen === 'threads' && workspace.view === 'recent');
  /** Recent's line under the title starts with where the row lives, once the tiles alone may not tell rows apart. */
  /** This app's own machine goes unsaid on Recent's place line and on the cards: the other machines are named. */
  const home = $derived(machines.find(m => m.store === workspace.primary));
  const places = $derived(rowPlaces(rows, home?.id));
  /** The line under a row's title: Recent's place, or where an Activity decision comes from (lib/feed-row.ts). */
  function rowWhere(row: typeof rows[number], grouped: boolean): RowPlace | undefined {
    if (listScreen === 'activity' && row.place !== undefined) return feedWhere({ ...row, place: row.place }, several);
    return !grouped && inRecent ? places(row) : undefined;
  }
  const recentGroups = $derived(selected ? [selected] : groups);
  let workingOpen = $state(false);
  const groupWorking = $derived(inRecent && recentPreferences.groupWorking && !query);
  /** Recent's rows whose agent, sub-agents or background work are still going: the "at work" filter. */
  const atWorkRows = $derived(inRecent && !query ? rows.filter(row => workingThread(row.machine.store, row.thread)) : []);
  let atWorkOnly = $state(false);
  const atWorkShown = $derived(atWorkOnly && atWorkRows.length > 0);
  /** The Recent filters, in the display menu: the rows at work alone, the project it lists; their count is on its button. */
  const atWork = $derived(atWorkRows.length > 0 ? { count: atWorkRows.length, on: atWorkShown, toggle: () => { atWorkOnly = !atWorkShown; } } : undefined);
  const filters = $derived(Number(atWorkShown) + Number(inRecent && selected !== undefined));
  // The chip goes with the last of that work: the filter does not come back by itself with the next turn.
  // Only the Recent list watches it: opening a conversation, searching or visiting Projects keeps the filter.
  $effect(() => { if (atWorkOnly && inRecent && !query && atWorkRows.length === 0) atWorkOnly = false; });
  const working = $derived(groupWorking && !atWorkShown ? rows.filter(row => groupWorkingThread(row.machine.store, row.thread)) : []);
  const attention = $derived(atWorkShown ? atWorkRows : groupWorking ? rows.filter(row => !groupWorkingThread(row.machine.store, row.thread)) : rows);

  /** The list a conversation was opened from: Back returns to it. The landing conversation has none, so Back leaves. */
  let from = $state<'threads' | 'activity' | null>(null);
  $effect(() => {
    if (store.page !== 'chat' || screen !== 'chat' || !from) return;
    const list = from;
    return mobileOverlay(() => { from = null; screen = list; });
  });
  // A contact's page covers the list, and what it opens (its project's board) lands on the chat: Back returns to the list it came from.
  $effect(() => {
    if (store.page !== 'home' || screen === 'chat') return;
    from = screen;
    screen = 'chat';
  });

  /*
   * Settings is a page over the place it was opened from, not a place of its
   * own: the header's arrow, and the phone's Back, return there.
   */
  let before: 'chat' | 'agents' | 'home' = 'chat';
  $effect(() => { const page = store.page; if (page !== 'settings') before = page; });
  function leaveSettings() {
    if (before === 'agents') store.showAgents();
    else if (before === 'home') store.showHome();
    else store.showChat();
  }
  $effect(() => { if (narrow.current && store.page === 'settings' && !recover) return mobileOverlay(leaveSettings); });

  function show(next: typeof screen) {
    store.showChat();
    store.sidebarOpen = false;
    from = next === 'chat' && screen !== 'chat' ? screen : null;
    screen = next;
  }
  // Allow, Answer or Review pressed in Activity: once the thread no longer needs the user, Activity comes back where it stood.
  followActivityReturn({
    activity: () => screen === 'activity',
    chat: () => screen === 'chat',
    reopen: () => { show('activity'); void tick().then(() => { if (scrollRoot) void restoreActivity(scrollRoot); }); }
  });
  /** The threads of a project that need the user, its heading's count, and how many of them failed, as on the desktop card. */
  function needsCount(entry: ProjectEntry): { count: number; failed: number } {
    const owner = entry.machine.store;
    // Activity's own count over the project's threads, a machine out of reach included as its last known state: the card and the rail's badge never disagree.
    return storeNeeds(owner, owner.threadsOf(entry.project.id));
  }
  /** A phone's row menu: the desktop's short first level, its named group opening in the same sheet (`Menu.svelte`). */
  function rowItems(owner: Store, thread: ThreadSummary): MenuItem[] {
    return threadMenuItems(owner, thread, { showDone: listScreen === 'threads', phone: true });
  }
  /** Thread ids can collide between machines: the row's own store acts, and its pickers hang under the row's own trigger. */
  function rowAction(owner: Store, thread: ThreadSummary, action: string, machineId: string) {
    pickThreadAction(owner, thread, action, {
      rename: async () => {
        show('chat');
        await workspace.select(owner, thread.id);
        if (workspace.active === owner && owner.openThread?.id === thread.id) owner.renameRequested = true;
      },
      anchor: () => Array.from(document.querySelectorAll<HTMLElement>('.mobile-list [data-thread-id][data-machine-id]'))
        .find(row => row.dataset.threadId === thread.id && row.dataset.machineId === machineId)
        ?.querySelector<HTMLElement>('[aria-haspopup=menu]')
    });
  }
  /** Adding a project from the display options starts a draft in it: the phone opens that draft, as the desktop does. */
  let known = $state<Set<string> | null>(null);
  $effect(() => {
    if (!known || store.projectPickerOpen) return;
    const before = known;
    known = null;
    if (store.draft?.projectId && !before.has(store.draft.projectId)) show('chat');
  });
  function addProject() { known = new Set(store.projects.map(p => p.id)); store.projectPickerOpen = true; }
  /** The search field takes the header's place from the magnifier; closing it clears what it filtered. */
  let searching = $state(false);
  /** A tab page's own search and "+", lent to this header (Bots): every tab's header reads title, magnifier, "+". */
  const lent = $derived(store.page === 'agents' && !recover ? tabHeader.controls : null);
  const searchable = $derived(!recover && !chatting && (store.page === 'chat' || lent !== null));
  function closeSearch() { searching = false; search = ''; tabHeader.query = ''; }
  // Another tab or page starts without the last one's search.
  let searchedOn: string | null = null;
  $effect(() => {
    const page = store.page;
    if (searchedOn !== null && page !== searchedOn) closeSearch();
    searchedOn = page;
  });
  async function newThread() {
    // Always a new draft: one already written stays in the list, where it was.
    if (screen === 'threads' && workspace.view === 'recent' && selected) await workspace.select(selected.machine.store, undefined, selected.project.id, { fresh: true });
    else store.startDraft(project?.id, { fresh: true });
    show('chat');
  }
  /** The projects a project moves among: its own section as drawn, or the one list a search shows. */
  function foldOf(entry: ProjectEntry): ProjectEntry[] {
    if (query) return groups;
    const key = projectKey(entry);
    return Object.values(sections).find(list => list.some(other => projectKey(other) === key)) ?? groups;
  }
  /** A set-aside project shows its archived conversations as its body, with no pill for them. */
</script>

{#snippet connection()}
  <!-- The machine: on the first run its name, the screen's one line; on the list's row a monitor and its dot, the name in its tooltip;
       over Settings, whose pages change that machine, the monitor, its dot and its name in words. -->
  {@const named = !firstRun && store.page === 'settings'}
  <button class="ghost connection" class:icon={!firstRun && !named} class:named data-testid="mobile-connection" title={place} onclick={() => store.showSettings('machines')}>
    {#if !firstRun}<Monitor size={named ? 16 : 20} aria-hidden="true" />{/if}<span class="dot" class:ready={store.connection === 'ready'}></span><span class="ui-label" class:visually-hidden={!firstRun && !named}>{place}</span>{#if firstRun}<ChevronDown size={12} />{/if}
  </button>
{/snippet}

<header class="mobile-header" class:chatting={chatting && !firstRun} class:settings={store.page !== 'chat'} data-testid="mobile-header" data-slide={slide.direction} bind:this={header}>
  {#if chatting && !firstRun}
    <!-- The only way out of a conversation on a phone. A thread that waits elsewhere is in its name and the tab bar's count, not a dot on the arrow. -->
    {#if store.openThread?.parentThreadId}
      <!-- A subagent's conversation goes back to the thread that started it, where its row was. -->
      {@const parentId = store.openThread.parentThreadId}
      <button class="ghost icon back" data-testid="delegation-back-parent" data-preload-thread={parentId} aria-label={strings.delegation.parent} title={strings.delegation.parent} onclick={() => void store.open(parentId)}><ArrowLeft size={20} /></button>
    {:else}
      <button class="ghost icon back" data-testid="mobile-back" aria-label={elsewhere ? `${strings.sidebar.threads}, ${fill(strings.mobile.waitingElsewhere, { count: String(elsewhere) })}` : strings.sidebar.threads} onclick={() => show('threads')}><ArrowLeft size={20} /></button>
    {/if}
  {:else if store.page === 'settings' && !recover}
    <button class="ghost icon back" data-testid="mobile-settings-leave" aria-label={strings.mobile.settingsLeave} title={strings.mobile.settingsLeave} onclick={leaveSettings}><ArrowLeft size={20} /></button>
  {:else if recover}
    <img class="brand-icon" src="./icons/icon.svg" alt="" width="30" height="30" />
  {/if}
  {#if chatting && !firstRun && narrow.current}
    <div class="chat-heading">{#key store}<ThreadHeader {store} />{/key}</div>
  {:else if searching && searchable}
    <!-- The magnifier opened the field in the title's place; the display options close its row, as on the desktop list. -->
    <div class="search"><Search size={17} /><input type="search" bind:value={() => lent ? tabHeader.query : search, value => { if (lent) tabHeader.query = value; else search = value; }}
      aria-label={lent?.searchLabel ?? strings.mobile.search} placeholder={lent?.searchLabel ?? strings.mobile.search} data-testid="mobile-search" use:focusOnMount onkeydown={event => { if (event.key === 'Escape') closeSearch(); }} />
      {#if store.page === 'chat' && listScreen === 'threads' && groups.length}<span class="display"><DisplayOptions entries={groups} target={undefined} owner={store} prefix="mobile-" compact filters={filters} {atWork} onaddproject={store.addsProjects ? addProject : undefined} /></span>{/if}
    </div>
    <button class="ghost icon" data-testid="mobile-search-close" aria-label={strings.mobile.clearSearch} onclick={closeSearch}><X size={20} /></button>
  {:else}
  <!-- The page's name, then the machine, the display menu and the search on its row; the places themselves are the bottom bar's. -->
  <div class="identity brand">
    {#if firstRun}{@render connection()}{/if}
    <!-- The first run's screen says what Boite is: the header keeps the machine alone, the way to its settings. -->
    <!-- The thread list's name is its two views, both in sight, the one on marked; the display menu sits beside the magnifier. -->
    {#if !firstRun}<strong data-testid="mobile-title">{#if threadViews}<ViewSwitch size="title" label={strings.sidebar.displayView} current={workspace.view} onpick={view => workspace.setView(view as 'projects' | 'recent')}
      options={[{ id: 'projects', label: strings.sidebar.projectsView }, { id: 'recent', label: strings.sidebar.recentView }]} testid="mobile-view-switch" />{:else if botsAndContacts}<ViewSwitch size="title" label={strings.agents.heading} current={store.page === 'home' ? 'home' : 'agents'}
      onpick={id => id === 'home' ? store.showHome() : store.showAgents()} options={[{ id: 'agents', label: strings.agents.heading, testid: 'mobile-bots-view', preload: 'agents' }, { id: 'home', label: strings.contacts.heading, testid: 'mobile-contacts', preload: 'home' }]} />{:else}{title}{/if}</strong>{/if}
  </div>
  {#if placeShown && !firstRun && !(tabbed && !recover)}{@render connection()}{/if}
  {#if threadViews}<span class="header-display"><DisplayOptions entries={groups} target={undefined} owner={store} prefix="mobile-" compact filters={filters} {atWork} onaddproject={store.addsProjects ? addProject : undefined} /></span>{/if}
  {#if searchable}<button class="ghost icon" data-testid={lent?.searchTestid ?? 'mobile-search-open'} aria-label={lent?.searchLabel ?? strings.mobile.search} title={lent?.searchLabel ?? strings.mobile.search} onclick={() => searching = true}><Search size={20} /></button>{/if}
  {/if}
  {#if !recover && !chatting && experimentOn('whip') && whipEntry.feature}{@const WhipButton = whipEntry.feature.WhipButton}<WhipButton mobile />{/if}
  {#if narrow.current && ContactRequestNotice && contactsShown(store)}<ContactRequestNotice {store} />{/if}
  <!-- One way to create per screen: a page (Bots, Contacts, Settings) owns its own. Activity answers what is
       asked, so it creates nothing; the thread list's "+" is one tab away. -->
  {#if tabbed && !recover && store.page === 'chat' && listScreen === 'threads' && !(searching && searchable)}
    <!-- A new conversation, the list's one labelled action: "New" where the row is narrow, "New thread" past it. -->
    <button class="primary new" data-testid="mobile-new" aria-label={strings.sidebar.newThread} disabled={draftOwner.connection !== 'ready'} onclick={() => void newThread()}><Plus size={14} aria-hidden="true" /><span class="ui-label short">{strings.sidebar.newShort}</span><span class="ui-label long">{strings.sidebar.newThread}</span></button>
  {:else if lent?.create && !(searching && searchable)}
    {@const create = lent.create}
    {#if create.items}<Menu items={create.items} onpick={id => create.onpick(id)} label={create.label} placement="bottom" align="end" variant="ghost" testid={create.testid}><Plus size={20} /></Menu>
    {:else}<button class="ghost icon new" data-testid={create.testid} aria-label={create.label} title={create.label} onclick={() => create.onpick()}><Plus size={20} /></button>{/if}
  {/if}
  {#if tabbed && !recover && !(searching && searchable)}
    <!-- Settings, a page with its way back: the gear closes every list's header. It names the machine in its label
         when there are several; only a machine out of reach marks it, with a grey dot. -->
    {@const gear = placeShown ? `${strings.settings.heading}, ${place}` : strings.settings.heading}
    <button class="ghost icon gear" data-testid="mobile-settings" data-preload-view="settings" aria-label={gear} title={gear}
      onclick={() => store.showSettings(store.connection === 'ready' && !store.pairingRequired ? 'home' : 'machines')}><Settings size={20} />{#if store.connection !== 'ready' || store.pairingRequired}<span class="dot"></span>{/if}</button>
  {/if}
  <!-- The filters on, in words on a line of their own: the row above keeps the views, the machine and three squares. -->
  {#if threadViews && !chatting}<FilterChips entries={groups} owner={store} prefix="mobile-" compact {atWork} />{/if}
</header>

{#if tabbed || leaving}
  <MobileTabs {store} screen={listScreen} waiting={threadsNeedingYou(machines.map(machine => machine.store)) + inbox.contacts} navigate={show} inert={leaving} />
{/if}

{#snippet contacts()}
  {#if SidebarContacts && contactsShown(store)}<div class="contacts-slot"><SidebarContacts {store} {machines} /></div>{/if}
{/snippet}

{#if narrow.current && store.page === 'chat' && (screen !== 'chat' || recover || leaving)}
  <section class="mobile-list scroll-edges" class:recent={inRecent} class:tabbed={tabbed || leaving} inert={leaving} bind:this={scrollRoot} style:--cut={cut ? `${cut}px` : undefined} onscroll={() => { if (scrollRoot) scrollPositions.set(listKey, scrollRoot.scrollTop); }} data-testid="mobile-list" aria-label={listScreen === 'activity' ? strings.mobile.activity : strings.sidebar.threads}>
    {#if recover && narrow.current}
      <MobileConnect {store} onpaired={() => show('threads')} />
    {:else}
    <!-- Recent's filters are the display menu's, counted on its button: the list starts with its rows. -->
    {#snippet threadRow(row: typeof rows[number], grouped = false, helpers: typeof rows = [])}
      <!-- Activity: the row's verb is its own, else the first asking sub-agent's, which opens that sub-agent (ActivityRow.svelte). -->
      {@const target = row.verb ? row : helpers.find(helper => helper.verb) ?? row}
      <MobileThreadRow machine={row.machine} thread={row.thread} project={row.project} {now} compact={!grouped} reason={row.reason} at={row.at} {helpers} verb={target.verb ?? null} kind={target.kind ?? null} where={rowWhere(row, grouped)} placed={grouped && !!hostName(row.machine, machines, home?.id)?.away} items={rowItems(row.machine.store, row.thread)}
        onopen={() => { show('chat'); void workspace.select(row.machine.store, row.thread.id); }}
        onverb={(event) => { leaveForAct(target.machine.store, target.thread.id, event?.currentTarget as Element ?? null, true); show('chat'); void workspace.select(target.machine.store, target.thread.id); }}
        onaction={action => rowAction(row.machine.store, row.thread, action, row.machine.id)} />
    {/snippet}
    {#if listScreen === 'threads' && workspace.view === 'projects'}
      {#snippet projectRows(projects: ProjectEntry[], later = false)}
      {#each projects as group (projectKey(group))}
        {@const groupRows = rows.filter(row => row.machine.id === group.machine.id && row.thread.projectId === group.project.id)}
        {@const workingOpen = projectThreadView.isOpen(group, 'working')}
        {@const doneOpen = archiveCount(group.project, 'done') > 0 && doneFilter.shown}
        {@const archivedOpen = later && archiveCount(group.project, 'archived') > 0}
        {@const workingRows = groupRows.filter(row => workingThread(row.machine.store, row.thread))}
        {@const needsHere = needsCount(group)}
        {@const waitingHere = needsHere.count}
        {@const attentionAll = query || !recentPreferences.groupWorking ? groupRows : groupRows.filter(row => workingOpen ? !workingThread(row.machine.store, row.thread) : !groupWorkingThread(group.machine.store, row.thread))}
        {@const fold = query ? { shown: attentionAll, folded: [] } : foldQuiet(attentionAll, row => row.thread.pinned === true || threadState(row.thread, rowAsks(row.machine.store, row.thread.id)) !== null)}
        {@const foldOpen = !!unfolded[projectKey(group)] && fold.folded.length > 0}
        {@const attentionRows = foldOpen ? attentionAll : fold.shown}
        {@const controls = `mobile-project-${encodeURIComponent(projectKey(group))}`}
        {@const drafts = group.machine.store.draftEntries.filter(entry => entry.projectId === group.project.id)}
        {@const folded = !query && group.machine.store.isCollapsed(group.project.id)}
        {@const rollup = folded && group.machine.store.connection === 'ready' ? projectRollup(group.machine.store.threadsOf(group.project.id), thread => rowAsks(group.machine.store, thread.id)) : null}
        {#if !query || groupRows.length > 0 || doneOpen || archivedOpen}
        <section class="project-group" class:inactive={!activeProject(group)} class:folded data-testid="mobile-project-group" data-project-id={group.project.id} data-machine-id={group.machine.id}>
          <div class="project-heading" data-row-edge>
            <!-- The tile and the name fold the project, as its header does on the desktop; the counters and menus beside them keep their own action.
                 A search lists every match, folded or not, as the desktop's search does: the header folds again once it is cleared. -->
            <h2><button type="button" class="ghost project-toggle" data-testid="mobile-project-toggle" aria-expanded={!folded} aria-controls="{controls}-body" disabled={!!query}
              onclick={() => projectThreadView.toggleProject(group, { working: workingRows.map(row => row.thread), attention: attentionRows.map(row => row.thread) }, drafts.length)}>
              <ProjectTile project={group.project} store={group.machine.store} /><span class="name">{projectName(group.project)}</span><span class="fold-caret" class:open={!folded} aria-hidden="true"><ChevronRight size={16} /></span>{#if rollup && !needsYou(rollup.kind) && rollup.kind !== 'done' && workingRows.length === 0}<ProjectRollup {rollup} />{/if}{#if hostName(group.machine, machines, home?.id)}<MachinePlace host={{ ...hostName(group.machine, machines, home?.id)!, away: false }} dim={group.machine.store.connection !== 'ready'} testid="mobile-project-host" />{/if}
            </button></h2>
            <ProjectThreadCounters entry={group} working={group.machine.store.threadsOf(group.project.id).filter(thread => workingThread(group.machine.store, thread)).length} waiting={waitingHere} failed={needsHere.failed} listed={attentionRows.filter(row => needsYou(threadState(row.thread, rowAsks(row.machine.store, row.thread.id)))).length} {controls} collapsed={folded} searching={!!query} away={group.machine.store.connection !== 'ready'} />
            {#if projectView.order === 'manual'}
              <Menu items={[
                { id: 'up', label: strings.sidebar.moveProjectUp, disabled: projectKey(foldOf(group)[0]!) === projectKey(group) },
                { id: 'down', label: strings.sidebar.moveProjectDown, disabled: projectKey(foldOf(group).at(-1)!) === projectKey(group) }
              ]} onpick={action => projectView.step(foldOf(group), projectKey(group), action === 'up' ? -1 : 1)} label={strings.sidebar.customOrder} placement="bottom" variant="ghost" testid="mobile-project-order"><ArrowUpDown size={18} /></Menu>
            {/if}
            <!-- The desktop header's menu: a new thread here, the path, archived threads and their switch (a set-aside group always shows them), managing the project. -->
            <button type="button" class="ghost icon project-actions" data-testid="mobile-project-menu" title={strings.sidebar.projectMenu} aria-label={strings.sidebar.projectMenu}
              onclick={(event) => projectMenu(event, group.machine.store, group.project, undefined, () => show('chat'), { count: archiveCount(group.project, 'archived') })}><Ellipsis size={18} /></button>
          </div>
          <!-- Out of reach, said once under the name with its next step; the rows below dim as last seen. -->
          {#if group.machine.store.connection === 'closed'}<div class="offline"><MachineOffline store={group.machine.store} label={group.machine.label} /></div>{/if}
          <!-- Folded, the project keeps its header alone: drafts, conversations and their done and archived lists wait under the fold. -->
          <div id="{controls}-body" class="disclosure-fold" class:open={!folded} inert={folded}><div>
          {#if !query}{#each drafts as draft (draft.id)}<DraftRow owner={group.machine.store} entry={draft} onopen={() => show('chat')} />{/each}{/if}
          <WindowList items={attentionRows} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} active={!folded} estimate={66} measurements={measurements(projectKey(group))}>
            {#snippet row(entry)}{@render threadRow(entry, true)}{/snippet}
          </WindowList>
          {#if fold.folded.length}<div class="fold-more"><FoldMore count={fold.folded.length} open={foldOpen} ontoggle={() => toggleFold(projectKey(group))} /></div>{/if}
          <ProjectThreadCounters entry={group} working={workingRows.length} waiting={waitingHere} {controls} searching={!!query} away={group.machine.store.connection !== 'ready'} place="fold" />
          <div id="{controls}-working" hidden={!workingOpen || !!query || workingRows.length === 0} data-testid="project-working">
            {#if workingOpen && !query && workingRows.length > 0}
              {#if waitingHere === 0}<GroupLabel kind="working" count={workingRows.length} />{/if}
              <WindowList items={workingRows} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} active={!folded} estimate={66} measurements={measurements(`${projectKey(group)}:working`)}>
                {#snippet row(entry)}{@render threadRow(entry, true)}{/snippet}
              </WindowList>
            {/if}
          </div>
          <div id="{controls}-done" hidden={!doneOpen} data-testid="project-done">
            {#if doneOpen}<GroupLabel kind="done" count={query ? undefined : archiveCount(group.project, 'done')} />{/if}
            <RecentDone entries={[group]} {scrollRoot} {now} {query} open={doneOpen && !folded} header={false} onopen={() => show('chat')} />
          </div>
          <div id="{controls}-archived" hidden={!archivedOpen} data-testid="project-archived">
            <RecentDone kind="archived" entries={[group]} {scrollRoot} {now} {query} open={archivedOpen && !folded && (!later || projectThreadView.laterOpen)} header={false} onopen={() => show('chat')} />
          </div>
          {#if groupRows.length === 0 && !group.project.archivedThreads && drafts.length === 0}<p class="empty">{strings.sidebar.noThreads}</p>{/if}
          </div></div>
        </section>
        {/if}
      {/each}
      {/snippet}
      {#if query}{@render projectRows(groups)}
      {:else}
        {#if sections.working.length > 0}<ProjectCardsSection kind="working" count={sections.working.length}>{@render projectRows(sections.working)}</ProjectCardsSection>{/if}
        {@render projectRows(sections.open)}
        {#if groups.length > 0 && sections.working.length + sections.open.length === 0}<p class="empty">{strings.sidebar.noActiveProjects}</p>{/if}
        {#if sections.later.length > 0}<ProjectCardsSection kind="later" count={sections.later.length}>{@render projectRows(sections.later, true)}</ProjectCardsSection>{/if}
        <ProjectShelf projects={sections.idle} multi={several} {now} {scrollRoot} onopen={() => show('chat')} />
        <ProjectShelf kind="archived" projects={shelved} multi={several} {now} {scrollRoot} onopen={() => show('chat')} />
        {@render contacts()}
      {/if}
      <WindowList items={rows.filter(row => row.thread.projectId === null)} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements('unassigned')}>
        {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
      </WindowList>
    {:else if listScreen === 'activity'}
      <!-- Triage: what the user acts on (what contacts ask, then the threads), then what they only read. -->
      <!-- One thread, one row: its asking sub-agents are lines of it (lib/activity-feed.ts), as on the desktop. -->
      {@const needs = feedGroups(rows.filter(row => row.section === 'needs'))}
      {@const updates = feedGroups(rows.filter(row => row.section === 'updates'))}
      {@const asked = ContactInboxRows && contactsShown(store) && !query}
      {@const needsCount = needs.length + (asked ? inbox.contacts : 0)}
      <!-- The section's number is the tab's badge: its top rows (a sub-agent counts on its parent) and what contacts ask. -->
      <!-- The amber dot beside "Needs you", as on the desktop page; only updates left, one line says nothing waits. -->
      <!-- The first line carries Mark all as read on its right, whichever line it is, as on the desktop page. -->
      {#if needsCount > 0 || rows.length > 0}<div class="feed-head">
        {#if needsCount > 0}<h2 class="section-label feed-section" data-testid="activity-needs" data-count={needsCount}><span class="feed-dot" aria-hidden="true"></span>{strings.sidebar.state.waiting}<span class="feed-count">{count(needsCount)}</span></h2>
        {:else}<p class="all-done" data-testid="activity-all-done">{strings.mobile.nothingNeedsYou}</p>{/if}
        <MarkAllRead rows={rows.map(row => ({ machine: row.machine, thread: row.thread, kind: row.kind ?? null }))} />
      </div>{/if}
      <div class="feed-tiles">{#if asked && ContactInboxRows}<ContactInboxRows {store} />{/if}<WindowList items={needs} keyOf={group => JSON.stringify([group.row.machine.id, group.row.thread.id])} {scrollRoot} estimate={66} measurements={measurements('activity')}>
        {#snippet row(group)}{@render threadRow(group.row, false, group.helpers)}{/snippet}
      </WindowList></div>
      {#if updates.length > 0}<h2 class="section-label feed-section" data-testid="activity-updates">{strings.mobile.feed.updates}</h2>{/if}
      <div class="feed-tiles"><WindowList items={updates} keyOf={group => JSON.stringify([group.row.machine.id, group.row.thread.id])} {scrollRoot} estimate={66} measurements={measurements('activity-updates')}>
        {#snippet row(group)}{@render threadRow(group.row, false, group.helpers)}{/snippet}
      </WindowList></div>
    {:else}
      <WindowList items={attention} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements(atWorkShown ? 'at-work' : listScreen)}>
        {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
      </WindowList>
      {#if inRecent && !atWorkShown}
        {#if doneFilter.shown}<div class="recent-done" data-testid="recent-done-rows"><RecentDone entries={recentGroups} {scrollRoot} {now} {query} open header={false} onopen={() => show('chat')} /></div>{/if}
        <div class="recent-folds">
          {#if working.length > 0}
            <RecentGroup kind="working" count={working.length} bind:open={workingOpen}>
              <WindowList items={working} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements('recent-working')}>
                {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
              </WindowList>
            </RecentGroup>
          {/if}
          <RecentDone kind="archived" entries={recentGroups} {scrollRoot} {now} {query} onopen={() => show('chat')} />
        </div>
        {#if !query}{@render contacts()}{/if}
      {/if}
    {/if}
    {#if listScreen === 'activity' && rows.length === 0 && (query || inbox.contacts === 0)}
      <!-- Nothing waits: the app's one empty view, small, at the screen's optical middle as on the desktop page. -->
      <div class="activity-empty"><EmptyState line={strings.mobile.emptyActivity} testid="activity-empty" robot={null} small /></div>
    {:else if listScreen !== 'activity' && rows.length === 0 && (query || workspace.view === 'recent' || groups.length === 0) && !(inRecent && !query && recentGroups.some(entry => entry.project.archivedThreads))}
      <div class="empty-state">
        <span class="empty-icon"><MessageSquare size={24} /></span>
        <h2>{entries.length ? strings.mobile.noThreads : strings.mobile.emptyTitle}</h2>
        <p>{entries.length ? strings.mobile.search : strings.mobile.emptyBody}</p>
        {#if listScreen === 'threads' && !entries.length}<button class="primary" data-testid="mobile-first-thread" disabled={draftOwner.connection !== 'ready'} onclick={newThread}><Plus size={16} /><span class="ui-label">{strings.sidebar.newThread}</span></button>{/if}
      </div>
    {/if}
    {/if}
  </section>
{/if}

<style>
  /* Typed, so the foot's fade eases to a row's top when the list settles instead of jumping. */
  @property --cut { syntax: '<length>'; inherits: false; initial-value: 0px; }
  .mobile-header, .mobile-list { display: none; }
  @media (max-width: 720px) {

    .mobile-header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 60px; padding: 8px max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left)); background: var(--color-background); border-bottom: 1px solid var(--color-border); padding-top: max(8px, env(safe-area-inset-top)); }
    .chat-heading { flex: 1; min-width: 0; height: 44px; }
    .mobile-header.chatting { gap: 6px; padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right)); }
    .chat-heading :global(.thread-header) { gap: 2px; }
    .chat-heading :global(.launcher span) { display: none; }
    .chat-heading :global(.launcher) { width: 44px; padding: 0; justify-content: center; flex: none; }
    .mobile-header > .icon { flex: none; color: var(--color-muted-foreground); }
    /* A list's row holds the view switch and up to four finger squares (the machine, the display menu, the search, a
       new thread): the squares touch, their glyphs still 24 px apart, so the switch keeps its room at 360 px. */
    .mobile-header:not(.chatting) > :is(.icon, .header-display) { margin-left: -10px; }
    /* The new thread's button: filled, shorter than the finger squares beside it, its target the header's height,
       10 px from the glyphs on both sides. At 360 px the row holds the views, three squares and "+ New" once the
       views' sides give 3 px each, the search reaches 6 px into the display menu's square (glyphs still 18 px apart)
       and the button and the gear 2 px into the square before them; past 480 px it says "New thread". From 381 px
       the search keeps to its own square, so a finger on the display menu's edge never opens the search. */
    .mobile-header > .primary.new { position: relative; flex: none; gap: 4px; height: 36px; margin-left: -12px; padding: 0 8px 0 6px; }
    @media (max-width: 380px) { .mobile-header:has(> .primary.new) > [data-testid=mobile-search-open] { margin-left: -16px; } }
    .mobile-header:has(> .primary.new) > .gear { margin-left: -12px; }
    .mobile-header > .primary.new::before { content: ''; position: absolute; inset: -4px 0; }
    .new .long { display: none; }
    .mobile-header:has(> .primary.new) .brand strong :global(.view-switch .side) { padding-inline: 7px; }
    @media (min-width: 480px) { .new .long { display: block; } .new .short { display: none; } }
    /* The filters' line under the row, the whole width. */
    .mobile-header > :global(.filter-chips) { flex-basis: 100%; padding-bottom: 4px; }
    .search { display: flex; flex: 1; min-width: 0; gap: 8px; align-items: center; padding: 0 0 0 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); color: var(--color-muted-foreground); }
    .search > :global(svg) { flex: none; }
    /* The display options close the field's row, after a hairline. */
    .display { display: flex; align-self: stretch; align-items: center; flex: none; border-left: 1px solid var(--color-border); }
    .display :global(.trigger) { width: var(--touch-target); height: var(--touch-target); border-radius: 0 var(--radius-lg) var(--radius-lg) 0; }
    .search input { flex: 1; min-width: 0; border: 0; background: transparent; min-height: 44px; font-size: 16px; padding: 8px 0; }
    .search:focus-within { border-color: var(--color-muted-foreground); }
    .search input:focus { outline: none; }
    .brand-icon { flex: none; border-radius: var(--radius-md); }
    .back { position: relative; flex: none; }
    /* The page's name, under the machine it reads. */
    .brand strong { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.4px; line-height: 1.15; }
    /* The view switch's finger-sized targets reach past the line. */
    .brand strong:has(:global(.view-switch)) { overflow: visible; }
    /* A finger-sized target without growing the header: the line reaches into the header's padding. */
    .connection { position: relative; z-index: 1; display: flex; gap: 5px; height: auto; min-height: var(--touch-target); min-width: var(--touch-target); max-width: 100%; margin: -14px 0 -12px; padding: 0; font-size: var(--text-xs); font-weight: 500; color: var(--color-muted-foreground); }
    .connection > span:not(.dot) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--color-muted-foreground); }
    .dot.ready { background: var(--color-success); }
    /* On the list's row: a finger's square, the monitor with its dot on the corner, like the desktop rail's machines. */
    .connection.icon { flex: none; justify-content: center; width: var(--touch-target); height: var(--touch-target); margin: 0; color: var(--color-muted-foreground); }
    .connection.named { flex: 0 1 auto; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; max-width: 45%; margin: 0; padding: 0 var(--space-2); font-size: var(--text-sm); color: var(--color-muted-foreground); }
    .gear { position: relative; }
    :is(.connection.icon, .gear) .dot { position: absolute; top: 9px; right: 8px; width: 7px; height: 7px; box-shadow: 0 0 0 2px var(--color-background); }
    .identity { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; flex: 1; }
    /* The views never shrink under the squares beside them: the squares sit after the switch, never on it. */
    .identity:has(:global(.view-switch)) { flex: 1 0 auto; }
    .mobile-header > :global(.menu) { flex: none; }
    .header-display { display: flex; flex: none; }
    .header-display :global(.trigger) { width: var(--touch-target); height: var(--touch-target); color: var(--color-muted-foreground); }
    .mobile-list { display: block; position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; background: var(--color-background); padding: 8px max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
    /* The bottom bar owns the home indicator's inset. */
    .mobile-list.tabbed { padding-bottom: 24px; }
    /* The foot's fade (app.css `.scroll-edges`, the shared depth): the ground over the rows while more lies below,
       gone at the end, where the padding leaves the last row whole above the tab bar. A scroll that ends near a row
       settles with that row whole under its card's stuck heading (`--heading`). */
    .mobile-list { --scroll-edge-top: 8px; --scroll-edge-bottom: 24px; --heading: 44px; scroll-padding-block: calc(var(--scroll-edge) + 8px); scroll-snap-type: y proximity; }
    /* The foot fades over the bottom padding while rows pass it; at rest it ends on the top of the row the tabs would
       slice (`--cut`, set by the script), so a row is whole or gone. A mask on the box, which does not scroll. */
    .mobile-list { --fade: var(--scroll-edge); mask-image: linear-gradient(to bottom, black calc(100% - var(--fade) - var(--cut)), rgb(0 0 0 / 0.55) calc(100% - var(--fade) / 2 - var(--cut)), transparent calc(100% - var(--cut))); transition: --cut var(--motion-duration) var(--motion-curve); }
    .project-group { scroll-snap-align: start; scroll-margin-top: calc(var(--scroll-edge-top) - var(--scroll-edge) - 8px); }
    .project-group :global([data-testid=mobile-row]) { scroll-snap-align: start; scroll-margin-top: calc(var(--heading) - var(--scroll-edge) - 8px); }
    p { font-size: var(--text-sm); }
    /* One frame: a quiet surface, no border and no banded header inside it. */
    /* Clipped to its corners without being a scroll box, so its heading can stick to the list's scroll. */
    .project-group { --row-background: var(--color-surface); border-radius: var(--radius-lg); background: var(--color-surface); margin-bottom: 12px; overflow: clip; }
    /* The heading stays at the list's top edge while its threads scroll under it, over the edge fade, on the card's
       ground; the next card's heading pushes it off. */
    .project-heading { position: sticky; top: calc(-1 * var(--scroll-edge-top, 0px)); z-index: 4; display: flex; align-items: center; min-height: var(--heading); box-sizing: border-box; padding: 8px 12px; gap: 8px; color: var(--color-muted-foreground); background: var(--color-surface); }
    /* A row passing under it melts into the heading instead of being sliced; over the card's ground it shows nothing. */
    /* The shared edge's depth and easing: the list settles on a row's top (the snap above), so the fade covers that
       row's top padding, never its text. */
    .project-heading::after { content: ''; position: absolute; inset: 100% 0 auto; height: var(--scroll-edge); background: linear-gradient(var(--color-surface), color-mix(in oklab, var(--color-surface) 45%, transparent) 50%, transparent); pointer-events: none; }
    /* The name, then its machine in quiet ink, on one line: the machine gives way first. */
    .project-heading h2 { display: flex; align-items: center; gap: 8px; margin: 0; flex: 1; min-width: 0; font-size: var(--text-sm); }
    /* The card's title at the title weight and ink, as the desktop card's name (Sidebar.svelte .name). */
    .project-heading .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--weight-title); color: var(--color-foreground); }
    /* The machine as a place (MachinePlace.svelte): its name gives way before the project's, its state never. */
    .project-heading h2 :global(.machine-place) { flex: 0 1000 auto; }
    /* The fold's target: tile, name and chevron, a finger's height that eats the heading's padding rather than making it taller. */
    .project-toggle { flex: 1; display: flex; align-items: center; width: 100%; height: auto; min-width: 0; min-height: var(--touch-target); margin: -8px 0; padding: 0; gap: 8px; justify-content: flex-start; border: 0; border-radius: var(--radius-md); font: inherit; color: inherit; text-align: left; white-space: normal; }
    .project-toggle:hover:not(:disabled) { background: transparent; color: inherit; }
    .project-toggle:disabled { opacity: 1; }
    /* A whole touch target that eats the heading's padding rather than making it taller. */
    /* The folded quiet threads' action (FoldMore.svelte): a finger's height, on the rows' text edge. */
    .fold-more { --fold-more-height: var(--touch-target); --fold-more-inset: 12px; }
    /* The machine's state, its dot on the name's edge (the heading's 12 px, the tile and its 8 px gap), a finger's Reconnect at its end. */
    .offline { padding: 0 12px 8px 40px; }
    .offline :global(.machine-offline) { font-size: var(--text-sm); }
    .project-heading .project-actions { flex: none; margin: -8px -8px -8px 0; color: var(--color-muted-foreground); }
    .project-heading :global(.counters) { margin: -8px 0; }
    /* The list's content box, the empty view a little above its centre, where the eye lands. */
    .activity-empty { display: grid; place-items: center; min-height: 100%; padding-bottom: 10%; }
    .empty-state { display: flex; align-items: center; flex-direction: column; text-align: center; padding: 44px 16px; }
    .empty-icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: var(--radius-xl); border: 1px solid var(--color-edge); background: var(--color-surface-2); color: var(--color-muted-foreground); margin-bottom: 18px; }
    .empty-state h2 { font-size: var(--text-base); font-weight: 600; margin: 0 0 8px; }
    .empty-state p { color: var(--color-muted-foreground); line-height: 1.6; max-width: 280px; margin: 0 0 20px; }
    .mobile-header { grid-row: 1; grid-column: 1; }
    .mobile-list { grid-row: 2; grid-column: 1; position: relative; z-index: 1; min-height: 0; }
    /* A conversation slides over the list it opens from, and off it on the way back (lib/screen-slide.svelte.ts). The
       conversation, the app's `.body`, spans the bottom bar's row too, as tall all the way as it is once open, so nothing
       inside rewraps; the list and the bar shift under it, and the header stays, raised over its shadow. */
    .mobile-header[data-slide] { z-index: 4; }
    .mobile-header[data-slide] > :global(*) { animation: fade var(--dur-3) var(--ease-out-quint); }
    :global(.app:not(.shell)) > .mobile-header[data-slide] ~ :global(.body) { grid-row: 2 / 4; z-index: 3; visibility: visible; content-visibility: visible; background: var(--screen-background, var(--color-background)); box-shadow: var(--shadow-screen); animation: screen-in var(--dur-3) var(--motion-curve) both; }
    :global(.app:not(.shell)) > .mobile-header[data-slide='pop'] ~ :global(.body) { animation-name: screen-out; }
    .mobile-header[data-slide='push'] ~ .mobile-list, .mobile-header[data-slide='push'] ~ :global(.mobile-tabs) { pointer-events: none; animation: screen-under-out var(--dur-3) var(--motion-curve) both; }
    .mobile-header[data-slide='pop'] ~ .mobile-list, .mobile-header[data-slide='pop'] ~ :global(.mobile-tabs) { animation: screen-under-in var(--dur-3) var(--motion-curve) both; }
    .mobile-list.recent { display: flex; flex-direction: column; }
    .mobile-list.recent > :global(*) { flex-shrink: 0; }
    .recent-folds { margin-top: auto; padding-top: 16px; }
    .recent-done { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
    /* A section's name over its rows, from the rows' edge; the second stands off the first. */
    .feed-section { margin: 8px 12px 4px; }
    .feed-head ~ .feed-section { margin-top: 20px; }
    /* The first line and Mark all as read on its right edge; the button keeps the line's height. */
    .feed-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; min-height: var(--control-sm); margin: 8px 6px 4px 0; }
    .feed-head > :is(.feed-section, .all-done) { margin-block: 0; min-width: 0; }
    /* The section's count, the tab badge's number: amber marks it, the word stays grey. */
    .feed-count { margin-left: 6px; color: var(--color-live); font-variant-numeric: tabular-nums; }
    .feed-section[data-testid=activity-needs] { display: flex; align-items: center; }
    .feed-dot { width: 8px; height: 8px; margin-right: 8px; flex: none; border-radius: var(--radius-full); background: var(--color-live); }
    /* Every Activity entry, in Needs you and in Updates, is one card: a tile 4 px from the next, the ground a step up
       under a finger. The gap is the slot's padding, so the window list measures it with the row. */
    .feed-tiles { --row-background: var(--color-surface); }
    .feed-tiles :global([data-window-key]) { padding-bottom: 4px; }
    .feed-tiles :global(.row) { border-radius: var(--radius-lg); }
    .feed-tiles :global(.row:has(.thread:active)) { --row-background: var(--color-surface-2); }
    /* A contact's request (ContactInboxRows.svelte) is one of them, on the same tile. */
    .feed-tiles :global(.contact-row) { margin: 0 0 4px; border-radius: var(--radius-lg); background: var(--color-surface); }
    .feed-tiles :global(.contact-row:active) { background: var(--color-surface-2); }
    @media (hover: hover) {
      .feed-tiles :global(.row:hover), .feed-tiles :global(.contact-row:hover) { --row-background: var(--color-surface-2); background: var(--color-surface-2); }
      .feed-tiles :global(.thread:hover:not(:disabled)) { background: transparent; }
    }
    .all-done { display: flex; align-items: center; gap: 10px; margin: 8px 12px 4px; font-size: var(--text-sm); font-weight: 500; color: var(--color-muted-foreground); }
  }
</style>
