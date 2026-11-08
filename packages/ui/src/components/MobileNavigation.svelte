<script lang="ts">
  import { tick } from 'svelte';
  import WindowList from './WindowList.svelte';
  import MobileTabs from './MobileTabs.svelte';
  import ThreadHeader from './ThreadHeader.svelte';
  import { ArrowLeft, ArrowUpDown, ChevronDown, Ellipsis, Folder, MessageSquare, Plus, Search, Radar, X } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import MobileConnect from './MobileConnect.svelte';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { fill, strings } from '../lib/strings';
  import { count, projectName } from '../lib/format';
  import { mobileOverlay } from '../lib/mobile-history';
  import { groupWorkingThread, recentPreferences } from '../lib/recent.svelte';
  import { pickThreadAction, threadMenuItems, threadToolItems } from '../lib/thread-menu';
  import { projectMenu } from '../lib/project-menu';
  import type { MenuItem } from '../lib/menu';
  import type { ThreadSummary } from '@boite/contracts';
  import Menu from './Menu.svelte';
  import WhipButton from './WhipButton.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { mobileChrome } from '../lib/mobile-chrome.svelte';
  import { focusOnMount } from '../lib/actions';
  import MobileThreadRow from './MobileThreadRow.svelte';
  import DisplayOptions from './DisplayOptions.svelte';
  import RecentGroup from './RecentGroup.svelte';
  import RecentDone from './RecentDone.svelte';
  import ProjectThreadCounters from './ProjectThreadCounters.svelte';
  import ProjectShelf from './ProjectShelf.svelte';
  import ProjectCardsSection from './ProjectCardsSection.svelte';
  import DraftRow from './DraftRow.svelte';
  import GroupLabel from './GroupLabel.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import { projectKey, projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { activeProject, archiveCount, projectSections, projectThreadView } from '../lib/project-threads.svelte';
  import { workingThread } from '../lib/recent.svelte';
  import { compareEntries } from '../lib/thread-order';
  import { rowPlaces } from '../lib/row-place';
  import { activityFeed, storeNeedsYou } from '../lib/activity-feed';
  import { tabHeader } from '../lib/tab-header.svelte';
  import EmptyState from './EmptyState.svelte';
  import { threadsNeedingYou } from '../lib/app-rail';
  import { needsUser } from '../lib/thread-state';
  import { minuteClock } from '../lib/clock.svelte';
  import { needsAnAI } from '../lib/first-run';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { ScreenSlide } from '../lib/screen-slide.svelte';
  import { doneFilter, feedPlace, feedThread, inbox } from '../lib/inbox.svelte';

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
    void import('./home/SidebarContacts.svelte').then(module => { SidebarContacts = module.default; }).catch(() => {});
    void import('./home/ContactRequestNotice.svelte').then(module => { ContactRequestNotice = module.default; }).catch(() => {});
    void import('./home/ContactInboxRows.svelte').then(module => { ContactInboxRows = module.default; }).catch(() => {});
  });
  let search = $state('');
  const query = $derived(search.trim().toLocaleLowerCase());
  const chatting = $derived(screen === 'chat' && !recover && store.page === 'chat');
  /** No AI yet and no thread open: the screen is the first run's, with nothing to go back to and no thread to name. */
  const firstRun = $derived(chatting && !store.openThread && needsAnAI(store));
  /** The bottom bar: on every list and page, the recovery screen too, not in a conversation nor in one a page opened. Only a phone's width draws it. */
  $effect.pre(() => { tabbed = !chatting && !(store.page === 'agents' && mobileChrome.detail); });
  /** What the header names: the page, or the list on screen; the thread list by its view, so Projects and Recent tell apart. */
  const title = $derived(store.page === 'settings' ? strings.settings.heading : store.page === 'agents' ? strings.agents.heading : store.page === 'home' ? strings.contacts.heading
    : recover ? 'Boite' : screen === 'activity' ? strings.mobile.activity : workspace.view === 'recent' ? strings.sidebar.recentView : strings.sidebar.projectsView);
  let scrollRoot = $state<HTMLElement>();
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
  let place = $derived(store.pairingRequired ? strings.mobile.pairingRequired : store.connection === 'ready' ? machine?.label ?? strings.mobile.computer : strings.connection[store.connection]);
  let project = $derived(store.openProject ?? store.projects.find(p => p.archived !== true));
  let groups = $derived(projectView.sorted(machines.flatMap(machine => machine.store.projects.filter(project => !project.archived).map(project => ({ machine, project })))));
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
  let rows: (typeof entries[number] & { reason?: string; at?: number; nested?: boolean; section?: 'needs' | 'updates' })[] = $derived(listScreen === 'activity'
    ? activityFeed(entries.filter(matches), feedPlace)
    : entries.filter(e => matches(e) && !e.thread.parentThreadId && !e.project?.archived && (workspace.view !== 'recent' || !selected || (e.machine.id === selected.machine.id && e.thread.projectId === selected.project.id)))
      .sort(compareEntries));
  const inRecent = $derived(listScreen === 'threads' && workspace.view === 'recent');
  /** Recent's line under the title starts with where the row lives, once the tiles alone may not tell rows apart. */
  /** This app's own machine goes unsaid on Recent's place line and on the cards: the other machines are named. */
  const home = $derived(machines.find(m => m.store === workspace.primary));
  const places = $derived(rowPlaces(rows, home?.id));
  /** Recent shows one project or all of them: the filter's choices. */
  const filterItems = $derived([
    { id: 'all', label: strings.sidebar.allProjects, active: !selected },
    ...groups.map(entry => ({ id: projectKey(entry), label: projectName(entry.project), hint: several ? entry.machine.label : '', active: projectKey(entry) === projectView.filter, projectTile: { project: entry.project, store: entry.machine.store } }))
  ]);
  const recentGroups = $derived(selected ? [selected] : groups);
  let workingOpen = $state(false);
  const groupWorking = $derived(inRecent && recentPreferences.groupWorking && !query);
  /** Recent's rows whose agent, sub-agents or background work are still going: the "at work" filter. */
  const atWorkRows = $derived(inRecent && !query ? rows.filter(row => workingThread(row.machine.store, row.thread)) : []);
  let atWorkOnly = $state(false);
  const atWorkShown = $derived(atWorkOnly && atWorkRows.length > 0);
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

  function show(next: typeof screen) {
    store.showChat();
    store.sidebarOpen = false;
    from = next === 'chat' && screen !== 'chat' ? screen : null;
    screen = next;
  }
  /** The threads of a project that wait on the user, its heading's amber count, as on the desktop card. */
  function waitingCount(entry: ProjectEntry): number {
    const owner = entry.machine.store;
    // Activity's own count over the project's threads: the card and the rail's badge never disagree.
    return storeNeedsYou(owner, owner.threadsOf(entry.project.id));
  }
  /** A phone's row menu: the thread's lifecycle first, the rest behind Tools, as on a desktop row. */
  function rowItems(owner: Store, thread: ThreadSummary): MenuItem[] {
    return threadMenuItems(owner, thread, { showDone: listScreen === 'threads', phone: true, grouped: true });
  }
  /** What the row menu's Tools opens: the thread's panels, as in its header, then a new title, a move and a way back. */
  function rowTools(owner: Store, thread: ThreadSummary): MenuItem[] {
    return threadToolItems(owner, thread, { phone: true, panels: true });
  }
  /** Thread ids can collide between machines: the row's own store acts, and its pickers hang under the row's own trigger. */
  function rowAction(owner: Store, thread: ThreadSummary, action: string, machineId: string) {
    // A panel or drawer shows over its thread: the list screen leaves for the chat first.
    if (action.startsWith('kind:') || action === 'terminal-toggle' || action === 'board-toggle') show('chat');
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

<header class="mobile-header" class:chatting={chatting && !firstRun} class:settings={store.page !== 'chat'} data-testid="mobile-header" data-slide={slide.direction} bind:this={header}>
  {#if chatting && !firstRun}
    <!-- The only way out of a conversation on a phone. A thread that waits elsewhere is in its name and the tab bar's count, not a dot on the arrow. -->
    <button class="ghost icon back" data-testid="mobile-back" aria-label={elsewhere ? `${strings.sidebar.threads}, ${fill(strings.mobile.waitingElsewhere, { count: String(elsewhere) })}` : strings.sidebar.threads} onclick={() => show('threads')}><ArrowLeft size={20} /></button>
  {:else if recover}
    <img class="brand-icon" src="./icons/icon.svg" alt="" width="30" height="30" />
  {/if}
  {#if chatting && !firstRun && narrow.current}
    <div class="chat-heading">{#key store}<ThreadHeader {store} />{/key}</div>
  {:else if searching && searchable}
    <!-- The magnifier opened the field in the title's place; the display options close its row, as on the desktop list. -->
    <div class="search"><Search size={17} /><input type="search" bind:value={() => lent ? tabHeader.query : search, value => { if (lent) tabHeader.query = value; else search = value; }}
      aria-label={lent?.searchLabel ?? strings.mobile.search} placeholder={lent?.searchLabel ?? strings.mobile.search} data-testid="mobile-search" use:focusOnMount onkeydown={event => { if (event.key === 'Escape') closeSearch(); }} />
      {#if listScreen === 'threads' && groups.length}<span class="display"><DisplayOptions entries={groups} target={undefined} owner={store} prefix="mobile-" compact onaddproject={store.owner ? addProject : undefined} /></span>{/if}
    </div>
    <button class="ghost icon" data-testid="mobile-search-close" aria-label={strings.mobile.clearSearch} onclick={closeSearch}><X size={20} /></button>
  {:else}
  <!-- The machine over the page's name; the places themselves are the bottom bar's. -->
  <div class="identity brand">
    <button class="ghost connection" data-testid="mobile-connection" onclick={() => store.showSettings('machines')}><span class="dot" class:ready={store.connection === 'ready'}></span><span class="ui-label">{place}</span><ChevronDown size={12} /></button>
    <!-- The first run's screen says what Boite is: the header keeps the machine alone, the way to its settings. -->
    <!-- The thread list's name is its view switch: the word says which view is on, a press opens the display menu. -->
    {#if !firstRun}<strong data-testid="mobile-title">{#if listScreen === 'threads' && store.page === 'chat' && !recover && groups.length}<DisplayOptions entries={groups} target={undefined} owner={store} prefix="mobile-" compact labelled onaddproject={store.owner ? addProject : undefined} />{:else}{title}{/if}</strong>{/if}
  </div>
  {#if searchable}<button class="ghost icon" data-testid={lent?.searchTestid ?? 'mobile-search-open'} aria-label={lent?.searchLabel ?? strings.mobile.search} title={lent?.searchLabel ?? strings.mobile.search} onclick={() => searching = true}><Search size={20} /></button>{/if}
  {/if}
  {#if !recover && !chatting && experimentOn('whip')}<WhipButton mobile />{/if}
  {#if narrow.current && ContactRequestNotice && contactsShown(store)}<ContactRequestNotice {store} />{/if}
  <!-- One way to create per screen: a page (Bots, Contacts, Settings) owns its own. -->
  {#if tabbed && !recover && store.page === 'chat' && !(searching && searchable)}
    <!-- A new conversation, neutral at the header's end as on the desktop list. -->
    <button class="ghost icon new" data-testid="mobile-new" aria-label={strings.sidebar.newThread} title={strings.sidebar.newThread} disabled={draftOwner.connection !== 'ready'} onclick={() => void newThread()}><Plus size={20} /></button>
  {:else if lent?.create && !(searching && searchable)}
    {@const create = lent.create}
    {#if create.items}<Menu items={create.items} onpick={id => create.onpick(id)} label={create.label} placement="bottom" align="end" variant="ghost" testid={create.testid}><Plus size={20} /></Menu>
    {:else}<button class="ghost icon new" data-testid={create.testid} aria-label={create.label} title={create.label} onclick={() => create.onpick()}><Plus size={20} /></button>{/if}
  {/if}
</header>

{#if tabbed || leaving}
  <MobileTabs {store} screen={listScreen} waiting={threadsNeedingYou(machines.map(machine => machine.store)) + inbox.contacts} navigate={show} inert={leaving} />
{/if}

{#snippet contacts()}
  {#if SidebarContacts && contactsShown(store)}<div class="contacts-slot"><SidebarContacts {store} {machines} /></div>{/if}
{/snippet}

{#if narrow.current && store.page === 'chat' && (screen !== 'chat' || recover || leaving)}
  <section class="mobile-list" class:recent={inRecent} class:tabbed={tabbed || leaving} inert={leaving} bind:this={scrollRoot} onscroll={() => { if (scrollRoot) scrollPositions.set(listKey, scrollRoot.scrollTop); }} data-testid="mobile-list" aria-label={listScreen === 'activity' ? strings.mobile.activity : strings.sidebar.threads}>
    {#if recover && narrow.current}
      <MobileConnect {store} onpaired={() => show('threads')} />
    {:else}
    <!-- Recent's filters open the list; the search and the display options are the header's. -->
    {#if (inRecent && groups.length) || atWorkRows.length > 0}
      <div class="filters list-heading">
        {#if inRecent && groups.length}
          <Menu items={filterItems} onpick={key => projectView.pick(key)} label={strings.sidebar.filterProject} placement="bottom" variant="ghost" testid="mobile-project-filter">
            {#if selected}<ProjectTile project={selected.project} store={selected.machine.store} size={16} />{:else}<Folder size={14} />{/if}<span class="ui-label">{selected ? projectName(selected.project) : strings.sidebar.allProjects}</span>{#if selected && several}<span class="filter-machine ui-label">{selected.machine.label}</span>{/if}<ChevronDown size={13} />
          </Menu>
        {/if}
        {#if atWorkRows.length > 0}
          <button class="ghost at-work" class:on={atWorkShown} aria-pressed={atWorkShown} title={strings.mobile.atWorkFilter} data-testid="mobile-at-work" onclick={() => atWorkOnly = !atWorkShown}><Radar size={14} aria-hidden="true" /><span class="ui-label">{fill(strings.mobile.atWork, { count: String(atWorkRows.length) })}</span></button>
        {/if}
      </div>
    {/if}
    {#snippet threadRow(row: typeof rows[number], grouped = false)}
      <MobileThreadRow machine={row.machine} thread={row.thread} project={row.project} {now} compact={!grouped} reason={row.reason} at={row.at} nested={row.nested} where={!grouped && inRecent ? places(row) : undefined} items={rowItems(row.machine.store, row.thread)} tools={rowTools(row.machine.store, row.thread)}
        onopen={() => { show('chat'); void workspace.select(row.machine.store, row.thread.id); }} onaction={action => rowAction(row.machine.store, row.thread, action, row.machine.id)} />
    {/snippet}
    {#if listScreen === 'threads' && workspace.view === 'projects'}
      {#snippet projectRows(projects: ProjectEntry[], later = false)}
      {#each projects as group (projectKey(group))}
        {@const groupRows = rows.filter(row => row.machine.id === group.machine.id && row.thread.projectId === group.project.id)}
        {@const workingOpen = projectThreadView.isOpen(group, 'working')}
        {@const doneOpen = archiveCount(group.project, 'done') > 0 && doneFilter.shown}
        {@const archivedOpen = archiveCount(group.project, 'archived') > 0 && (later || projectThreadView.isOpen(group, 'archived'))}
        {@const workingRows = groupRows.filter(row => workingThread(row.machine.store, row.thread))}
        {@const attentionRows = query || !recentPreferences.groupWorking ? groupRows : groupRows.filter(row => workingOpen ? !workingThread(row.machine.store, row.thread) : !groupWorkingThread(group.machine.store, row.thread))}
        {@const controls = `mobile-project-${encodeURIComponent(projectKey(group))}`}
        {@const drafts = group.machine.store.draftEntries.filter(entry => entry.projectId === group.project.id)}
        {#if !query || groupRows.length > 0 || doneOpen || archivedOpen}
        <section class="project-group" class:inactive={!activeProject(group)} data-testid="mobile-project-group" data-project-id={group.project.id} data-machine-id={group.machine.id}>
          <div class="project-heading">
            <ProjectTile project={group.project} store={group.machine.store} /><h2><span class="name">{projectName(group.project)}</span>{#if several && (group.machine !== home || group.machine.store.connection !== 'ready')}<span class="host">{group.machine.label}</span>{/if}</h2>
            <ProjectThreadCounters entry={group} working={group.machine.store.threadsOf(group.project.id).filter(thread => workingThread(group.machine.store, thread)).length} waiting={group.machine.store.connection === 'ready' ? waitingCount(group) : 0} {controls} searching={!!query} away={group.machine.store.connection !== 'ready'} />
            {#if projectView.order === 'manual'}
              <Menu items={[
                { id: 'up', label: strings.sidebar.moveProjectUp, disabled: projectKey(foldOf(group)[0]!) === projectKey(group) },
                { id: 'down', label: strings.sidebar.moveProjectDown, disabled: projectKey(foldOf(group).at(-1)!) === projectKey(group) }
              ]} onpick={action => projectView.step(foldOf(group), projectKey(group), action === 'up' ? -1 : 1)} label={strings.sidebar.customOrder} placement="bottom" variant="ghost" testid="mobile-project-order"><ArrowUpDown size={18} /></Menu>
            {/if}
            <!-- The desktop header's menu: a new thread here, the path, archived threads and their switch (a set-aside group always shows them), managing the project. -->
            <button type="button" class="ghost icon project-actions" data-testid="mobile-project-menu" title={strings.sidebar.projectMenu} aria-label={strings.sidebar.projectMenu}
              onclick={(event) => projectMenu(event, group.machine.store, group.project, undefined, () => show('chat'), later ? undefined : {
                count: archiveCount(group.project, 'archived'), open: projectThreadView.isOpen(group, 'archived'), toggle: () => projectThreadView.toggle(group, 'archived')
              })}><Ellipsis size={18} /></button>
          </div>
          {#if !query}{#each drafts as draft (draft.id)}<DraftRow owner={group.machine.store} entry={draft} onopen={() => show('chat')} />{/each}{/if}
          <WindowList items={attentionRows} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements(projectKey(group))}>
            {#snippet row(entry)}{@render threadRow(entry, true)}{/snippet}
          </WindowList>
          <div id="{controls}-working" hidden={!workingOpen || !!query || workingRows.length === 0} data-testid="project-working">
            {#if workingOpen && !query && workingRows.length > 0}
              <GroupLabel kind="working" count={workingRows.length} />
              <WindowList items={workingRows} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements(`${projectKey(group)}:working`)}>
                {#snippet row(entry)}{@render threadRow(entry, true)}{/snippet}
              </WindowList>
            {/if}
          </div>
          <div id="{controls}-done" hidden={!doneOpen} data-testid="project-done">
            {#if doneOpen}<GroupLabel kind="done" count={query ? undefined : archiveCount(group.project, 'done')} />{/if}
            <RecentDone entries={[group]} {scrollRoot} {now} {query} open={doneOpen} header={false} onopen={() => show('chat')} />
          </div>
          <div id="{controls}-archived" hidden={!archivedOpen} data-testid="project-archived">
            {#if archivedOpen && !later}<GroupLabel kind="archived" count={query ? undefined : archiveCount(group.project, 'archived')} />{/if}
            <RecentDone kind="archived" entries={[group]} {scrollRoot} {now} {query} open={archivedOpen && (!later || projectThreadView.laterOpen)} header={false} onopen={() => show('chat')} />
          </div>
          {#if groupRows.length === 0 && !group.project.archivedThreads && drafts.length === 0}<p class="empty">{strings.sidebar.noThreads}</p>{/if}
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
      {@const needs = rows.filter(row => row.section === 'needs')}
      {@const updates = rows.filter(row => row.section === 'updates')}
      {@const asked = ContactInboxRows && contactsShown(store) && !query}
      {@const needsCount = needs.filter(row => !row.nested).length + (asked ? inbox.contacts : 0)}
      <!-- The section's number is the tab's badge: its top rows (a sub-agent counts on its parent) and what contacts ask. -->
      {#if needsCount > 0}<h2 class="section-label feed-section" data-testid="activity-needs" data-count={needsCount}>{strings.sidebar.state.waiting}<span class="feed-count">{count(needsCount)}</span></h2>{/if}
      {#if asked && ContactInboxRows}<ContactInboxRows {store} />{/if}
      <WindowList items={needs} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements('activity')}>
        {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
      </WindowList>
      {#if updates.length > 0}<h2 class="section-label feed-section" data-testid="activity-updates">{strings.mobile.feed.updates}</h2>{/if}
      <WindowList items={updates} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={66} measurements={measurements('activity-updates')}>
        {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
      </WindowList>
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
      <div class="activity-empty"><EmptyState line={strings.mobile.emptyActivity} testid="activity-empty" small /></div>
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
  .mobile-header, .mobile-list { display: none; }
  @media (max-width: 720px) {

    .mobile-header { display: flex; align-items: center; gap: 10px; min-height: 60px; padding: 8px max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left)); background: var(--color-background); border-bottom: 1px solid var(--color-border); padding-top: max(8px, env(safe-area-inset-top)); }
    .chat-heading { flex: 1; min-width: 0; height: 44px; }
    .mobile-header.chatting { gap: 6px; padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right)); }
    .chat-heading :global(.thread-header) { gap: 2px; }
    .chat-heading :global(.launcher span) { display: none; }
    .chat-heading :global(.launcher) { width: 44px; padding: 0; justify-content: center; flex: none; }
    .mobile-header > .icon { flex: none; color: var(--color-muted-foreground); }
    .search { display: flex; flex: 1; min-width: 0; gap: 8px; align-items: center; padding: 0 0 0 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); color: var(--color-muted-foreground); }
    .search > :global(svg) { flex: none; }
    /* The display options close the field's row, after a hairline. */
    .display { display: flex; align-self: stretch; align-items: center; flex: none; border-left: 1px solid var(--color-border); }
    .display :global(.trigger) { width: var(--touch-target); height: var(--touch-target); border-radius: 0 var(--radius-lg) var(--radius-lg) 0; }
    .search input { flex: 1; min-width: 0; border: 0; background: transparent; min-height: 44px; font-size: 16px; padding: 8px 0; }
    .search:focus-within { border-color: var(--color-muted-foreground); }
    .search input:focus { outline: none; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; }
    .filters :global(.menu) { min-width: 0; max-width: 100%; }
    .at-work, .filters :global(.trigger) { display: inline-flex; gap: 6px; align-items: center; height: auto; min-height: var(--touch-target); max-width: 100%; padding: 0 12px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-2); font-size: var(--text-sm); font-weight: 500; }
    .at-work { color: var(--color-foreground); }
    .filters :global(.trigger) { color: var(--color-foreground); }
    .filters :global(.trigger svg) { flex: none; color: var(--color-muted-foreground); }
    .filters :global(.trigger .ui-label) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .filters .filter-machine { color: var(--color-muted-foreground); font-weight: 400; }
    .at-work.on { border-color: var(--color-muted-foreground); background: var(--color-surface); }
    .brand-icon { flex: none; border-radius: var(--radius-md); }
    .back { position: relative; flex: none; }
    /* The page's name, under the machine it reads. */
    .brand strong { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.4px; line-height: 1.15; }
    /* The view switch's finger-sized target reaches past the line. */
    .brand strong:has(:global(.named)) { overflow: visible; }
    /* The place line above overlaps the title's top, so the hit area grows into the free band below it. */
    .brand strong :global(.named::before) { content: ''; position: absolute; inset: -8px -4px -14px; }
    /* A finger-sized target without growing the header: the line reaches into the header's padding. */
    .connection { position: relative; z-index: 1; display: flex; gap: 5px; height: auto; min-height: var(--touch-target); min-width: var(--touch-target); max-width: 100%; margin: -14px 0 -12px; padding: 0; font-size: var(--text-xs); font-weight: 500; color: var(--color-muted-foreground); }
    .connection > span:not(.dot) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--color-muted-foreground); }
    .dot.ready { background: var(--color-success); }
    .identity { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; flex: 1; }
    .mobile-header > :global(.menu) { flex: none; }
    .mobile-list { display: block; position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; background: var(--color-background); padding: 8px max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
    /* The bottom bar owns the home indicator's inset. */
    .mobile-list.tabbed { padding-bottom: 20px; }
    .list-heading { padding: 8px 0 12px; }
    p { font-size: var(--text-sm); }
    /* One frame: a quiet surface, no border and no banded header inside it. */
    .project-group { --row-background: var(--color-surface); border-radius: var(--radius-lg); background: var(--color-surface); margin-bottom: 12px; overflow: hidden; }
    .project-heading { display: flex; align-items: center; padding: 8px 12px; gap: 8px; color: var(--color-muted-foreground); }
    /* The name, then its machine in quiet ink, on one line: the machine gives way first. */
    .project-heading h2 { display: flex; align-items: baseline; gap: 6px; margin: 0; flex: 1; min-width: 0; font-size: var(--text-sm); }
    .project-heading .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .project-heading .host { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); font-weight: 400; color: var(--color-subtle); }
    /* A whole touch target that eats the heading's padding rather than making it taller. */
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
    :global(.app:not(.shell)) > .mobile-header[data-slide] ~ :global(.body) { grid-row: 2 / 4; z-index: 3; visibility: visible; content-visibility: visible; background: var(--screen-background, var(--color-background)); box-shadow: var(--shadow-screen); animation: screen-in var(--dur-3) var(--ease-slide) both; }
    :global(.app:not(.shell)) > .mobile-header[data-slide='pop'] ~ :global(.body) { animation-name: screen-out; }
    .mobile-header[data-slide='push'] ~ .mobile-list, .mobile-header[data-slide='push'] ~ :global(.mobile-tabs) { pointer-events: none; animation: screen-under-out var(--dur-3) var(--ease-slide) both; }
    .mobile-header[data-slide='pop'] ~ .mobile-list, .mobile-header[data-slide='pop'] ~ :global(.mobile-tabs) { animation: screen-under-in var(--dur-3) var(--ease-slide) both; }
    .mobile-list.recent { display: flex; flex-direction: column; }
    .mobile-list.recent > :global(*) { flex-shrink: 0; }
    .recent-folds { margin-top: auto; padding-top: 16px; }
    .recent-done { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
    /* A section's name over its rows, from the rows' edge; the second stands off the first. */
    .feed-section { margin: 8px 12px 4px; }
    .feed-section ~ .feed-section { margin-top: 20px; }
    /* The section's count, the tab badge's number: amber marks it, the word stays grey. */
    .feed-count { margin-left: 6px; color: var(--color-live); font-variant-numeric: tabular-nums; }
  }
</style>
