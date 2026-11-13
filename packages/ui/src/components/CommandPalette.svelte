<script lang="ts">
  import { rowAsks } from '../lib/status-order';
  import { tick, untrack } from 'svelte';
  import { CornerDownRight, Search } from '@lucide/svelte';
  import type { AgentProfile, Project, ProjectId, ThreadSummary } from '@boite/contracts';
  import { Closing } from '../lib/closing.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { appCommands, runCommand } from '../lib/commands.svelte';
  import { pluginUi } from '../lib/plugin-ui.svelte';
  import { focusComposer, focusedElement, restoreFocus } from '../lib/focus';
  import { projectName } from '../lib/format';
  import { PALETTE_LIMIT, RECENT_THREADS, rankItems, sectionRows, type PaletteItem } from '../lib/palette';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { desktopSettings } from '../lib/settings-tabs';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import MachinePlace from './MachinePlace.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import ThreadState from './ThreadState.svelte';
  import AgentAvatar from './agents/AgentAvatar.svelte';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { inbox } from '../lib/inbox.svelte';
  import { hostMark, hostName } from '../lib/machine-host';

  let { store }: { store: Store } = $props();

  const overlay = new Closing();
  let query = $state('');
  let selected = $state(0);
  /** The selection moved by the keys: the row then draws the focus ring, as a row reached by Tab does anywhere else. */
  let keyed = $state(false);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLDivElement | undefined>(undefined);
  let dialog = $state<HTMLDivElement | undefined>(undefined);
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
    keyed = false;
    overlay.show();
    void tick().then(() => input?.focus({ preventScroll: true }));
  });

  /** What a row or a heading draws beside its words: the thread, its project, its machine. */
  interface Place {
    machine: Machine;
    project: Project | null;
    thread: ThreadSummary | null;
    /** A bot's thread: its picture leads the row. */
    bot?: Pick<AgentProfile, 'id' | 'name' | 'avatar'> | null;
    /** A subagent's parent thread title: the row says whose helper it is. */
    parent?: string | null;
  }
  /** Bots and team chats have no project: they gather under one heading of their own, never under Drafts. */
  const BOTS = 'bots';

  let machines = $derived(workspace.machinesOr(store));
  /** One machine names no machine. */
  let several = $derived(workspace.machines.length > 1);
  /** A heading names its machine as a project card does (lib/machine-host.ts): this app's own goes unsaid. */
  const home = $derived(machines.find(machine => machine.store === workspace.primary)?.id);

  /** Every live thread, most recent first; the list cuts it to the recents until something is typed. */
  let threadData = $derived.by(() => {
    const entries: { item: PaletteItem; at: number }[] = [];
    const places = new Map<string, Place>();
    for (const machine of machines) {
      for (const thread of machine.store.threads) {
        if (thread.archived || thread.incognito) continue;
        const project = machine.store.projects.find(p => p.id === thread.projectId) ?? null;
        const id = `thread:${machine.store.threadKey(thread.id)}`;
        const bot = project ? null : agentDirectory(machine.store).ownerOf(thread);
        const botThread = !project && (bot !== null || !!thread.agentSessionId || !!thread.teamId);
        const section = botThread ? BOTS : `in:${machine.id}:${thread.projectId}`;
        const parent = thread.parentThreadId ? machine.store.threads.find(one => one.id === thread.parentThreadId)?.title ?? null : null;
        places.set(id, { machine, project, thread, bot, parent });
        if (!botThread && !places.has(section)) places.set(section, { machine, project, thread: null });
        entries.push({ at: thread.lastUserMessageAt ?? thread.createdAt, item: {
          id,
          kind: 'thread',
          // A bot's own conversation goes by the bot's name; its helpers keep their titles.
          label: bot && thread.agentSessionId ? bot.name : thread.title,
          // What a query may also land on: the project and the machine, never drawn on the row.
          hint: [project ? projectName(project) : '', bot ? `${bot.name} ${thread.title}` : '', parent ?? '', several ? machine.label : ''].filter(Boolean).join(' '),
          keywords: thread.status,
          section
        } });
      }
    }
    return { items: entries.sort((a, b) => b.at - a.at).map(entry => entry.item), places };
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

  /** Plugin interfaces run on the window's own core, so their commands join its palette alone. */
  const PLUGIN_COMMAND = 'plugin-command:';
  let commandItems = $derived.by((): PaletteItem[] => [
    ...appCommands(store, !desktopSettings(phoneWidth.current)),
    ...(store === workspace.primary
      ? pluginUi.commands.map((command): PaletteItem => ({ id: `${PLUGIN_COMMAND}${command.key}`, kind: 'command', label: command.title, hint: pluginUi.name(command.plugin), keywords: 'plugin' }))
      : []),
  ]);

  const snapshot = { rows: [] as PaletteItem[] };
  /** The ranked rows, a project's threads, the projects and the commands mixed until `sections` cuts them. */
  let ranked = $derived.by((): PaletteItem[] => {
    // Keep the exit animation's rows without subscribing a closed search to live updates.
    if (!store.paletteOpen) return snapshot.rows;
    const typed = query.trim().length > 0;
    const threads = typed ? threadData.items : threadData.items.slice(0, RECENT_THREADS);
    const projects = typed ? projectData.items : [];
    return snapshot.rows = rankItems(query, [...threads, ...projects, ...commandItems], PALETTE_LIMIT);
  });
  let sections = $derived(sectionRows(ranked));
  /** The rows in the order they are drawn: what the arrows walk. */
  let rows = $derived(sections.flatMap(section => section.items));

  // The walk starts over on what the user typed, never on the list being
  // rebuilt: the core pushes a `thread.updated` a second per live agent, and
  // the selection cannot jump back to the top under his fingers.
  $effect(() => {
    void query;
    untrack(() => { selected = 0; keyed = false; });
  });

  /** A shorter list keeps the keyboard on a row that is still there. */
  $effect(() => {
    const count = rows.length;
    untrack(() => {
      if (selected >= count) selected = Math.max(0, count - 1);
    });
  });

  $effect(() => {
    const row = list?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    // jsdom draws nothing and has no scrollIntoView; a real list keeps the row in view.
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  });

  function close() {
    store.paletteOpen = false;
    restoreFocus(previous);
  }

  function pick(item: PaletteItem) {
    close();
    // A thread or a new one takes the main card back from desktop Activity.
    if (item.kind !== 'command' || item.id === 'new-thread') inbox.open = false;
    if (item.kind === 'thread') {
      if (workspace.machines.length) void workspace.openNotification(item.id.slice('thread:'.length));
      else { store.showChat(); void store.open(item.id.slice('thread:'.length)); }
      return;
    }
    if (item.kind === 'project') {
      void newThreadIn(item.id);
      return;
    }
    if (item.id.startsWith(PLUGIN_COMMAND)) {
      const key = item.id.slice(PLUGIN_COMMAND.length);
      pluginUi.commands.find((command) => command.key === key)?.run({ threadId: store.openThread?.id ?? null });
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
    keyed = true;
    event.preventDefault();
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
          autocomplete="off"
          spellcheck="false"
          data-testid="palette-input"
        />
        <span class="kbd ui-label-box"><span class="ui-label">Esc</span></span>
      </label>
      <div class="list" role="listbox" bind:this={list} data-testid="palette-list">
        {#each sections as section, at (section.id)}
          {@const first = offset(at)}
          {@const heading = section.kind === 'thread' && section.id !== BOTS ? placeOf(section.id) : null}
          <div class="section" data-testid="palette-section" data-section={section.id}>
            {#if heading}
              <div class="section-label project-label" data-testid="palette-project">
                {#if heading.project}<ProjectTile project={heading.project} store={heading.machine.store} size={16} />{/if}
                <span class="name ui-label">{heading.project ? projectName(heading.project) : strings.drafts.name}</span>
                {#if hostName(heading.machine, machines, home)}<MachinePlace host={hostName(heading.machine, machines, home)!} />{/if}
              </div>
            {:else}
              <div class="section-label">{section.id === BOTS ? strings.agents.heading : section.kind === 'project' ? strings.palette.projects : strings.palette.commands}</div>
            {/if}
            {#each section.items as item, n (item.id)}
              {@const index = first + n}
              {@const place = placeOf(item.id)}
              <button
                type="button"
                class="row"
                class:selected={index === selected}
                class:keyed={keyed && index === selected}
                role="option"
                tabindex="-1"
                aria-selected={index === selected}
                data-index={index}
                data-testid="palette-row"
                data-palette-id={item.id}
                onmousemove={() => { selected = index; keyed = false; }}
                onclick={() => pick(item)}
              >
                <!-- A thread's slot stays empty, its title under its project's name; a bot's holds its picture. The state reads at the right. -->
                <span class="mark-slot">
                  {#if place?.bot}<AgentAvatar kind="profile" id={place.bot.id} name={place.bot.name} avatar={place.bot.avatar} size={16} />
                  {:else if place?.thread?.teamId}<AgentAvatar kind="team" id={place.thread.teamId} name={place.thread.title} size={16} />
                  {:else if !place?.thread && item.kind === 'project' && place?.project}<ProjectTile project={place.project} store={place.machine.store} size={16} />
                  {:else if place?.parent}<span class="sub-mark" aria-hidden="true"><CornerDownRight size={14} /></span>{/if}
                </span>
                <span class="label ui-label" class:sub={!!place?.parent}>{item.label}</span>
                {#if place?.parent}{@const [before, after = ''] = strings.palette.subagentOf.split('{parent}')}<span class="parent ui-label" data-testid="palette-parent"><span class="joint">{before}</span><span class="parent-title">{place.parent}</span>{#if after}<span class="joint">{after}</span>{/if}</span>{/if}
                {#if place?.thread}
                  <span class="state"><ThreadState thread={place.thread} {now} subagents={rowAsks(place.machine.store, place.thread.id)} away={place.machine.store.connection !== 'ready'} mark /></span>
                {:else if item.kind === 'project' && place}
                  <span class="meta">{#if several}<MachinePlace host={hostMark(place.machine.label, place.machine.store.connection)} />{/if}<span class="ui-label">{strings.palette.newThread}</span></span>
                {:else if item.hint}
                  <span class="kbd ui-label-box"><span class="ui-label">{item.hint}</span></span>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
        {#if rows.length === 0}
          <p class="empty subtle">{strings.palette.empty}</p>
        {/if}
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
    /* The overlay card every menu, sheet and dialog wears (app.css). */
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
    animation: pop var(--dur-2) var(--ease-out-quint);
  }

  .palette.closing {
    animation-name: pop-out;
  }

  /* The list scrolls, the field keeps its height. */
  .field {
    flex: none;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    /* The rows' text edges on both sides: the list's padding plus a row's, and the same scrollbar gutter, so the Esc
       key and every row's state end on one right edge whether the list scrolls or not. */
    padding: 0 calc(var(--overlay-pad) + var(--overlay-row-pad));
    overflow: hidden;
    scrollbar-gutter: stable;
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

  /* A row the list's end cuts fades out at the card's edge, so it reads as more
     below, and the end padding is as tall as the fade: scrolled down, the last
     row sits whole above it. */
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: var(--overlay-pad) var(--overlay-pad) var(--space-6);
    scroll-padding-block: var(--overlay-pad) var(--space-6);
    mask-image: linear-gradient(to bottom, black calc(100% - var(--space-6)), transparent);
  }

  .section + .section {
    margin-top: 4px;
  }

  /* The overlay's head form, as Menu's headings. */
  .section-label {
    padding: var(--space-2) var(--overlay-row-pad) var(--space-1);
    color: var(--color-subtle);
  }

  /* A project heading reads like the sidebar's: tile, name, then its machine. */
  .project-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    text-transform: none;
    letter-spacing: normal;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-foreground);
  }

  .project-label .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The heading's machine stays whole after the name, as on the list's cards. */
  .project-label :global(.machine-place) { flex: none; }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--overlay-row);
    padding: 0 var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    justify-content: flex-start;
  }

  .row:hover:not(:disabled) {
    background: transparent;
  }

  /* The row Enter takes: the selection wash, readable in both themes. No Enter glyph: it
     would push the state column off the right edge the field's Esc and every other row end on. */
  .row.selected {
    background: var(--color-accent-soft);
  }
  /* The field keeps the keys, so no row is focused: the one the arrows reached draws the ring itself, inside it. */
  .row.keyed { outline: var(--focus-ring); outline-offset: -2px; }


  .row:active:not(:disabled) {
    transform: none;
  }

  .mark-slot {
    display: inline-flex;
    width: 16px;
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

  /* A subagent's title gives its room to the parent's name only past its own width. */
  .label.sub { flex: 0 1 auto; }
  /* "in" stays whole; only the parent's title, the user's words, ends in an ellipsis when the row is short. */
  .parent { flex: 1 1 0; display: flex; min-width: 0; white-space: nowrap; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .parent .joint { flex: none; white-space: pre; }
  .parent-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .sub-mark { display: inline-flex; color: var(--color-subtle); }

  .state,
  .meta {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
  }

  .kbd {
    flex: none;
  }

  /* The list's grammar: at rest a thread shows its state only when it asks for the user or failed; the row Enter takes shows the rest. */
  .row:not(.selected) .state :global(.when:not(.waiting, .error, .interrupted)) {
    display: none;
  }

  .empty {
    padding: 14px 10px;
    text-align: center;
    font-size: var(--text-sm);
  }

</style>
