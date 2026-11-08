<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import WindowList from './WindowList.svelte';
  import FailMark from './FailMark.svelte';
  import { ChevronRight, Ellipsis, FolderPlus, FolderX, GripVertical, LoaderCircle, PanelRightClose, PanelRightOpen, UserPlus } from '@lucide/svelte';
  import type { Project, ThreadId, ThreadSummary } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import { fill, strings } from '../lib/strings';
  import { projectName } from '../lib/format';
  import { compareEntries } from '../lib/thread-order';
  import { rowPlaces } from '../lib/row-place';
  import { hostName } from '../lib/machine-host';
  import { projectRollup, threadState } from '../lib/thread-state';
  import { foldQuiet } from '../lib/card-fold';
  import { storeNeedsYou } from '../lib/activity-feed';
  import { needsYou, rowAsks } from '../lib/status-order';
  import { groupWorkingThread, recentPreferences } from '../lib/recent.svelte';
  import { dropKey as threadDropKey, takesDrop, threadDrag } from '../lib/thread-move.svelte';
  import { sidebarRows } from '../lib/sidebar-rows.svelte';
  import { projectMenu } from '../lib/project-menu';
  import { work } from '../lib/work-prefs.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectActivity, projectKey, projectView, type ProjectEntry } from '../lib/project-view.svelte';
  import { projectDrag, startProjectDrag } from '../lib/project-drag.svelte';
  import { activeProject, archiveCount, projectListMap, projectSections, projectThreadView, type ArchiveKind, type ProjectSection } from '../lib/project-threads.svelte';
  import ProjectViews from './ProjectViews.svelte';
  import SharedProjectThreads from './shared/SharedProjectThreadsLoader.svelte';
  import RecentGroup from './RecentGroup.svelte';
  import RecentDone from './RecentDone.svelte';
  import ProjectThreadCounters from './ProjectThreadCounters.svelte';
  import ProjectShelf from './ProjectShelf.svelte';
  import ProjectCardsSection from './ProjectCardsSection.svelte';
  import ThreadCard from './ThreadCard.svelte';
  import DraftRow from './DraftRow.svelte';
  import GroupLabel from './GroupLabel.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import RailFrame from './RailFrame.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { doneFilter } from '../lib/inbox.svelte';
  import { needsAnAI } from '../lib/first-run';
  import { listAbsent } from '../lib/list-absent';
  import { contactsRail, contactsShown } from '../lib/contacts-rail.svelte';
  import SideHead from './agents/SideHead.svelte';
  let { store }: { store: Store } = $props();
  const mobile = new MediaQuery('(max-width: 720px)');
  let scrollRoot = $state<HTMLDivElement>();
  let savedScroll = 0;
  const measuredRows = new Map<string, Map<string, number>>();
  function measurements(key: string): Map<string, number> {
    if (!measuredRows.has(key)) measuredRows.set(key, new Map());
    return measuredRows.get(key)!;
  }
  const showRows = $derived(mobile.current ? store.sidebarOpen : !store.sidebarCollapsed);
  /**
   * On a desktop the Contacts page turns the list to its Contacts side, the
   * Bots column's other side (agents/SideHead.svelte), whose head folds the
   * contacts column on the right edge. Its rows load with the page.
   */
  const contactsSide = $derived(!mobile.current && store.page === 'home' && contactsShown(store));
  let ContactRows = $state<typeof import('./home/ContactRows.svelte').default>();
  $effect(() => {
    if (!contactsSide || ContactRows) return;
    void import('./home/ContactRows.svelte').then(module => { ContactRows = module.default; }).catch(() => {});
  });
  const foldLabel = $derived(contactsRail.folded ? strings.contacts.rail.show : strings.contacts.rail.hide);
  $effect(() => { if (showRows && scrollRoot) void tick().then(() => { if (scrollRoot && showRows) scrollRoot.scrollTop = savedScroll; }); });
  /** The clock the rows' times read: a minute's precision is all they show. */
  const now = $derived(minuteClock.now);
  let machines = $derived(workspace.machinesOr(store));
  /** One machine says nothing about where a thread runs: its icon only shows once there are two. */
  let multi = $derived(machines.length > 1);
  /** The machine a card names (lib/machine-host.ts): another connected one once two are, an unreachable one always, with the word. */
  const host = (machine: Machine) => hostName(machine, machines, machines.find(entry => entry.store === workspace.primary)?.id);
  /** The display menu and the rail's machine button set it (machine-filter.svelte.ts). */
  let shownFilter = $derived(machineFilter.shown(machines));
  let visible = $derived(machines.filter((m) => shownFilter === null || m.id === shownFilter));
  let all = $derived(visible.flatMap((machine) => machine.store.projects.map((project) => ({ machine, project }))));
  /** An archived project leaves the list for the fold under it; its threads keep running. */
  let groups = $derived(projectView.sorted(all.filter(({ project }) => project.archived !== true)));
  /** At work on top when working grouping is on, open, then set aside; idle projects go to their fold. Each stays a card when its grouping is off. */
  let sections = $derived(projectSections(groups, recentPreferences.groupOtherProjects, recentPreferences.groupWorking));
  /** The cards in drawn order, the folded sections included: Alt+digit skips the rows a folded section hides. */
  let activeGroups = $derived([...sections.working, ...sections.open, ...sections.later]);
  /** The first card drawn, and the first open one: a prompt can lead either, the Working section sitting above the open cards. */
  const leaders = () => [activeGroups[0], sections.open[0]] as const;
  let previousLeaders: ({ key: string; activity: number } | undefined)[] = [];
  $effect(() => {
    const now = leaders().map(first => first && { entry: first, key: projectKey(first), activity: projectActivity(first) });
    const promoted = now.find((next, index) => {
      const before = previousLeaders[index];
      return next && before && next.key !== before.key && next.activity > before.activity;
    });
    previousLeaders = now.map(next => next && { key: next.key, activity: next.activity });
    // Follow a new prompt in the selected project; removing rows keeps the reading position. Leading the list, it brings
    // the list to its top; leading the open cards under a Working section, its card comes into view, wherever that is.
    if (promoted && workspace.view === 'projects' && projectView.order === 'recent'
      && untrack(() => promoted.entry.machine.store === workspace.active && promoted.entry.project.id === store.openProject?.id)) {
      const first = now[0]?.key === promoted.key;
      if (first) savedScroll = 0;
      void tick().then(() => {
        if (!scrollRoot || !leaders().some(leader => leader && projectKey(leader) === promoted.key)) return;
        if (first) scrollRoot.scrollTop = 0;
        else [...scrollRoot.querySelectorAll<HTMLElement>('section[data-testid=project]')].find(card => card.dataset['projectKey'] === promoted.key)?.scrollIntoView({ block: 'nearest' });
      });
    }
  });
  let shelved = $derived(all.filter(({ project }) => project.archived === true));
  let selected = $derived(projectView.selected(groups));
  let recentGroups = $derived(selected ? [selected] : groups);
  let recent = $derived(
    recentGroups
      .flatMap(({ machine, project }) =>
        machine.store
          .threadsOf(project.id)
          .map((thread) => ({ machine, project, thread }))
      )
      .sort(compareEntries)
  );
  /** Recent's second line: where each row lives, once the tiles alone may not tell them apart; this app's own machine goes unsaid. */
  const places = $derived(rowPlaces(recent, machines.find(machine => machine.store === workspace.primary)?.id));
  let workingOpen = $state(false);
  let doneRows = $state.raw<{ store: Store; threadId: ThreadId }[]>([]);
  let archivedRows = $state.raw<{ store: Store; threadId: ThreadId }[]>([]);
  /** Conversations drawn under idle projects whose history is unfolded, after the listed projects. */
  let idleRows = $state.raw<{ store: Store; threadId: ThreadId }[]>([]);
  let projectDoneRows = $state.raw<Record<string, { store: Store; threadId: ThreadId }[]>>({});
  const doneObservers = new Map<string, (rows: { store: Store; threadId: ThreadId }[]) => void>();
  function doneObserver(entry: ProjectEntry, kind: ArchiveKind) {
    const key = JSON.stringify([kind, projectKey(entry)]);
    if (!doneObservers.has(key)) doneObservers.set(key, rows => rememberDoneRows(key, rows));
    return doneObservers.get(key)!;
  }
  function rememberDoneRows(key: string, rows: { store: Store; threadId: ThreadId }[]) {
    const previous = projectDoneRows[key] ?? [];
    if (previous.length === rows.length && previous.every((row, index) => row.store === rows[index]?.store && row.threadId === rows[index]?.threadId)) return;
    projectDoneRows = { ...projectDoneRows, [key]: rows };
  }
  let working = $derived(recentPreferences.groupWorking ? recent.filter(({ machine, thread }) => groupWorkingThread(machine.store, thread)) : []);
  let attention = $derived(recentPreferences.groupWorking ? recent.filter(({ machine, thread }) => !groupWorkingThread(machine.store, thread)) : recent);
  /**
   * Recent puts the threads with something to say (the user's turn, a failure, work, news) and the pinned ones above a
   * hairline, the ones that only show a time under it; each part keeps the list's order, and Alt+digit counts them as drawn.
   */
  let split = $derived.by(() => {
    const active: typeof attention = [], older: typeof attention = [];
    for (const entry of attention) (entry.thread.pinned || threadState(entry.thread, rowAsks(entry.machine.store, entry.thread.id)) !== null ? active : older).push(entry);
    return { active, older };
  });
  const listsFor = projectListMap();
  /** The cards whose quiet threads the user unfolded, by project key, for this session. */
  let unfolded = $state<Record<string, true>>({});
  /** A card's rows as drawn: what has something to say, then its quiet threads, folded on a big card until asked for. */
  function cardRows(entry: ProjectEntry, attention: ThreadSummary[]): { shown: ThreadSummary[]; folded: ThreadSummary[] } {
    const owner = entry.machine.store;
    if (unfolded[projectKey(entry)]) return { shown: attention, folded: [] };
    return foldQuiet(attention, thread => thread.pinned === true || threadState(thread, rowAsks(owner, thread.id)) !== null
      || (owner === workspace.active && owner.openThread?.id === thread.id));
  }
  /** Each listed project's sorted rows, shared by its section and by Alt+digit. */
  let projectLists = $derived(listsFor(activeGroups));
  /** The rows of the listed projects in drawn order, read only as far as the ninth: projects below it cost nothing. */
  function projectRows(): { store: Store; threadId: ThreadId }[] {
    const rows: { store: Store; threadId: ThreadId }[] = [];
    for (const entry of activeGroups) {
      if (rows.length >= 9) break;
      if (entry.machine.store.isCollapsed(entry.project.id)) continue;
      const later = sections.later.includes(entry);
      if (later ? !projectThreadView.laterOpen : sections.working.includes(entry) && !projectThreadView.workingOpen) continue;
      const open = projectThreadView.isOpen(entry, 'working');
      const { lists } = projectLists.get(projectKey(entry))!;
      const { shown } = cardRows(entry, lists.attention);
      for (const thread of open ? [...shown, ...lists.working] : shown) rows.push({ store: entry.machine.store, threadId: thread.id });
      for (const kind of ['done', 'archived'] as const) if (kind === 'done' ? doneFilter.shown : later || projectThreadView.isOpen(entry, kind)) rows.push(...projectDoneRows[JSON.stringify([kind, projectKey(entry)])] ?? []);
    }
    return rows;
  }
  // Alt+1 to Alt+9 count the rows as drawn: this view, open projects, then unfolded idle history.
  $effect(() => {
    sidebarRows.list = (workspace.view === 'recent'
      ? [...split.active, ...split.older].map(({ machine, thread }) => ({ store: machine.store, threadId: thread.id })).concat(doneRows, (workingOpen ? working : []).map(({ machine, thread }) => ({ store: machine.store, threadId: thread.id })), archivedRows)
      : projectRows().concat(idleRows)
    ).slice(0, 9);
  });
  /** The threads of a project that wait on the user, its header's amber count; a sub-agent's question counts for its parent. */
  function waitingCount(entry: ProjectEntry): number {
    const owner = entry.machine.store;
    // Activity's own count over the project's threads: the card and the rail's badge never disagree.
    return storeNeedsYou(owner, owner.threadsOf(entry.project.id));
  }
  const canAddProject = $derived(store.owner && work.shows('sidebar.add-project'));
  /** Nothing listed yet: the list says why, and where the projects come from. */
  const loading = $derived(groups.length === 0 && visible.some(machine => machine.store.connection !== 'ready'));
  /**
   * `list` is the section the card sits in: a project moves among its neighbours there, as the sections place it themselves.
   * The menu also shows or hides the card's archived threads; a set-aside card's body is them already, so there it folds the card.
   */
  function openProjectMenu(event: MouseEvent, machine: Machine, project: Project, list: ProjectEntry[], section: ProjectSection) {
    const entry = { machine, project };
    const key = projectKey(entry);
    const collapsed = machine.store.isCollapsed(project.id);
    projectMenu(event, machine.store, project, projectView.order === 'manual' ? {
      up: list[0] !== undefined && projectKey(list[0]) !== key,
      down: list.at(-1) !== undefined && projectKey(list.at(-1)!) !== key,
      move: direction => projectView.step(list, key, direction)
    } : undefined, undefined, section === 'later' ? {
      count: archiveCount(project, 'archived'), open: !collapsed, toggle: () => machine.store.toggleProject(project.id)
    } : {
      count: archiveCount(project, 'archived'),
      open: !collapsed && projectThreadView.isOpen(entry, 'archived'),
      toggle: () => projectThreadView.toggle(entry, 'archived', collapsed)
    });
  }
  /** A project header dragged to a new place among the cards of its section, in the manual order; idle projects sit in their fold as rows. */
  function dragProject(event: PointerEvent, entry: ProjectEntry, list: ProjectEntry[]) {
    const key = projectKey(entry);
    startProjectDrag(event, {
      key,
      look: { name: projectName(entry.project), project: entry.project, store: entry.machine.store },
      order: () => list.map(projectKey),
      drop: (target, after) => projectView.move(list, key, target, after),
    });
  }
</script>

<RailFrame {store} kind="sidebar" label={strings.sidebar.threads} testid="sidebar" drawer absent={listAbsent(workspace.machinesOr(store).map(machine => machine.store), mobile.current)} bind:scroller={scrollRoot} onscroll={() => { if (showRows && scrollRoot) savedScroll = scrollRoot.scrollTop; }}>
  {#snippet head()}
    {#if contactsSide}
      <SideHead {store} current="home">
        {#snippet actions()}
          <button type="button" class="ghost icon small" title={strings.contacts.add} aria-label={strings.contacts.add} data-testid="side-contacts-add" onclick={() => store.showHome()}><UserPlus size={16} /></button>
          <button type="button" class="ghost icon small" title={foldLabel} aria-label={foldLabel} aria-expanded={!contactsRail.folded} data-testid="contacts-toggle" onclick={() => contactsRail.toggle()}>
            {#if contactsRail.folded}<PanelRightOpen size={16} />{:else}<PanelRightClose size={16} />{/if}
          </button>
        {/snippet}
      </SideHead>
    {:else}
      <ProjectViews entries={groups} {store} quiet={groups.length === 0 && needsAnAI(store) && !loading} />
    {/if}
  {/snippet}
    {#if contactsSide}
      {#if ContactRows}<div class="contact-rows" data-testid="side-contact-rows"><ContactRows {store} /></div>{/if}
    {:else if showRows}
    {#if groups.length === 0 && !(needsAnAI(store) && !loading)}
      <div class="empty" data-testid="sidebar-empty" role={loading ? 'status' : undefined}>
        {#if loading}<LoaderCircle size={16} class="spinner" aria-hidden="true" /><span class="ui-label">{strings.sidebar.loadingProjects}</span>
        {:else}
          <span class="ui-label">{strings.sidebar.noProjects}</span>
          {#if canAddProject}<button type="button" class="ghost small add" data-testid="add-project" onclick={() => { store.projectPickerOpen = true; }}><FolderPlus size={14} /><span class="ui-label">{strings.sidebar.addProject}</span></button>{/if}
        {/if}
      </div>
    {/if}
    {#if workspace.view === 'recent'}
      {#each visible as machine (machine.id)}
        {#each machine.store.draftEntries.filter(entry => !selected || (selected.machine.id === machine.id && selected.project.id === entry.projectId)) as entry (entry.id)}
          <DraftRow owner={machine.store} {entry} />
        {/each}
      {/each}
      <WindowList items={split.active} keyOf={entry => JSON.stringify([entry.machine.id, entry.thread.id])} {scrollRoot} estimate={32} measurements={measurements('recent')}>
        {#snippet row(entry)}<ThreadCard {...entry} {now} compact showDone where={places(entry)} />{/snippet}
      </WindowList>
      {#if split.active.length > 0 && split.older.length > 0}<div class="rest-line" role="separator"></div>{/if}
      <WindowList items={split.older} keyOf={entry => JSON.stringify([entry.machine.id, entry.thread.id])} {scrollRoot} estimate={32} measurements={measurements('recent-rest')}>
        {#snippet row(entry)}<ThreadCard {...entry} {now} compact showDone where={places(entry)} />{/snippet}
      </WindowList>
      <!-- Done is the display menu's filter: on, the finished threads follow the live ones. -->
      {#if doneFilter.shown}
        <div class="recent-done" data-testid="recent-done-rows">
          <RecentDone entries={recentGroups} {scrollRoot} {now} open header={false} onrows={rows => doneRows = rows} />
        </div>
      {/if}
      {#if groups.length > 0 && recent.length === 0 && !recentGroups.some(entry => entry.project.archivedThreads)}<p class="none">
          {strings.sidebar.noThreads}
        </p>{/if}
      <div class="recent-folds">
        {#if working.length > 0}
          <RecentGroup kind="working" count={working.length} bind:open={workingOpen}>
            <WindowList items={working} keyOf={entry => JSON.stringify([entry.machine.id, entry.thread.id])} {scrollRoot} estimate={32} measurements={measurements('recent-working')}>
              {#snippet row(entry)}<ThreadCard {...entry} {now} compact showDone where={places(entry)} />{/snippet}
            </WindowList>
          </RecentGroup>
        {/if}
        <RecentDone kind="archived" entries={recentGroups} {scrollRoot} {now} onrows={rows => archivedRows = rows} />
      </div>
    {:else}
      {#each visible as machine (machine.id)}
        {#each machine.store.draftEntries.filter(entry => entry.projectId === null) as entry (entry.id)}
          <DraftRow owner={machine.store} {entry} />
        {/each}
      {/each}
      {#snippet card(entry: ProjectEntry, list: ProjectEntry[], section: ProjectSection)}
        {@const { machine, project } = entry}
        {@const owner = machine.store}
        {@const workingOpen = projectThreadView.isOpen(entry, 'working')}
        {@const later = section === 'later'}
        {@const doneOpen = archiveCount(project, 'done') > 0 && doneFilter.shown}
        {@const archivedOpen = archiveCount(project, 'archived') > 0 && (later || projectThreadView.isOpen(entry, 'archived'))}
        {@const { lists } = projectLists.get(projectKey(entry))!}
        {@const fold = cardRows(entry, lists.attention)}
        {@const controls = `sidebar-project-${encodeURIComponent(projectKey(entry))}`}
        {@const collapsed = owner.isCollapsed(project.id)}
        {@const away = owner.connection !== 'ready'}
        {@const rollup = collapsed && !away ? projectRollup(owner.threadsOf(project.id), thread => rowAsks(owner, thread.id)) : null}
        {@const draftsHere = owner.draftEntries.filter(entry => entry.projectId === project.id)}
        {@const dropKey = threadDropKey(machine.id, project.id)}
        {@const key = projectKey(entry)}
        <section
          class="project"
          class:inactive={!activeProject(entry)}
          class:drop={threadDrag.over === dropKey}
          class:candidate={takesDrop(threadDrag.current, machine.id, project.id)}
          class:lifted={projectDrag.current === key}
          class:insert-before={projectDrag.over === key && !projectDrag.after}
          class:insert-after={projectDrag.over === key && projectDrag.after}
          data-testid="project"
          data-thread-drop
          data-project-id={project.id}
          data-machine-id={machine.id}
          data-project-key={key}
          data-project-name={projectName(project)}
          aria-label={threadDrag.over === dropKey ? fill(strings.threadMove.dropHere, { project: projectName(project) }) : undefined}
        >
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="head" oncontextmenu={(e) => openProjectMenu(e, machine, project, list, section)}>
            <button
              class="ghost toggle"
              class:grab={projectView.order === 'manual'}
              data-testid="project-row"
              data-project-id={project.id}
              onpointerdown={(event) => dragProject(event, entry, list)}
              ondragstart={(event) => event.preventDefault()}
              aria-expanded={!collapsed}
              title={multi ? `${project.path} · ${machine.label}` : project.path}
              onclick={() => projectThreadView.toggleProject(entry, lists, draftsHere.length)}
            >
              {#if projectView.order === 'manual'}<GripVertical size={12} />{/if}<span class="mark"><ProjectTile {project} store={owner} size={18} /><span class="fold-caret" class:open={!collapsed} aria-hidden="true"><ChevronRight size={16} /></span></span
              ><span class="name project-title ui-label" class:gone={project.missing === true}>{projectName(project)}</span
              >{#if host(machine)}{@const name = host(machine)!}<span class="host" data-testid="project-host" class:offline={name.away} title={name.text}>{name.text}</span>{/if}{#if project.missing === true}<span class="missing" data-testid="project-missing" title={strings.sidebar.projectMissing} aria-label={strings.sidebar.projectMissing}><FolderX size={13} aria-hidden="true" /></span>{/if}{#if rollup && !needsYou(rollup.kind) && rollup.kind !== 'done' && lists.working.length === 0}{@const label = fill(rollup.count === 1 ? strings.sidebar.rollupOne : strings.sidebar.rollupMany, { count: String(rollup.count), state: strings.sidebar.state[rollup.kind] })}<span
                  class="rollup {rollup.kind}" data-testid="project-rollup" data-state={rollup.kind} title={label} aria-label={label}
                  >{#if rollup.kind === 'interrupted'}<FailMark size={10} />{:else}<span class="work-ring" aria-hidden="true"></span>{/if}{#if rollup.count > 1}<span class="ui-label">{rollup.count}</span>{/if}</span
                >{/if}
            </button>
            <ProjectThreadCounters {entry} working={lists.working.length} waiting={away ? 0 : waitingCount(entry)} {controls} {collapsed} {away} />
            <button
              class="ghost small icon project-actions"
              data-testid="project-menu"
              title={strings.sidebar.projectMenu}
              aria-label={strings.sidebar.projectMenu}
              onclick={(e) => openProjectMenu(e, machine, project, list, section)}><Ellipsis size={15} /></button
            >
          </div>
          <div class="disclosure-fold" class:open={!collapsed} inert={collapsed}>
            <div>
              <SharedProjectThreads store={owner} projectId={project.id} active={!collapsed && !away}>
              {#each draftsHere as draft (draft.id)}<DraftRow {owner} entry={draft} />{/each}
              <WindowList items={fold.shown} keyOf={thread => JSON.stringify([machine.id, thread.id])} {scrollRoot} active={!collapsed} estimate={34} measurements={measurements(JSON.stringify([machine.id, project.id]))}>
                {#snippet row(thread)}<ThreadCard {machine} {project} {thread} {now} showDone />{/snippet}
              </WindowList>
              {#if fold.folded.length}
                <!-- The quiet threads of a big card, one line: a press shows them in place, in the list's order. -->
                <button type="button" class="ghost more-threads" data-testid="project-more" onclick={() => { unfolded = { ...unfolded, [key]: true }; }}>
                  <span class="ui-label">{fill(strings.sidebar.moreThreads, { count: String(fold.folded.length) })}</span>
                </button>
              {/if}
              <ProjectThreadCounters {entry} working={lists.working.length} waiting={away ? 0 : waitingCount(entry)} {controls} {collapsed} {away} place="fold" />
              <div id="{controls}-working" hidden={!workingOpen || lists.working.length === 0} data-testid="project-working">
                {#if workingOpen && lists.working.length > 0}
                  <WindowList items={lists.working} keyOf={thread => JSON.stringify([machine.id, thread.id])} {scrollRoot} active={!collapsed} estimate={34} measurements={measurements(JSON.stringify([machine.id, project.id, 'working']))}>
                    {#snippet row(thread)}<ThreadCard {machine} {project} {thread} {now} showDone />{/snippet}
                  </WindowList>
                {/if}
              </div>
              <div id="{controls}-done" hidden={!doneOpen} data-testid="project-done">
                {#if doneOpen}<GroupLabel kind="done" count={archiveCount(project, 'done')} />{/if}
                <RecentDone entries={[entry]} {scrollRoot} {now} open={doneOpen && !collapsed} header={false}
                  onrows={doneObserver(entry, 'done')} />
              </div>
              <div id="{controls}-archived" hidden={!archivedOpen} data-testid="project-archived">
                {#if archivedOpen && !later}<GroupLabel kind="archived" count={archiveCount(project, 'archived')} />{/if}
                <RecentDone kind="archived" entries={[entry]} {scrollRoot} {now} open={archivedOpen && !collapsed && (!later || projectThreadView.laterOpen)} header={false}
                  onrows={doneObserver(entry, 'archived')} />
              </div>
              {#if lists.attention.length === 0 && lists.working.length === 0 && !project.archivedThreads && draftsHere.length === 0}<p class="none">{strings.sidebar.noThreads}</p>{/if}
              </SharedProjectThreads>
            </div>
          </div>
        </section>
      {/snippet}
      <!-- Idle projects sit as compact rows in their fold below, so Alt+digit and reordering count only the cards. -->
      {#if sections.working.length > 0}
        <ProjectCardsSection kind="working" count={sections.working.length}>
          {#each sections.working as entry (projectKey(entry))}{@render card(entry, sections.working, 'working')}{/each}
        </ProjectCardsSection>
      {/if}
      {#each sections.open as entry (projectKey(entry))}{@render card(entry, sections.open, 'open')}{/each}
      {#if groups.length > 0 && sections.working.length + sections.open.length === 0}<p class="none">{strings.sidebar.noActiveProjects}</p>{/if}
      <div class="project-folds">
        {#if sections.later.length > 0}
          <ProjectCardsSection kind="later" count={sections.later.length}>
            {#each sections.later as entry (projectKey(entry))}{@render card(entry, sections.later, 'later')}{/each}
          </ProjectCardsSection>
        {/if}
        <ProjectShelf projects={sections.idle} {multi} {now} {scrollRoot} onrows={rows => idleRows = rows} />
        <ProjectShelf kind="archived" projects={shelved} {multi} {now} {scrollRoot} />
      </div>
    {/if}
    {/if}
</RailFrame>

<style>
  /* `sidebar` is the container RailFrame.svelte declares on the column. */
  .recent-folds { margin-top: auto; padding-top: 12px; }
  .contact-rows { display: flex; flex-direction: column; gap: 2px; }
  .recent-done { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
  .project-folds { margin-top: auto; }
  /* A card is a quiet surface on the inset panel, with no edge of its own: the panel is the one frame. */
  .project {
    margin-bottom: 8px;
    padding: 4px;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  /* Recent's line between the threads with something to say and the ones at rest. */
  .rest-line { height: 1px; margin: 8px 10px; background: var(--color-border); }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 28px 12px;
    color: var(--color-subtle);
    font-size: var(--text-sm);
    text-align: center;
  }
  .empty .add { gap: 6px; color: var(--color-muted-foreground); }
  .empty .add:hover { color: var(--color-foreground); }
  .empty :global(.spinner) { color: var(--color-accent); animation: spin 1s steps(60) infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .empty :global(.spinner) { animation: none; } }
  .project {
    transition:
      outline-color var(--dur-2) var(--ease-out-quint),
      background var(--dur-2) var(--ease-out-quint),
      box-shadow var(--dur-2) var(--ease-out-quint),
      opacity var(--dur-2) var(--ease-out-quint);
  }
  /* While a thread row travels, every project it can land on shows a dashed edge; the others step back. */
  :global(html.thread-dragging) .project:not(.candidate) {
    opacity: 0.6;
  }
  .project.candidate {
    outline: 1px dashed var(--color-edge);
    outline-offset: -1px;
  }
  /* The one under the mouse takes the row: a solid edge and the selection fill. */
  .project.drop {
    outline: 1px solid var(--color-muted-foreground);
    background: var(--color-active);
  }
  /* A project on the move leaves a faded slot; a line between two sections says where it lands. */
  .project { position: relative; }
  .project.lifted { opacity: 0.4; }
  .project.insert-before::before,
  .project.insert-after::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--color-foreground);
    pointer-events: none;
    animation: insert-in var(--dur-2) var(--ease-out-quint);
  }
  /* Centred in the gap between two cards. */
  .project.insert-before::before { top: -7px; }
  .project.insert-after::after { bottom: -7px; }
  @keyframes insert-in { from { opacity: 0; transform: scaleX(0.6); } }
  /* In the manual order the header is a handle: a grab hand, and no phone callout on the long press that lifts it. */
  .toggle.grab { cursor: grab; -webkit-touch-callout: none; user-select: none; }
  :global(html.project-dragging),
  :global(html.project-dragging *) {
    cursor: grabbing !important;
    user-select: none;
  }
  .head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 34px;
  }
  .toggle {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 4px;
    justify-content: flex-start;
    gap: 8px;
  }
  .toggle:hover:not(:disabled) { background: transparent; }
  /* The rows' ring, inside the header: the list's scroll edge would clip one outside it. */
  .toggle:focus-visible { outline-offset: -2px; }
  .toggle:active:not(:disabled) { transform: none; }
  /* The card's title, the user's folder name: it takes what is left after the
     machine and the counters, which stay whole, and ends in an ellipsis. */
  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    white-space: nowrap;
    font-size: 13.5px;
    font-weight: 620;
    letter-spacing: -0.01em;
    color: var(--color-foreground);
  }
  /* Its folder left the disk: the name steps back and a mark says why. */
  .name.gone { color: var(--color-muted-foreground); }
  .missing { display: flex; flex: none; color: var(--color-danger); }
  /* A folded project still says what its threads do when its one count (ProjectThreadCounters: Needs you, else
     working) says nothing: the most urgent other state, its mark and count. News marks nothing. */
  .rollup {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .rollup { color: var(--color-muted-foreground); }
  /* The rows' marks: a grey ring for work (dotted in the queue), the failure's "!" for work that stopped short. */
  .rollup .work-ring { box-sizing: border-box; width: 8px; height: 8px; border: 1.5px dashed var(--color-accent); border-radius: var(--radius-full); }
  .rollup.queued .work-ring { border-style: dotted; border-color: var(--color-muted-foreground); }
  /* The project's mark and its fold chevron share one slot: the mark gives way
     to the chevron while a pointer or the keyboard is on the header. */
  .mark {
    display: grid;
    flex: none;
    place-items: center;
  }
  .mark > :global(*) {
    grid-area: 1 / 1;
    transition:
      opacity var(--dur-2) var(--ease-out-quint),
      transform var(--dur-2) var(--ease-out-quint);
  }
  .mark .fold-caret {
    opacity: 0;
    color: var(--color-muted-foreground);
  }
  @media (hover: hover) {
    .head:hover .mark > :global([data-testid='project-tile']) { opacity: 0; }
    .head:hover .mark .fold-caret { opacity: 1; }
  }
  .toggle:focus-visible .mark > :global([data-testid='project-tile']) { opacity: 0; }
  .toggle:focus-visible .mark .fold-caret { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .mark > :global(*) { transition: none; }
  }
  /* The machine, after the name in quiet ink. A machine label is short and
     says where the work runs, so it stays whole: the project name gives way. */
  .host {
    flex: none;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--color-subtle);
  }
  /* The rows under it carry no machine icon, so the header says the machine is unreachable in words ("Builder
     offline"), a step brighter than a plain machine name; its rows read dimmed (ThreadCard.svelte). */
  .host.offline { color: var(--color-muted-foreground); }
  .head :global(.counters) { margin-right: 2px; transition: margin-right var(--dur-2) var(--ease-out-quint); }
  /* The menu appears at the right end on hover and the counters step left of it, as a row's state does. */
  .project-actions {
    position: absolute;
    right: 2px;
    top: 4px;
    opacity: 0;
  }
  .head:hover .project-actions,
  .head:focus-within .project-actions {
    opacity: 1;
  }
  .head:hover :global(.counters),
  .head:focus-within :global(.counters) {
    margin-right: 28px;
  }
  /* The folded quiet threads' one line: a row's height, the subtle ink of what is not news, on the titles' edge. */
  .more-threads {
    display: flex;
    width: 100%;
    height: auto;
    min-height: 30px;
    padding: 0 10px;
    justify-content: flex-start;
    border-radius: var(--radius-md);
    color: var(--color-subtle);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .more-threads:hover:not(:disabled) { color: var(--color-muted-foreground); }
  .none {
    padding: 4px 10px;
    color: var(--color-subtle);
    font-size: var(--text-sm);
  }
  @keyframes leave {
    to {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  @media (max-width: 720px) {
    .project-actions {
      opacity: 1;
    }
    .head :global(.counters) { margin-right: 28px; }
  }
</style>
