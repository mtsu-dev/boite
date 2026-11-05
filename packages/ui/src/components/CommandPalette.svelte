<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Bot, CornerDownLeft, Network, Search } from '@lucide/svelte';
  import type { Project, ProjectId, ThreadSummary } from '@boite/contracts';
  import { Closing } from '../lib/closing.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { appCommands, runCommand } from '../lib/commands.svelte';
  import { focusComposer, focusedElement, restoreFocus } from '../lib/focus';
  import { projectName } from '../lib/format';
  import { lastLine } from '../lib/last-line';
  import { PALETTE_LIMIT, RECENT_SECTION, RECENT_THREADS, asRecents, bandBreaks, rankItems, sectionRows, type PaletteItem } from '../lib/palette';
  import { namesMachine } from '../lib/row-machine';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { desktopSettings } from '../lib/settings-tabs';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import StateRing from './StateRing.svelte';
  import ThreadPicture from './ThreadPicture.svelte';
  import ThreadState from './ThreadState.svelte';
  import { asksMidTurn, threadState } from '../lib/thread-state';
  import { storeOrder, threadLiveKind, waitingSince } from '../lib/inbox';
  import { compareThreads, type OrderKey } from '../lib/thread-order';
  import { onBotsPage } from '../lib/experiments.svelte';

  let { store }: { store: Store } = $props();

  const overlay = new Closing();
  let query = $state('');
  let selected = $state(0);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLDivElement | undefined>(undefined);
  let dialog = $state<HTMLDivElement | undefined>(undefined);
  /** The field names its list and its active row by these: one set per palette, so two never share an id. */
  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionIds = new Map<string, string>();
  /** A row's DOM id, the same for one item while the palette lives, whatever the query puts around it. */
  function optionId(item: PaletteItem): string {
    let id = optionIds.get(item.id);
    if (!id) optionIds.set(item.id, id = `${uid}-option-${optionIds.size}`);
    return id;
  }
  const activeId = $derived.by(() => { const row = rows[selected]; return row ? optionId(row) : undefined; });
  /** What had the keyboard before the palette took it, where it goes back on close. */
  let previous: HTMLElement | null = null;

  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  const phoneWidth = new MediaQuery('(max-width: 720px)');
  const now = $derived(minuteClock.now);

  $effect(() => {
    if (!store.paletteOpen) {
      overlay.hide();
      // Shut from outside (the Ctrl+K chord again): the focus would die with the input.
      untrack(() => {
        const active = document.activeElement;
        if (active === document.body || (active && dialog?.contains(active))) restoreFocus(previous);
        previous = null;
      });
      return;
    }
    untrack(() => (previous = focusedElement()));
    query = '';
    selected = 0;
    overlay.show();
    void tick().then(() => input?.focus({ preventScroll: true }));
  });

  /** What a row or a heading draws beside its words: the thread, its project, its machine. */
  interface Place {
    machine: Machine;
    project: Project | null;
    thread: ThreadSummary | null;
    /** A bot's own threads: they live on the Bots page, so they gather under its name, never a project's. */
    bots?: true;
    /** A subagent's title: its row names the thread it works for, as the sidebar keeps it behind that row's chip. */
    parent?: string;
  }

  let machines = $derived(workspace.machinesOr(store));
  /** One machine names no machine: a query may then land on its name, but a row draws one only by `named`. */
  let several = $derived(workspace.machines.length > 1);

  /** A row and a heading name their machine as the Recent rows do (`namesMachine`): never this PC unless it stopped answering. */
  function named(machine: Machine): boolean {
    return several && namesMachine(machine, machine.store.connection !== 'ready');
  }

  /**
   * What a recent says after its project when it needs the user, in the words
   * of a Recent row's subline: Failed or Interrupted, and Needs you for one
   * that asks, which the sidebar says with its band heading and the palette has none.
   */
  function needsWord(place: Place): string | null {
    const owner = place.machine.store;
    if (!place.thread || owner.connection !== 'ready') return null;
    const kind = threadState(place.thread, owner.subagents(place.thread.id));
    if (kind === 'error') return strings.sidebar.state.error;
    if (kind === 'interrupted') return strings.sidebar.state.interrupted;
    return threadLiveKind(place.thread, kind) === 'needs' ? strings.sidebar.state.waiting : null;
  }

  /** Nothing live on it and not pinned, Recent's Earlier band: its provider's mark takes the muted tier, as on its Recent row (`ThreadHeadline`). */
  function quiet(thread: ThreadSummary, owner: Store): boolean {
    return !thread.pinned && threadLiveKind(thread, threadState(thread, owner.subagents(thread.id))) === null;
  }

  /**
   * Every live thread, most recent first; the list cuts it to the recents until
   * something is typed. The recents read in the Recent sidebar's order (pinned,
   * needs you, working, then the rest), so a thread waiting on the user is never
   * pushed out by a newer idle one. A subagent lives behind its parent's chip in
   * the sidebar, so the recents leave it out and only a query finds it, named by
   * its parent.
   */
  let threadData = $derived.by(() => {
    const entries: { item: PaletteItem; at: number; child: boolean; thread: ThreadSummary; key: OrderKey }[] = [];
    const places = new Map<string, Place>();
    for (const machine of machines) {
      for (const thread of machine.store.threads) {
        if (thread.archived || thread.incognito) continue;
        const project = machine.store.projects.find(p => p.id === thread.projectId) ?? null;
        const id = `thread:${machine.store.threadKey(thread.id)}`;
        const bot = onBotsPage(thread);
        const section = bot ? `bots:${machine.id}` : `in:${machine.id}:${thread.projectId}`;
        const parent = thread.parentThreadId ? machine.store.threads.find(t => t.id === thread.parentThreadId)?.title ?? '' : undefined;
        places.set(id, { machine, project, thread, ...(bot ? { bots: true as const } : {}), ...(parent === undefined ? {} : { parent }) });
        if (!places.has(section)) places.set(section, bot ? { machine, project: null, thread: null, bots: true } : { machine, project, thread: null });
        const key = storeOrder(machine.store, thread);
        entries.push({ at: thread.lastUserMessageAt ?? thread.createdAt, child: parent !== undefined, thread, key, item: {
          id,
          kind: 'thread',
          label: thread.title,
          // What a query may also land on: the parent, the project and the machine; only the parent is drawn.
          hint: [parent ?? '', project ? projectName(project) : '', several ? machine.label : ''].filter(Boolean).join(' '),
          keywords: thread.status,
          section,
          // Its band in the Recent sidebar, read from the same key its order is: the recents rule where it changes.
          band: thread.pinned ? 'pinned' : key.live ?? 'earlier'
        } });
      }
    }
    const sorted = entries.sort((a, b) => b.at - a.at);
    const recents = sorted.filter(entry => !entry.child).sort((a, b) => compareThreads(a.thread, b.thread, a.key, b.key));
    return { items: sorted.map(entry => entry.item), recents: recents.map(entry => entry.item), places };
  });

  /** Every project, a new thread in it once picked: offered only to a query, nothing typed keeps the list short. */
  let projectData = $derived.by(() => {
    const items: PaletteItem[] = [];
    const places = new Map<string, Place>();
    for (const machine of machines) {
      for (const project of machine.store.projects) {
        if (project.archived) continue;
        const id = `project:${JSON.stringify([machine.id, project.id])}`;
        places.set(id, { machine, project, thread: null });
        items.push({ id, kind: 'project', label: projectName(project), hint: [several ? machine.label : '', project.path].filter(Boolean).join(' '), keywords: strings.palette.newThreadWords });
      }
    }
    return { items, places };
  });

  let commandItems = $derived.by((): PaletteItem[] => appCommands(store, !desktopSettings(phoneWidth.current)));

  const snapshot = { rows: [] as PaletteItem[] };
  /** The ranked rows, a project's threads, the projects and the commands mixed until `sections` cuts them. */
  let ranked = $derived.by((): PaletteItem[] => {
    // Keep the exit animation's rows without subscribing a closed search to live updates.
    if (!store.paletteOpen) return snapshot.rows;
    const typed = query.trim().length > 0;
    // Nothing typed: the recents under one heading, in Recent's order; a query brings the project headings back.
    const threads = typed ? threadData.items : asRecents(threadData.recents.slice(0, RECENT_THREADS));
    const projects = typed ? projectData.items : [];
    return snapshot.rows = rankItems(query, [...threads, ...projects, ...commandItems], PALETTE_LIMIT);
  });
  let sections = $derived(sectionRows(ranked));
  /** The recents that open a band after the first: the sidebar's rule goes over them. A query's rows are ranked, not banded. */
  let breaks = $derived(query.trim() ? new Set<string>() : bandBreaks(ranked));
  /** The rows in the order they are drawn: what the arrows walk. */
  let rows = $derived(sections.flatMap(section => section.items));

  // The walk starts over on what the user typed, never on the list being
  // rebuilt: the core pushes a `thread.updated` a second per live agent, and
  // the selection cannot jump back to the top under his fingers.
  $effect(() => {
    void query;
    untrack(() => {
      selected = 0;
      if (list) list.scrollTop = 0;
    });
  });

  /** A shorter list keeps the keyboard on a row that is still there. */
  $effect(() => {
    const count = rows.length;
    untrack(() => {
      if (selected >= count) selected = Math.max(0, count - 1);
    });
  });

  /** Rows under the list's visible end, which the foot counts; 0 once the list ends there. */
  let below = $state(0);

  /** Counts the rows that do not show whole under the scrolled list. */
  function countBelow() {
    const target = list;
    if (!target) { below = 0; return; }
    const end = target.scrollTop + target.clientHeight - padOf(target) + 1;
    below = [...target.querySelectorAll<HTMLElement>('[data-testid=palette-row]')].filter(row => row.offsetTop + row.offsetHeight > end).length;
  }

  /** The list's padding, kept under its last whole row and over a revealed one. */
  function padOf(target: HTMLElement): number {
    return parseFloat(getComputedStyle(target).paddingBottom) || 0;
  }

  /**
   * An overflowing list stops under the last row that fits whole, plus its
   * padding, so the foot's rule never crosses a row. A heading always sits
   * above its first row, so a list cut there ends on the row before the
   * heading, never on the heading alone. The strip's whole-tiles rule, on rows.
   */
  function fit() {
    const target = list;
    if (!target) return;
    target.style.maxHeight = '';
    const room = target.clientHeight;
    if (target.scrollHeight <= room + 1) { below = 0; return; }
    const pad = padOf(target);
    // Layout values, measured from the list (it is positioned): the opening scale does not skew them.
    const bottoms = [...target.querySelectorAll<HTMLElement>('[data-testid=palette-row]')].map(row => row.offsetTop + row.offsetHeight);
    const whole = bottoms.filter(bottom => bottom + pad <= room).at(-1) ?? bottoms[0];
    if (whole !== undefined) target.style.maxHeight = `${whole + pad}px`;
    countBelow();
  }

  // The room depends on the window and the rows on the query: either changes where the last whole row ends.
  $effect(() => {
    void rows;
    const target = list;
    if (!target) return;
    void tick().then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  /** The row the arrows reached, whole in the list with the padding around it; a section's first row brings its heading. */
  function reveal(index: number) {
    const target = list;
    const row = target?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!target || !row) return;
    const pad = padOf(target);
    const first = row.previousElementSibling?.classList.contains('section-label') && row.parentElement;
    const top = (first ? first.offsetTop : row.offsetTop) - pad;
    const bottom = row.offsetTop + row.offsetHeight + pad;
    if (top < target.scrollTop) target.scrollTop = Math.max(0, top);
    else if (bottom > target.scrollTop + target.clientHeight) target.scrollTop = bottom - target.clientHeight;
    countBelow();
  }

  function close() {
    store.paletteOpen = false;
    restoreFocus(previous);
  }

  function pick(item: PaletteItem) {
    close();
    if (item.kind === 'thread') {
      if (workspace.machines.length) void workspace.openNotification(item.id.slice('thread:'.length));
      else { store.showChat(); void store.open(item.id.slice('thread:'.length)); }
      return;
    }
    if (item.kind === 'project') {
      void newThreadIn(item.id);
      return;
    }
    runCommand(store, item.id, inShell);
  }

  /** A fresh draft in that project on that machine, the keyboard in its composer. */
  async function newThreadIn(id: string) {
    const [machineId, projectId] = JSON.parse(id.slice('project:'.length)) as [string, ProjectId];
    const target = machines.find(m => m.id === machineId)?.store ?? store;
    if (workspace.machines.length) await workspace.select(target, undefined, projectId, { fresh: true });
    else {
      store.showChat();
      store.startDraft(projectId, { fresh: true });
    }
    await tick();
    focusComposer();
  }

  /** On the whole dialog, so a key pressed with a row focused never reaches the window's Escape. */
  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      // The field is the one stop: the rows are walked with the arrows.
      event.preventDefault();
      input?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Enter') {
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const item = rows[selected];
      if (item) pick(item);
      return;
    }
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') selected = (selected + 1) % rows.length;
    else if (event.key === 'ArrowUp') selected = (selected - 1 + rows.length) % rows.length;
    else if (event.key === 'Home') selected = 0;
    else if (event.key === 'End') selected = rows.length - 1;
    else return;
    event.preventDefault();
    reveal(selected);
  }

  function placeOf(id: string): Place | null {
    return threadData.places.get(id) ?? projectData.places.get(id) ?? null;
  }

  /** The first row of a section, so the walk keeps one index across headings. */
  function offset(at: number): number {
    let count = 0;
    for (let i = 0; i < at; i++) count += sections[i]!.items.length;
    return count;
  }
</script>

{#if overlay.shown}
  <div
    class="scrim"
    class:closing={overlay.closing}
    role="presentation"
    use:overlay.attach
    onanimationend={overlay.end}
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="palette" class:closing={overlay.closing} role="dialog" aria-modal="true" tabindex="-1" aria-label={strings.palette.placeholder} data-testid="palette" bind:this={dialog} {onkeydown}>
      <label class="field">
        <Search size={16} strokeWidth={1.75} />
        <input
          bind:this={input}
          bind:value={query}
          placeholder={strings.palette.placeholder}
          aria-label={strings.palette.placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autocomplete="off"
          spellcheck="false"
          data-testid="palette-input"
        />
        <span class="kbd ui-label-box"><span class="ui-label">Esc</span></span>
      </label>
      <div class="list" id={listId} role="listbox" aria-label={strings.palette.placeholder} bind:this={list} data-testid="palette-list" onscroll={countBelow}>
        {#each sections as section, at (section.id)}
          {@const first = offset(at)}
          {@const heading = section.kind === 'thread' ? placeOf(section.id) : null}
          {@const recent = section.id === RECENT_SECTION}
          <div class="section" data-testid="palette-section" data-section={section.id}>
            {#if recent}
              <div class="section-label" data-testid="palette-recent">{strings.sidebar.recentView}</div>
            {:else if heading}
              {#if heading.bots}
                <div class="section-label project-label" data-testid="palette-bots">
                  <span class="glyph" data-testid="palette-bots-glyph"><Bot size={14} /></span>
                  <span class="name ui-label">{strings.sidebar.agents}</span>
                  {#if named(heading.machine)}<span class="machine ui-label"><MachineIcon icon={heading.machine.icon} os={heading.machine.store.core?.os} size={12} />{heading.machine.label}</span>{/if}
                </div>
              {:else}
              <div class="section-label project-label" data-testid="palette-project">
                {#if heading.project}<ProjectTile project={heading.project} store={heading.machine.store} size={16} />{/if}
                <span class="name ui-label">{heading.project ? projectName(heading.project) : strings.drafts.name}</span>
                {#if named(heading.machine)}<span class="machine ui-label"><MachineIcon icon={heading.machine.icon} os={heading.machine.store.core?.os} size={12} />{heading.machine.label}</span>{/if}
              </div>
              {/if}
            {:else}
              <div class="section-label">{section.kind === 'project' ? strings.palette.projects : strings.palette.commands}</div>
            {/if}
            {#each section.items as item, n (item.id)}
              {@const index = first + n}
              {@const place = placeOf(item.id)}
              {@const mono = !!place?.thread && quiet(place.thread, place.machine.store)}
              {@const word = recent && place?.thread ? needsWord(place) : null}
              <!-- A thread that needs the user takes two lines for a long title, as its sidebar row does; the right cluster then ends its last line (`lastLine`). -->
              {@const clamp = place?.thread ? (word ?? needsWord(place)) !== null : false}
              {#if breaks.has(item.id)}<div class="band-rule" aria-hidden="true" data-testid="palette-band-rule" data-band={item.band}></div>{/if}
              <button
                type="button"
                class="row"
                class:clamp
                data-lines={clamp ? 2 : undefined}
                class:selected={index === selected}
                role="option"
                id={optionId(item)}
                tabindex="-1"
                aria-selected={index === selected}
                data-index={index}
                data-testid="palette-row"
                data-palette-id={item.id}
                onmousemove={() => (selected = index)}
                onclick={() => pick(item)}
              >
                <span class="mark-slot" class:quiet={mono}>
                  {#if place?.thread}{@const subagents = place.machine.store.subagents(place.thread.id)}<StateRing kind={threadState(place.thread, subagents)} asking={asksMidTurn(place.thread, subagents)} stale={place.machine.store.connection !== 'ready'} ground="var(--color-surface-2)"><ThreadPicture owner={place.machine.store} thread={place.thread} size={16} logo={13} {mono} /></StateRing>
                  {:else if item.kind === 'project' && place?.project}<ProjectTile project={place.project} store={place.machine.store} size={16} />{/if}
                </span>
                <span class="line" use:lastLine={clamp ? item.label : null}>
                <span class="label" class:ui-label={!clamp} data-last-line="title">{item.label}{#if clamp}<span class="room" data-last-line="room" aria-hidden="true"></span>{/if}</span>
                <span class="cluster" data-last-line="cluster">
                {#if recent && place?.thread}
                  <!-- One heading for every recent: the row names its project where a heading would have,
                       then, as a Recent row's subline does, its machine when it is not this PC and what it needs in words. -->
                  <span class="where ui-label" data-testid="palette-where">
                    {#if place.bots}<Bot size={12} aria-hidden="true" data-testid="palette-where-bots" />{strings.sidebar.agents}
                    {:else}{#if place.project}<ProjectTile project={place.project} store={place.machine.store} size={12} />{/if}<span class="where-name">{place.project ? projectName(place.project) : strings.drafts.name}</span>{/if}
                    {#if named(place.machine)}<span class="where-machine" data-testid="palette-where-machine"><span aria-hidden="true">·</span><MachineIcon icon={place.machine.icon} os={place.machine.store.core?.os} size={12} />{place.machine.label}</span>{/if}
                    {#if word}<span class="where-needs" data-testid="palette-where-needs"><span aria-hidden="true">·</span>{word}</span>{/if}
                  </span>
                {/if}
                {#if place?.parent !== undefined}<span class="parent ui-label" data-testid="palette-parent"><Network size={12} aria-hidden="true" /><span class="parent-title">{fill(strings.palette.inParent, { title: place.parent })}</span></span>{/if}
                {#if place?.thread}
                  <!-- The ring says the state; the words stay in the time's title and label, as on a sidebar row. -->
                  <span class="state"><ThreadState thread={place.thread} {now} subagents={place.machine.store.subagents(place.thread.id)} away={place.machine.store.connection !== 'ready'} waited={waitingSince(place.machine.store, place.thread)} compact /></span>
                {:else if item.kind === 'project' && place}
                  <span class="meta ui-label">{#if named(place.machine)}<MachineIcon icon={place.machine.icon} os={place.machine.store.core?.os} size={12} />{place.machine.label}{' · '}{/if}{strings.palette.newThread}</span>
                {:else if item.hint}
                  <span class="kbd ui-label-box"><span class="ui-label">{item.hint}</span></span>
                {/if}
                <span class="enter" aria-hidden="true"><CornerDownLeft size={13} strokeWidth={2} /></span>
                </span>
                </span>
              </button>
            {/each}
          </div>
        {/each}
        {#if rows.length === 0}
          <p class="empty subtle">{strings.palette.empty}</p>
        {/if}
      </div>
      <!-- With nothing to open, Enter does nothing: the foot names only the way out. -->
      <!-- A cut list counts what waits under it, opposite the hint, until it is scrolled to its end. -->
      <div class="foot subtle">
        <span>{rows.length === 0 ? strings.palette.hintEmpty : strings.palette.hint}</span>
        {#if below > 0}<span class="more" aria-hidden="true" data-testid="palette-more">{fill(strings.palette.more, { count: String(below) })}</span>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: min(14vh, 120px);
    background: var(--color-scrim);
    animation: fade var(--dur-2) var(--ease-out-quint);
  }

  .scrim.closing {
    animation-name: fade-out;
    pointer-events: none;
  }

  .palette {
    width: min(560px, calc(100vw - 32px));
    max-height: min(70vh, 520px);
    display: flex;
    flex-direction: column;
    /* A menu's surface and shadow: the sheet colour sat under the dark card and only its edge left the scrim. */
    background: var(--color-float);
    -webkit-backdrop-filter: var(--float-blur);
    backdrop-filter: var(--float-blur);
    border: 1px solid transparent;
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-float);
    overflow: hidden;
    animation: pop var(--dur-2) var(--ease-out-quint);
  }

  .palette.closing {
    animation-name: pop-out;
  }

  /* The list scrolls, the field and the foot keep their height. */
  .field,
  .foot {
    flex: none;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    padding: 0 14px;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-subtle);
  }

  .field input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    font-size: var(--text-md);
    color: var(--color-foreground);
  }

  .field input:focus {
    outline: none;
  }

  /* Positioned, so its rows' offsets count from it; `fit` ends it on a whole row. */
  .list {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
  }

  .section + .section {
    margin-top: 4px;
  }

  /* Every group heads its rows the same way, "Projects" and "Commands" as a project's name:
     semibold sentence case, never the app's uppercase tracked label. */
  .section-label {
    padding: 8px 10px 4px;
    text-transform: none;
    letter-spacing: normal;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-foreground);
  }

  /* A project heading reads like the sidebar's: tile, name, then its machine. */
  .project-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .project-label .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    font-weight: 400;
    color: var(--color-muted-foreground);
  }

  .row {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--row);
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    justify-content: flex-start;
  }

  .row:hover:not(:disabled) {
    background: transparent;
  }

  /* A row that needs the user: up to two 18 px lines, then the ellipsis, so "Crash when the camera opens on
     Android 15" reads whole. The row grows one line only for such a title; every other part keeps the first
     line's centre, in a slot the row's height tall. */
  .row.clamp {
    height: auto;
    min-height: var(--row);
    align-items: flex-start;
  }
  .row.clamp > .mark-slot {
    height: var(--row);
    align-items: center;
  }
  /* The title and the right cluster are the row's own items, until a title may wrap. */
  .line, .cluster { display: contents; }
  /* There the title runs the row's width and the cluster ends its last line, 18 px tall on its
     centre: the title's last word carries an empty room the cluster's width plus the gap
     (`lastLine`); past the title's two lines, every line keeps that room. */
  .row.clamp .line {
    display: block;
    position: relative;
    flex: 1;
    min-width: 0;
    padding-block: calc((var(--row) - 18px) / 2);
  }
  .row.clamp .cluster {
    position: absolute;
    right: 0;
    bottom: calc((var(--row) - 18px) / 2);
    display: flex;
    align-items: center;
    gap: 10px;
    height: 18px;
    max-width: 100%;
  }
  /* A trimmed label's -0.5em margin would lift its slot off the line's centre. */
  .row.clamp .cluster > * { margin-block: 0; padding-block: 0; align-items: center; }
  .row.clamp .where { max-width: none; }
  .row.clamp .room { padding-left: calc(var(--room, 0px) + 10px); }
  .row.clamp .line:global([data-fit='narrow']) .label { padding-right: calc(var(--room, 0px) + 10px); }
  .row.clamp .line:global([data-fit='narrow']) .room { display: none; }
  .row.clamp .label {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    overflow-wrap: anywhere;
    /* Balanced: with the whole first line free, `pretty` let one word end the title alone. */
    text-wrap: balance;
    line-height: 18px;
  }

  /* The row Enter takes: the accent's wash, a bar on its edge and the Enter glyph, readable in both themes.
     The bar is its own straight stroke: an inset shadow bent with the row's radius into a crescent. */
  .row.selected {
    background: var(--color-accent-soft);
  }

  .row.selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 2px;
    border-radius: 1px;
    background: var(--color-accent);
  }

  .foot .more {
    margin-left: auto;
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .glyph {
    display: inline-flex;
    width: 16px;
    justify-content: center;
    flex: none;
    color: var(--color-muted-foreground);
  }

  .enter {
    display: inline-flex;
    flex: none;
    width: 13px;
    color: var(--color-accent);
    opacity: 0;
  }

  .row.selected .enter {
    opacity: 1;
  }

  .row:active:not(:disabled) {
    transform: none;
  }

  /* The ring's width: 16 px picture, its air and its line. */
  .mark-slot {
    display: inline-flex;
    width: 23px;
    justify-content: center;
    flex: none;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 400;
  }

  .state,
  .meta {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  /* A subagent's parent, after its title in the muted tier: it gives way to the title, never pushes the time out. */
  .parent {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  .parent :global(svg) { flex: none; }

  /* A recent's project, after its title in the muted tier: like the parent, it gives way to the title. */
  .where {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }

  .where > :global(*) { flex: none; }

  .where .where-name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* After the project, each behind the subline's dot: the machine, then what the row needs. */
  .where-machine,
  .where-needs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* The sidebar's band rule where the recents change band: its 1 px line, 4 px of air each side. */
  .band-rule {
    height: 1px;
    margin: 4px 10px;
    background: var(--color-border);
  }

  /* A quiet recent's mark at full strength in the muted tier, as on its Recent row: the ring's resting dim would take it under 4.5:1. */
  .mark-slot.quiet > :global([data-testid='state-ring'].ring .picture) { opacity: 1; }
  .mark-slot.quiet :global([data-testid='thread-provider']) { color: var(--color-muted-foreground); }

  .parent-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* On the menu surface the selected row's tint darkens the ground: its time takes the meta tier, as on a sidebar row. */
  .state { --when-color: var(--color-meta); }

  .kbd {
    flex: none;
  }

  .empty {
    padding: 14px 10px;
    text-align: center;
    font-size: var(--text-sm);
  }

  .foot {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 6px 14px 8px;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-xs);
  }
</style>
