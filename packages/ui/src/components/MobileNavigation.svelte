<script lang="ts">
  import { tick } from 'svelte';
  import WindowList from './WindowList.svelte';
  import MobileTabs from './MobileTabs.svelte';
  import ThreadHeader from './ThreadHeader.svelte';
  import { Activity, ArrowLeft, ArrowUpDown, Bot, ChevronDown, Ellipsis, FolderOpen, FolderPlus, LoaderCircle, MessageSquare, Plus, Search, X } from '@lucide/svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import MobileConnect from './MobileConnect.svelte';
  import type { Store } from '../lib/store.svelte';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import { fill, strings } from '../lib/strings';
  import { projectName } from '../lib/format';
  import { mobileOverlay } from '../lib/mobile-history';
  import { groupWorkingThread, recentPreferences } from '../lib/recent.svelte';
  import { pickThreadAction, threadMenuItems } from '../lib/thread-menu';
  import { projectMenu } from '../lib/project-menu';
  import { separator, type MenuItem } from '../lib/menu';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import Menu from './Menu.svelte';
  import WhipButton from './WhipButton.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { mobileChrome } from '../lib/mobile-chrome.svelte';
  import PhoneThreadRow from './PhoneThreadRow.svelte';
  import PhoneLifecycleList from './PhoneLifecycleList.svelte';
  import LifecycleStrip from './LifecycleStrip.svelte';
  import { lifecycleFilter } from '../lib/lifecycle-filter.svelte';
  import DisplayOptions from './DisplayOptions.svelte';
  import RecentGroup from './RecentGroup.svelte';
  import RecentDone from './RecentDone.svelte';
  import ProjectThreadCounters from './ProjectThreadCounters.svelte';
  import ProjectShelf from './ProjectShelf.svelte';
  import ProjectCardsSection from './ProjectCardsSection.svelte';
  import DraftRow from './DraftRow.svelte';
  import GroupLabel from './GroupLabel.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import MachineSuffix from './MachineSuffix.svelte';
  import { namesMachine } from '../lib/row-machine';
  import { projectKey, projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { activeProject, archiveCount, projectSections, projectThreadView } from '../lib/project-threads.svelte';
  import { workingThread } from '../lib/recent.svelte';
  import { bandStarts, compareThreads, type ThreadBand } from '../lib/thread-order';
  import { flipRows } from '../lib/flip-rows.svelte';
  import { pickView, viewMenuItems } from '../lib/view-menu';
  import { minuteClock } from '../lib/clock.svelte';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { moreRows, threadLanes } from '../lib/thread-lanes.svelte';
  import { threadState } from '../lib/thread-state';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { ScreenSlide } from '../lib/screen-slide.svelte';
  import { inbox, storeLiveKind, storeOrder, storeSources, type InboxReason } from '../lib/inbox';
  import { firstRunSteps } from '../lib/first-run.svelte';
  import FirstRun from './home/FirstRun.svelte';

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
  // The contact request notice and the Bots header's Contacts button, loaded with their experiment; the Threads tab lists no contacts.
  let ContactRequestNotice = $state<typeof import('./home/ContactRequestNotice.svelte').default>();
  let ContactsButton = $state<typeof import('./home/ContactsButton.svelte').default>();
  $effect(() => {
    if (!contactsShown(store) || ContactsButton) return;
    void import('./home/ContactRequestNotice.svelte').then(module => { ContactRequestNotice = module.default; }).catch(() => {});
    void import('./home/ContactsButton.svelte').then(module => { ContactsButton = module.default; }).catch(() => {});
  });
  let search = $state('');
  /** The search waits under the large title, so the first rows start high; its button or a query shows it. */
  let searchOpen = $state(false);
  let searchField = $state<HTMLInputElement>();
  async function openSearch() { searchOpen = true; await tick(); searchField?.focus(); }
  const query = $derived(search.trim().toLocaleLowerCase());
  const chatting = $derived(screen === 'chat' && !recover && store.page === 'chat');
  /** The bottom bar: on every list and page, the recovery screen too, not in a conversation nor in one a page opened. Only a phone's width draws it. */
  $effect.pre(() => { tabbed = !chatting && !(store.page === 'agents' && mobileChrome.detail); });
  /** What the header names: the page, or the list on screen. */
  const title = $derived(store.page === 'settings' ? strings.settings.heading : store.page === 'agents' ? strings.agents.heading : store.page === 'home' ? strings.contacts.heading
    : recover ? 'Boite' : screen === 'activity' ? strings.mobile.activity : strings.mobile.threads);
  /**
   * A conversation scrolled under the header: the header takes the opaque surface, so the lines under it never read
   * half-buried through it. The timeline is the app's, beside this header in its grid; its scroll does not bubble, so
   * the grid listens in the capture phase. Each thread opens on its own scroll, read again when it changes.
   */
  let covered = $state(false);
  $effect(() => {
    const root = header?.parentElement;
    void store.openThread?.id;
    if (!root || !chatting || !narrow.current) { covered = false; return; }
    const read = (target: EventTarget | null) => { if (target instanceof HTMLElement && target.matches('[data-testid=timeline]')) covered = target.scrollTop > 0; };
    const onscroll = (event: Event) => read(event.target);
    root.addEventListener('scroll', onscroll, { capture: true, passive: true });
    read(root.querySelector('[data-testid=timeline]'));
    void tick().then(() => read(root.querySelector('[data-testid=timeline]')));
    return () => root.removeEventListener('scroll', onscroll, { capture: true });
  });
  let scrollRoot = $state<HTMLElement>();
  /** A list's large title scrolls away with it; past it, the bar's own title fades in, as a phone's lists do. */
  const listed = $derived(narrow.current && store.page === 'chat' && !recover && !chatting);
  let scrolled = $state(false);
  function scrolling() {
    if (!scrollRoot) return;
    const top = scrollRoot.scrollTop;
    scrollPositions.set(listKey, top);
    scrolled = top > 28;
  }
  const scrollPositions = new Map<string, number>();
  const measuredRows = new Map<string, Map<string, number>>();
  function measurements(key: string): Map<string, number> {
    if (!measuredRows.has(key)) measuredRows.set(key, new Map());
    return measuredRows.get(key)!;
  }
  /** Each filter keeps its own position: the lifecycle filter is part of the key, so Needs you, a thread and Back land where it was. */
  const listKey = $derived(`${listScreen}:${workspace.view}:${projectView.filter}:${lifecycleFilter.current ?? 'all'}`);
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
    return machine.store.threads.filter(t => !t.archived && !t.incognito && !t.teamId && !t.debateId).map(thread => ({ machine, thread, project: thread.projectId === null ? undefined : byId.get(thread.projectId) }));
  }));
  /** The Inbox tab: what waits on the user, in Recent's order, then the work going on (`lib/inbox.ts`, the desktop home's Inbox too). */
  let lists = $derived(inbox(storeSources(machines)));
  let waiting = $derived(lists.needs);
  /** What waits on the user besides the conversation on screen: Back carries its mark. */
  let elsewhere = $derived(waiting.filter(e => !(e.machine.store === store && e.thread.id === store.openThread?.id)).length);
  const matches = (e: { machine: Machine; thread: ThreadSummary; project: Project | undefined }) => !query || [e.thread.title, projectName(e.project), e.thread.branch, e.machine.label].some(value => value?.toLocaleLowerCase().includes(query));
  const inboxNeeds = $derived(lists.needs.filter(matches).map(({ machine, thread, project, kind, reason, since }) => ({ machine, thread, project, kind, wait: { reason, since } })));
  const inboxWorking = $derived(lists.working.filter(matches).map(({ machine, thread, project, kind }) => ({ machine, thread, project, kind })));
  /** A lane's number counts project threads, as the strip does; the bots' rows count apart, as on the desktop home. */
  const split = (lane: readonly { kind: string }[]) => { const bots = lane.filter(row => row.kind === 'bots').length; return { threads: lane.length - bots, bots }; };
  const needsSplit = $derived(split(inboxNeeds));
  const workingSplit = $derived(split(inboxWorking));
  /** Only Inbox rows say what they wait on. */
  const waitOf = (row: object) => 'wait' in row ? row.wait as { reason: InboxReason; since: number } : undefined;
  const recentGroups = $derived(selected ? [selected] : groups);
  const rowKey = (row: { machine: Machine; thread: ThreadSummary }) => JSON.stringify([row.machine.id, row.thread.id]);
  /** Where a row counts (`threadLiveKind`): the sort and the bands read the tabs' own classification. */
  const liveOf = (row: { machine: Machine; thread: ThreadSummary }) => storeLiveKind(row.machine.store, row.thread);
  /**
   * Recent lists what the sidebar's Recent lists (`threadsOf` of each listed project): a bot's own thread lives
   * under Bots on both sizes, so the Working band and its tab count the same rows.
   */
  const recentIds = $derived(new Set(recentGroups.flatMap(({ machine, project }) => machine.store.threadsOf(project.id).map(thread => rowKey({ machine, thread })))));
  let rows = $derived(listScreen === 'activity' ? [...inboxNeeds, ...inboxWorking] : entries
    .filter(matches)
    .filter(e => workspace.view === 'recent' ? recentIds.has(rowKey(e)) : !e.thread.parentThreadId && !e.project?.archived)
    .map(row => ({ row, key: storeOrder(row.machine.store, row.thread) }))
    .sort((a, b) => compareThreads(a.row.thread, b.row.thread, a.key, b.key))
    .map(({ row }) => row));
  let projects = $derived([...machines.flatMap(m => m.store.projects.filter(p => p.archived !== true).map(p => ({
    id: JSON.stringify([m.id, p.id]), label: projectName(p), hint: several ? m.label : '', projectTile: { project: p, store: m.store },
    active: m.store === store && p.id === project?.id
  }))), ...(store.owner ? [separator('add-sep'), { id: 'add-project', label: strings.sidebar.addProject, hint: '', active: false, glyph: FolderPlus }] : [])]);
  const inRecent = $derived(listScreen === 'threads' && workspace.view === 'recent');
  /** The list header's picker, the sidebar's: the view, then, in Recent, one project or all of them. */
  const viewItems = $derived(viewMenuItems(groups, several));
  let workingOpen = $state(false);
  const groupWorking = $derived(inRecent && recentPreferences.groupWorking && !query);
  const working = $derived(groupWorking ? rows.filter(row => groupWorkingThread(row.machine.store, row.thread)) : []);
  const attention = $derived(groupWorking ? rows.filter(row => !groupWorkingThread(row.machine.store, row.thread)) : rows);
  /** Recent's bands, the sidebar's: a label where the rows pass from what needs the user to what works, then to the rest. */
  const phoneBands = $derived(inRecent && !query ? bandStarts(attention, row => row.thread, rowKey, liveOf) : new Map<string, ThreadBand>());
  /** The first row of each band, and of Recent's list when it draws no label: its card's top corners round there. */
  const bandHeads = $derived(new Set(inRecent && attention.length ? [rowKey(attention[0]!), ...phoneBands.keys()] : []));
  /** The last row of each band: its card ends there, so no hairline under it and its bottom corners round. */
  const bandEnds = $derived(new Set(bandHeads.size ? attention.filter((row, index) => { const next = attention[index + 1]; return !next || bandHeads.has(rowKey(next)); }).map(rowKey) : []));
  /** A row that changes band or lane slides there, as in the sidebar; the key reads ids and states only. */
  flipRows(() => scrollRoot, () => [...rows.map(row => `${rowKey(row)}:${row.thread.status}`), '|', ...working.map(rowKey), '|', ...phoneBands.keys()].join(), () => `${listKey}:${query}`);

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
  /** A phone's row menu: the thread's lifecycle, as in its header (`threadMenuItems`' phone set). */
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
  /** Adding a project from the picker starts a draft in it: the phone opens that draft, as the desktop does. */
  let known = $state<Set<string> | null>(null);
  $effect(() => {
    if (!known || store.projectPickerOpen) return;
    const before = known;
    known = null;
    if (store.draft?.projectId && !before.has(store.draft.projectId)) show('chat');
  });
  async function pickProject(key: string) {
    if (key === 'add-project') { known = new Set(store.projects.map(p => p.id)); store.projectPickerOpen = true; return; }
    const [id, projectId] = JSON.parse(key) as [string, string];
    const target = machines.find(m => m.id === id);
    if (!target) return;
    await workspace.select(target.store, undefined, projectId);
    show('chat');
  }
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
  const laterLists = ['archived'] as const;
</script>

<header class="mobile-header" class:chatting class:covered={chatting && covered} class:settings={store.page !== 'chat'} data-testid="mobile-header" data-slide={slide.direction} bind:this={header}>
  {#if chatting}
    <!-- The only way out of a conversation on a phone: it carries the mark of a thread that waits on the user elsewhere. -->
    <button class="ghost icon back" data-testid="mobile-back" aria-label={elsewhere ? `${strings.mobile.threads}, ${fill(strings.mobile.waitingElsewhere, { count: String(elsewhere) })}` : strings.mobile.threads} onclick={() => show('threads')}><ArrowLeft size={20} />{#if elsewhere}<span class="waiting-mark" data-testid="mobile-back-waiting"></span>{/if}</button>
  {:else if recover}
    <img class="brand-icon" src="./icons/icon.svg" alt="" width="30" height="30" />
  {:else}
    <!-- The logo stands where Back does in a conversation, and goes to the same list. -->
    <button class="ghost icon home" data-testid="mobile-home" aria-label={strings.mobile.threads} onclick={() => show('threads')}><img class="brand-icon" src="./icons/icon.svg" alt="" width="30" height="30" /></button>
  {/if}
  {#if chatting && narrow.current}
    <div class="chat-heading">{#key store}<ThreadHeader {store} />{/key}</div>
  {:else}
  <!-- The machine over the page's name; the places themselves are the bottom bar's. -->
  <div class="identity brand">
    <button class="ghost connection" data-testid="mobile-connection" onclick={() => store.showSettings('machines')}><span class="dot" class:ready={store.connection === 'ready'}></span><span class="ui-label">{place}</span><ChevronDown size={12} /></button>
    <strong data-testid="mobile-title" class:folded={(listed && !scrolled) || (store.page === 'settings' && mobileChrome.largeTitle)}>{title}</strong>
  </div>
  {/if}
  <!-- The project the bar's + starts in, by its picture: the sheet names them all, and adds one. -->
  {#if !recover && screen === 'threads' && store.page === 'chat'}
    <Menu items={projects} onpick={pickProject} label={project ? `${strings.mobile.project} · ${projectName(project)}` : strings.mobile.project} placement="bottom" variant="ghost" testid="mobile-project">{#if project}<ProjectTile {project} {store} size={24} />{:else}<FolderOpen size={20} />{/if}</Menu>
  {/if}
  {#if !recover && !chatting && experimentOn('whip')}<WhipButton mobile />{/if}
  <!-- A conversation's row is for its title: the contacts count stays on the lists, the pages and the Inbox. -->
  {#if narrow.current && ContactRequestNotice && contactsShown(store) && !chatting}<ContactRequestNotice {store} />{/if}
  <!-- Contacts left the bottom bar: the Bots page's header carries it with bots on, Settings lists it otherwise. -->
  {#if narrow.current && ContactsButton && contactsShown(store) && store.page === 'agents' && !mobileChrome.detail}<ContactsButton {store} />{/if}
</header>

{#if tabbed || leaving}
  <MobileTabs {store} screen={listScreen} waiting={lists.tally.threads.needs} navigate={show} onnew={() => void newThread()} newDisabled={draftOwner.connection !== 'ready'} inert={leaving} />
{/if}


{#if narrow.current && store.page === 'chat' && (screen !== 'chat' || recover || leaving)}
  <section class="mobile-list" class:recent={inRecent} class:tabbed={tabbed || leaving} inert={leaving} bind:this={scrollRoot} onscroll={scrolling} data-testid="mobile-list" aria-label={listScreen === 'activity' ? strings.mobile.activity : strings.mobile.threads}>
    {#if recover && narrow.current}
      <MobileConnect {store} onpaired={() => show('threads')} />
    {:else}
    <!-- The list's name, until it scrolls under the bar; the bar's title says it from then on. The view pill sits
         beside it, the search and the display options at its end: one row, so the rows start under it. -->
    <div class="title-row">
      <p class="large-title" aria-hidden="true">{title}</p>
      {#if listScreen === 'threads' && groups.length}
        <!-- The view and, in Recent, the project it lists: the sidebar's picker. The lifecycle tabs under it count the work. -->
        <div class="filters">
          <Menu items={viewItems} onpick={pickView} label={strings.sidebar.viewPicker} placement="bottom" variant="ghost" testid="mobile-project-filter">
            <span class="view-name ui-label" data-testid="mobile-view-name">{inRecent ? strings.sidebar.recentView : strings.sidebar.projectsView}</span>{#if inRecent && selected}<ProjectTile project={selected.project} store={selected.machine.store} size={16} /><span class="ui-label">{projectName(selected.project)}</span>{#if several && namesMachine(selected.machine, selected.machine.store.connection !== 'ready')}<MachineSuffix machine={selected.machine} testid="mobile-filter-machine" />{/if}{/if}<ChevronDown size={13} />
          </Menu>
        </div>
      {/if}
      <button type="button" class="ghost icon" aria-label={strings.mobile.search} aria-expanded={searchOpen || !!search} data-testid="mobile-search-open" onclick={() => (searchOpen || search ? (searchOpen = false, search = '') : void openSearch())}><Search size={19} /></button>
      {#if listScreen === 'threads' && groups.length}<span class="display"><DisplayOptions entries={groups} target={undefined} owner={store} prefix="mobile-" compact /></span>{/if}
    </div>
    {#if searchOpen || search}
    <div class="list-heading">
      <div class="search"><Search size={17} /><input type="search" bind:this={searchField} bind:value={search} aria-label={strings.mobile.search} placeholder={strings.mobile.search} data-testid="mobile-search" />{#if search}<button class="ghost icon" aria-label={strings.mobile.clearSearch} onclick={() => search = ''}><X size={16} /></button>{/if}
      </div>
    </div>
    {/if}
    {#if listScreen === 'threads' && groups.length && !query}<div class="lifecycle-slot"><LifecycleStrip entries={groups} prefix="mobile-" /></div>{/if}
    {#snippet laneCount(count: { threads: number; bots: number }, testid: string)}
      {#if count.threads}<span class="count" data-testid="{testid}-threads" data-count={count.threads} title={fill(strings.inbox.threadsCount, { count: String(count.threads) })}>{count.threads}</span>{/if}{#if count.bots}<span class="count bots" data-testid="{testid}-bots" data-count={count.bots} title={fill(strings.inbox.botsCount, { count: String(count.bots) })} aria-label={fill(strings.inbox.botsCount, { count: String(count.bots) })}><Bot size={11} aria-hidden="true" />{count.bots}</span>{/if}
    {/snippet}
    {#snippet threadRow(row: typeof rows[number], grouped = false, banded = false, carded = false)}
      <!-- The row is worker 1's PhoneThreadRow: ring, two-line title, facts line, long press and both swipes. -->
      <!-- Under Recent's labels the Pinned label says the pin; a band's first and last rows round its card, the last with no hairline. -->
      <PhoneThreadRow machine={row.machine} project={row.project} thread={row.thread} {now} {grouped} {several} pin={!banded} start={carded && bandHeads.has(rowKey(row))} end={carded && bandEnds.has(rowKey(row))} wait={waitOf(row)} items={rowItems(row.machine.store, row.thread)}
        onopen={() => { show('chat'); void workspace.select(row.machine.store, row.thread.id); }}
        onaction={(action) => rowAction(row.machine.store, row.thread, action, row.machine.id)} />
    {/snippet}
    {#if listScreen === 'threads' && lifecycleFilter.current && !query}
      <!-- The lifecycle filter: in Projects, the matching projects under their headers; in Recent, its flat rows. -->
      <PhoneLifecycleList entries={groups} kind={lifecycleFilter.current} {now} {scrollRoot} {several} flat={workspace.view === 'recent'} row={threadRow} onopen={() => show('chat')} />
    {:else if listScreen === 'threads' && workspace.view === 'projects'}
      {#snippet projectRows(projects: ProjectEntry[], later = false)}
      {#each projects as group (projectKey(group))}
        {@const groupRows = rows.filter(row => row.machine.id === group.machine.id && row.thread.projectId === group.project.id)}
        {@const workingOpen = projectThreadView.isOpen(group, 'working')}
        {@const doneOpen = archiveCount(group.project, 'done') > 0 && projectThreadView.isOpen(group, 'done')}
        {@const archivedOpen = archiveCount(group.project, 'archived') > 0 && (later || projectThreadView.isOpen(group, 'archived'))}
        {@const workingRows = groupRows.filter(row => workingThread(row.machine.store, row.thread))}
        {@const attentionRows = query || !recentPreferences.groupWorking ? groupRows : groupRows.filter(row => workingOpen ? !workingThread(row.machine.store, row.thread) : !groupWorkingThread(group.machine.store, row.thread))}
        {@const controls = `mobile-project-${encodeURIComponent(projectKey(group))}`}
        {@const drafts = group.machine.store.draftEntries.filter(entry => entry.projectId === group.project.id)}
        {@const key = projectKey(group)}
        {@const lanes = threadLanes(attentionRows, row => threadState(row.thread, row.machine.store.subagents(row.thread.id)), {
          expanded: !!query || moreRows.isOpen(key), needsExpanded: !!query || moreRows.isOpen(`needs:${key}`),
          keep: row => row.thread.pinned || hasUnsentDraft(row.machine.store.composerStates[row.thread.id])
        })}
        {@const needsOpen = moreRows.isOpen(`needs:${key}`)}
        {@const moreOpen = moreRows.isOpen(key)}
        {#if !query || groupRows.length > 0 || doneOpen || archivedOpen}
        <section class="project-group" class:inactive={!activeProject(group)} data-testid="mobile-project-group" data-project-id={group.project.id} data-machine-id={group.machine.id}>
          <div class="project-heading">
            <ProjectTile project={group.project} store={group.machine.store} /><h2>{projectName(group.project)}{#if several && namesMachine(group.machine, group.machine.store.connection !== 'ready')}<MachineSuffix machine={group.machine} testid="mobile-project-machine" />{/if}</h2>
            <ProjectThreadCounters entry={group} working={group.machine.store.threadsOf(group.project.id).filter(thread => workingThread(group.machine.store, thread)).length} {controls} searching={!!query} away={group.machine.store.connection !== 'ready'} body={later ? laterLists : undefined} />
            {#if projectView.order === 'manual'}
              <Menu items={[
                { id: 'up', label: strings.sidebar.moveProjectUp, disabled: projectKey(foldOf(group)[0]!) === projectKey(group) },
                { id: 'down', label: strings.sidebar.moveProjectDown, disabled: projectKey(foldOf(group).at(-1)!) === projectKey(group) }
              ]} onpick={action => projectView.step(foldOf(group), projectKey(group), action === 'up' ? -1 : 1)} label={strings.sidebar.customOrder} placement="bottom" variant="ghost" testid="mobile-project-order"><ArrowUpDown size={18} /></Menu>
            {/if}
            <!-- The desktop header's menu: a new thread here, the path, archived threads, managing the project. -->
            <button type="button" class="ghost icon project-actions" data-testid="mobile-project-menu" title={strings.sidebar.projectMenu} aria-label={strings.sidebar.projectMenu}
              onclick={(event) => projectMenu(event, group.machine.store, group.project, undefined, () => show('chat'))}><Ellipsis size={18} /></button>
          </div>
          {#if !query}{#each drafts as draft (draft.id)}<DraftRow owner={group.machine.store} entry={draft} onopen={() => show('chat')} />{/each}{/if}
          <!-- The desktop's lanes: three asks, then `n more need you`; six more rows, then `n more`. A search shows every match. -->
          <WindowList items={lanes.needs} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={64} measurements={measurements(key)}>
            {#snippet row(entry)}{@render threadRow(entry, true)}{/snippet}
          </WindowList>
          {#if !query && lanes.needsFoldable > 0}
            <button type="button" class="ghost more-row needs" data-testid="mobile-more-needs" data-count={lanes.needsHidden.length} aria-expanded={needsOpen}
              aria-label={needsOpen ? strings.sidebar.fewerRows : fill(strings.sidebar.moreNeedsLabel, { project: projectName(group.project), count: String(lanes.needsHidden.length) })}
              onclick={() => moreRows.toggle(`needs:${key}`)}><ChevronDown size={14} aria-hidden="true" class={needsOpen ? 'flip' : ''} /><span class="ui-label">{needsOpen ? strings.sidebar.fewerRows : fill(strings.sidebar.moreNeeds, { count: String(lanes.needsHidden.length) })}</span></button>
          {/if}
          <WindowList items={[...lanes.live, ...lanes.rest]} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={64} measurements={measurements(`${key}:rest`)}>
            {#snippet row(entry)}{@render threadRow(entry, true)}{/snippet}
          </WindowList>
          {#if !query && lanes.foldable > 0}
            <button type="button" class="ghost more-row" data-testid="mobile-more" data-count={lanes.hidden.length} aria-expanded={moreOpen}
              aria-label={moreOpen ? strings.sidebar.fewerRows : fill(strings.sidebar.moreRowsLabel, { project: projectName(group.project), count: String(lanes.hidden.length) })}
              onclick={() => moreRows.toggle(key)}><ChevronDown size={14} aria-hidden="true" class={moreOpen ? 'flip' : ''} /><span class="ui-label">{moreOpen ? strings.sidebar.fewerRows : fill(strings.sidebar.moreRows, { count: String(lanes.hidden.length) })}</span>{#if !moreOpen && lanes.hiddenLive > 0}{@const busy = fill(strings.sidebar.projectWorkingThreads, { project: projectName(group.project), count: String(lanes.hiddenLive) })}<span
                class="more-live" data-testid="project-more-working" data-count={lanes.hiddenLive} role="img" title={busy} aria-label={busy}><LoaderCircle size={12} aria-hidden="true" /><span class="ui-label">{lanes.hiddenLive}</span></span>{/if}</button>
          {/if}
          <div id="{controls}-working" hidden={!workingOpen || !!query || workingRows.length === 0} data-testid="project-working">
            {#if workingOpen && !query && workingRows.length > 0}
              <GroupLabel kind="working" count={workingRows.length} />
              <WindowList items={workingRows} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={77} measurements={measurements(`${projectKey(group)}:working`)}>
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
      {/if}
      <WindowList items={rows.filter(row => row.thread.projectId === null)} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={77} measurements={measurements('unassigned')}>
        {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
      </WindowList>
    {:else if listScreen === 'activity'}
      <!-- A contact's request or message heads the Inbox, as on the desktop home; the header's count opens its contact. -->
      {#if ContactRequestNotice && contactsShown(store)}<div class="contact-flow"><ContactRequestNotice {store} flow /></div>{/if}
      <!-- Two lanes, as the desktop home's Inbox: what waits on the user, then the work going on. -->
      {#if inboxNeeds.length > 0}
        <!-- As on the desktop home: the threads' number is the strip's Needs you, a bot's ask counts apart. -->
        <h2 class="lane" data-testid="mobile-inbox-needs"><span class="ui-label">{strings.inbox.needsYou}</span>{@render laneCount(needsSplit, 'mobile-inbox-needs')}</h2>
        <WindowList items={inboxNeeds} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={77} measurements={measurements('inbox-needs')}>
          {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
        </WindowList>
      {/if}
      {#if inboxWorking.length > 0}
        <h2 class="lane working" data-testid="mobile-inbox-working"><span class="ui-label">{strings.inbox.workingNow}</span>{@render laneCount(workingSplit, 'mobile-inbox-working')}</h2>
        <WindowList items={inboxWorking} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={77} measurements={measurements('inbox-working')}>
          {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
        </WindowList>
      {/if}
    {:else}
      <WindowList items={attention} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={77} measurements={measurements(listScreen)}>
        {#snippet row(entry)}{@const band = phoneBands.get(rowKey(entry))}{#if band}<p class="band ui-label" class:first={entry === attention[0]} role="heading" aria-level="3" data-testid="mobile-recent-band" data-band={band}>{strings.sidebar.bands[band]}</p>{/if}{@render threadRow(entry, false, phoneBands.size > 0, inRecent)}{/snippet}
      </WindowList>
      {#if inRecent}
        <div class="recent-folds">
          {#if working.length > 0}
            <RecentGroup kind="working" count={working.length} bind:open={workingOpen}>
              <WindowList items={working} keyOf={row => JSON.stringify([row.machine.id, row.thread.id])} {scrollRoot} estimate={77} measurements={measurements('recent-working')}>
                {#snippet row(entry)}{@render threadRow(entry)}{/snippet}
              </WindowList>
            </RecentGroup>
          {/if}
          <RecentDone entries={recentGroups} {scrollRoot} {now} {query} onopen={() => show('chat')} />
          <RecentDone kind="archived" entries={recentGroups} {scrollRoot} {now} {query} onopen={() => show('chat')} />
        </div>
      {/if}
    {/if}
    {#if listScreen === 'threads' && !entries.length && !query && firstRunSteps(store).active}
      <!-- An empty app: the same two steps as the desktop's home, in place of a New thread that could send nothing yet. -->
      <div class="first-run-slot"><FirstRun {store} prefix="mobile-" /></div>
    {:else if rows.length === 0 && (query || listScreen === 'activity' || workspace.view === 'recent' || groups.length === 0) && !(inRecent && !query && recentGroups.some(entry => entry.project.archivedThreads))}
      <div class="empty-state">
        <span class="empty-icon">{#if listScreen === 'activity'}<Activity size={24} />{:else}<MessageSquare size={24} />{/if}</span>
        <h2>{listScreen === 'activity' && !query ? strings.inbox.nothing : listScreen === 'activity' ? strings.mobile.emptyActivity : entries.length ? strings.mobile.noThreads : strings.mobile.emptyTitle}</h2>
        <p>{listScreen === 'activity' ? strings.mobile.noActivity : entries.length ? strings.mobile.search : strings.mobile.emptyBody}</p>
        {#if listScreen === 'threads' && !entries.length}<button class="primary" data-testid="mobile-first-thread" disabled={draftOwner.connection !== 'ready'} onclick={newThread}><Plus size={16} /><span class="ui-label">{strings.sidebar.newThread}</span></button>{/if}
      </div>
    {/if}
    {/if}
  </section>
{/if}

<style>
  .mobile-header, .mobile-list { display: none; }
  @media (max-width: 720px) {

    .mobile-header { display: flex; align-items: center; gap: 10px; min-height: 60px; padding: 8px max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left)); background: transparent; border-bottom: 1px solid transparent; padding-top: max(8px, env(safe-area-inset-top)); }
    /* Over a conversation a hairline keeps the title off the messages; over the list the wallpaper runs on. */
    .mobile-header.chatting { border-bottom-color: var(--color-border); transition: background-color var(--dur-2) var(--ease-out-quint); }
    /* Lines scrolled up under it: the opaque surface, glass or solid, so no bubble reads half-buried behind a see-through bar. */
    .mobile-header.chatting.covered { background: var(--color-surface); }
    /* At least a finger high; a thread title on two lines makes it taller (ThreadHeader). */
    .chat-heading { flex: 1; min-width: 0; min-height: 44px; }
    .mobile-header.chatting { gap: 6px; padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right)); }
    .chat-heading :global(.thread-header) { gap: 2px; }
    .chat-heading :global(.launcher span) { display: none; }
    .chat-heading :global(.launcher) { width: 44px; padding: 0; justify-content: center; flex: none; }
    .search { display: flex; gap: 8px; align-items: center; padding: 0 0 0 12px; background: var(--color-control-surface); border: 1px solid transparent; border-radius: var(--radius-lg); color: var(--color-muted-foreground); }
    .search > :global(svg) { flex: none; }
    /* The display options close the field's row, after a hairline. */
    .display { display: flex; align-self: stretch; align-items: center; flex: none; border-left: 1px solid var(--color-border); }
    .display :global(.trigger) { width: var(--touch-target); height: var(--touch-target); border-radius: 0 var(--radius-lg) var(--radius-lg) 0; }
    .search input { flex: 1; min-width: 0; border: 0; background: transparent; min-height: 44px; font-size: 16px; padding: 8px 0; }
    .search:focus-within { border-color: var(--color-accent); }
    .search input:focus { outline: none; }
    /* Beside the title, the pill takes what the icons leave and shortens its project first. */
    .filters { display: flex; flex: 0 1 auto; min-width: 0; margin-left: 4px; }
    .filters :global(.menu) { min-width: 0; max-width: 100%; }
    /* The pill sizes to its words: the ghost variant's square would cut them. */
    .filters :global(.trigger.ghost) { width: auto; padding: 0 14px; }
    .filters :global(.trigger) { display: inline-flex; gap: 6px; align-items: center; height: auto; min-height: var(--touch-target); max-width: 100%; padding: 0 14px; border: 1px solid transparent; border-radius: var(--radius-full); background: var(--color-control-surface); font-size: var(--text-sm); font-weight: 500; }
    .filters :global(.trigger) { color: var(--color-foreground); }
    .filters :global(.trigger svg) { flex: none; color: var(--color-muted-foreground); }
    .filters :global(.trigger .ui-label) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The view's name never yields its room; the project after it shortens first. */
    .filters .view-name { flex: none; overflow: visible; }
    /* Its menu reads as the sidebar's (ProjectViews.svelte): the scope at rest, a remote machine small and muted under its project. */
    .filters :global(.popover .item:not([data-value^='view:']) .label) { font-weight: 400; }
    .filters :global(.popover .item.checkable) { align-content: center; }
    .filters :global(.popover .item.checkable:has(> .hint)) { row-gap: 2px; }
    .filters :global(.popover .item .hint) { font-size: var(--text-xs); }
    .filters :global(.popover .item:has(> .hint)) { padding-block: 6px; }
    /* A grouped list's section label: the gap between the cards parts the bands, so no rule; the label sits 6 px over its own card. */
    .band { margin: 14px 16px 6px; padding: 0; color: var(--color-muted-foreground); font-size: 11px; font-weight: 500; line-height: 14px; }
    .band.first { margin-top: 2px; }
    /* Recent's row hairlines stop 16 px short of the card's end, as a grouped list's do. */
    .mobile-list.recent { --hairline-end: 16px; }
    .brand-icon { flex: none; border-radius: var(--radius-md); }
    .back { position: relative; flex: none; }
    .waiting-mark { position: absolute; top: 9px; right: 8px; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-live); box-shadow: 0 0 0 2px var(--color-background); }
    .home { flex: none; padding: 0; }
    /* The page's name, under the machine it reads. */
    .brand strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.4px; line-height: 1.15; }
    /* A finger-sized target without growing the header: the line reaches into the header's padding. */
    .connection { position: relative; z-index: 1; display: flex; gap: 5px; height: auto; min-height: var(--touch-target); min-width: var(--touch-target); max-width: 100%; margin: -14px 0 -12px; padding: 0; font-size: var(--text-xs); font-weight: 500; color: var(--color-muted-foreground); }
    .connection > span:not(.dot) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--color-muted-foreground); }
    .dot.ready { background: var(--color-success); }
    .identity { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; flex: 1; }
    .mobile-header > :global(.menu) { flex: none; }
    .mobile-list { display: block; position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; background: transparent; padding: 8px max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
    /* The bottom bar owns the home indicator's inset; the last row clears the New thread button over it. */
    .mobile-list.tabbed { padding-bottom: 96px; }
    /* Rows thin out at the screen's bottom edge, under the floating tab bar, as the sidebar's do, never cut flat. A mask,
       not a scroll-driven animation: tests and closing elements wait on every running animation. */
    .mobile-list { mask-image: linear-gradient(to top, transparent 0, black 24px); }
    /* Under the tab bar the gap the capsule floats over (MobileTabs' bottom margin) stays empty; rows thin out behind the capsule. */
    .mobile-list.tabbed { --bar-gap: max(8px, env(safe-area-inset-bottom)); mask-image: linear-gradient(to top, transparent 0 var(--bar-gap), black calc(var(--bar-gap) + 24px)); }
    /* One row: the title, the view pill beside it, the search and the display options at its end. */
    .title-row { display: flex; align-items: center; gap: 2px; min-height: var(--touch-target); margin: 0 -10px 8px 0; }
    .title-row .large-title { flex: none; min-width: 0; }
    .title-row > .icon { flex: none; width: var(--touch-target); height: var(--touch-target); margin-left: auto; color: var(--color-muted-foreground); }
    .title-row .display { border-left: 0; }
    /* The strip and each project's header stay at the top while the rows scroll under them. The strip sits in
       the cards' column, on their 16 px gutter with their radius, and 8 px above the first one: wider and
       rounded only at the bottom, it read as a ledge the cards hung from. */
    .lifecycle-slot { position: sticky; top: 0; z-index: 3; margin: 0 0 8px; padding: 4px 4px 2px; border-radius: var(--radius-lg); background: var(--color-float); -webkit-backdrop-filter: var(--float-blur); backdrop-filter: var(--float-blur); }
    .mobile-list:has(> .lifecycle-slot) { --sticky-top: 46px; }
    .more-row { display: flex; align-items: center; gap: 6px; width: 100%; min-height: var(--touch-target); padding: 0 14px; font-size: var(--text-sm); color: var(--color-muted-foreground); border-bottom: 1px solid var(--color-border); border-radius: 0; justify-content: flex-start; }
    .more-row.needs { color: var(--color-live); }
    /* The desktop fold's chip: how many threads at work hide in the fold ("14 more ↻2"). */
    .more-live { display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 7px 0 6px; border-radius: var(--radius-full); color: var(--color-accent); background: var(--color-accent-soft); font-weight: 600; font-variant-numeric: tabular-nums; }
    .more-row :global(.flip) { rotate: 180deg; }
    .large-title { margin: 0 2px; font-size: 20px; font-weight: 700; letter-spacing: -0.4px; line-height: 1.15; color: var(--color-foreground); }
    /* The bar's title waits under the large one, and fades in as it scrolls away. */
    .brand strong { transition: opacity var(--dur-2) var(--ease-out-quint), translate var(--dur-2) var(--ease-out-quint); }
    .brand strong.folded { opacity: 0; translate: 0 4px; }
    .lane { display: flex; align-items: center; gap: 8px; margin: 4px 2px 6px; font-size: var(--text-xs); font-weight: 600; color: var(--color-muted-foreground); }
    .lane.working { margin-top: 18px; }
    /* The home Inbox's counts: amber on a solid tint (seen through the glass it fell to 4.3:1), and work's grey, since it asks nothing. */
    .lane .count { padding: 0 7px; border-radius: var(--radius-full); line-height: 18px; font-variant-numeric: tabular-nums; background: color-mix(in oklch, var(--color-live-fill) 18%, var(--color-surface-2)); color: var(--color-live); }
    .lane .count.bots { display: inline-flex; align-items: center; gap: 3px; padding-left: 6px; }
    .lane.working .count { background: var(--color-control-surface); color: var(--color-muted-foreground); }
    .first-run-slot { display: flex; padding: 12px 0 24px; }
    .first-run-slot :global(.first-run) { width: 100%; }
    .list-heading { padding: 0 0 8px; }
    .contact-flow { padding-top: 4px; }
    p { font-size: var(--text-sm); }
    /* `clip`, not `hidden`: the heading stays stuck to the top of the list while its rows scroll under it. */
    .project-group { border: 0; border-radius: var(--radius-lg); background: var(--color-cell); box-shadow: var(--shadow-tile); margin-bottom: 14px; overflow: clip; }
    .project-heading { position: sticky; top: var(--sticky-top, 0px); z-index: 2; display: flex; align-items: center; min-height: 40px; box-sizing: border-box; padding: 0 12px; gap: 8px; background: var(--color-cell); color: var(--color-muted-foreground); border-bottom: 1px solid var(--color-border); }
    .project-heading h2 { margin: 0; flex: 1; min-width: 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
    /* A machine other than this PC follows the name on its line, as the Recent rows name it: "render-farm · ☰ Builder". */
    /* 8 px before the dot, as the Recent subline: the dot sits centred between the name and the glyph. */
    .project-heading h2 :global(.machine-suffix) { margin-left: 8px; vertical-align: -1px; }
    /* A whole touch target that eats the heading's padding rather than making it taller. */
    .project-heading .project-actions { flex: none; margin: -8px -8px -8px 0; color: var(--color-muted-foreground); }
    /* The count chips keep their 44 px targets but lend 2 px top and bottom, so the heading stays 40 px. */
    .project-heading :global(.counters) { margin-block: -3px; }
    /* A heading says one number, what needs the user; working, done and archived are the strip's filters and the project's menu. */
    .project-heading :global(.counter.extra:not(.active)) { display: none; }
    .empty-state { display: flex; align-items: center; flex-direction: column; text-align: center; padding: 44px 16px; }
    .empty-icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: var(--radius-xl); border: 1px solid var(--color-edge); background: var(--color-surface-2); color: var(--color-muted-foreground); margin-bottom: 18px; }
    .empty-state h2 { font-size: var(--text-base); font-weight: 600; margin: 0 0 8px; }
    .empty-state p { color: var(--color-muted-foreground); line-height: 1.6; max-width: 280px; margin: 0 0 20px; }
    .mobile-header { grid-row: 1; grid-column: 1; }
    /* The list runs under the tab bar, which floats over its last rows. */
    .mobile-list { grid-row: 2 / 4; grid-column: 1; position: relative; z-index: 1; min-height: 0; }
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
  }
</style>
