<script lang="ts">
  import { desktopShell } from '../lib/shell-platform';
  import { rowAsks } from '../lib/status-order';
  import { tick, untrack } from 'svelte';
  import { CornerDownRight, MessageSquare, Search, X } from '@lucide/svelte';
  import { MESSAGE_SEARCH_QUERY_LIMIT, RpcErrorCode, messageMatchRanges, messageSearchTerms, orderMessageMatches, type AgentProfile, type Project, type ProjectId, type SearchRange, type ThreadMessageMatch, type ThreadSummary } from '@boite/contracts';
  import { RpcFailure } from '../lib/client';
  import { Closing } from '../lib/closing.svelte';
  import { minuteClock } from '../lib/clock.svelte';
  import { appCommands, runCommand } from '../lib/commands.svelte';
  import { archivedThreads } from '../lib/archive';
  import { pluginUi } from '../lib/plugin-ui.svelte';
  import { focusComposer, focusedElement, restoreFocus } from '../lib/focus';
  import { projectName, relativeTime } from '../lib/format';
  import { keyCap } from '../lib/keybindings';
  import { BOTS_SECTION, paletteSections, threadGroup, type PaletteItem, type PaletteSection } from '../lib/palette';
  import type { FieldName } from '../lib/palette-search';
  import { projectThread } from '../lib/thread-rows';
  import { threadState } from '../lib/thread-state';
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

  let { store, onopen }: { store: Store; onopen?: () => void } = $props();

  const overlay = new Closing();
  let query = $state('');
  let selection = $state<string | null>(null);
  /** The selection moved by the keys: the row then draws the focus ring, as a row reached by Tab does anywhere else. */
  let keyed = $state(false);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLDivElement | undefined>(undefined);
  let dialog = $state<HTMLDivElement | undefined>(undefined);
  /** What had the keyboard before the palette took it, where it goes back on close. */
  let previous: HTMLElement | null = null;

  const inShell = desktopShell();
  const phoneWidth = new MediaQuery('(max-width: 720px)');
  const now = $derived(minuteClock.now);
  /** Each machine's done and archived threads, read when the palette opens: a Store's list holds neither (lib/archive.ts). */
  let shelved = $state.raw(new Map<Store, ThreadSummary[]>());
  let reading = 0;

  function readShelved() {
    const read = ++reading;
    for (const machine of untrack(() => machines)) {
      const owner = machine.store;
      // A machine that cannot answer keeps what it showed last; the rest of the list does not wait for it.
      void archivedThreads(owner, undefined, { includeSubagents: true }).then((threads) => {
        if (read === reading) shelved = new Map(shelved).set(owner, threads);
      }).catch(() => {});
    }
  }

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
    selection = null;
    keyed = false;
    mentions = [];
    searchFailed = false;
    overlay.show();
    readShelved();
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

  let machines = $derived(workspace.machinesOr(store));
  let mentions = $state.raw<{ machine: Machine; hit: ThreadMessageMatch }[]>([]);
  let mentionsQuery = $state('');
  let searchFailed = $state(false);
  const mentionQuery = $derived(query.slice(0, MESSAGE_SEARCH_QUERY_LIMIT));
  const searchTerms = $derived(messageSearchTerms(mentionQuery));
  const mentionTerms = $derived(messageSearchTerms(mentionsQuery));
  $effect(() => {
    if (!store.paletteOpen) return;
    const asked = mentionQuery;
    const owners = machines.filter(machine => machine.store.connection === 'ready' && machine.store.core?.features?.messageSearch);
    const enough = searchTerms.some(term => term.words.some(word => word.length >= 2));
    searchFailed = false;
    if (!enough || owners.length === 0) {
      mentions = [];
      mentionsQuery = '';
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      const byMachine = new Map<string, { machine: Machine; hit: ThreadMessageMatch }[]>();
      const publish = () => {
        mentionsQuery = asked;
        mentions = [...byMachine.values()].flat().sort((a, b) =>
          orderMessageMatches(a.hit, b.hit) || a.machine.id.localeCompare(b.machine.id)).slice(0, 20);
      };
      for (const machine of owners) {
        const client = machine.store.client;
        if (!client) continue;
        const wanted = () => current && machine.store.client === client;
        void client.call('threads.search', { query: asked, replacePending: true }).then(({ matches }) => {
          if (!wanted()) return;
          byMachine.set(machine.id, matches.map(hit => ({ machine, hit })));
          publish();
        }).catch((error: unknown) => {
          if (!wanted()) return;
          byMachine.delete(machine.id);
          publish();
          if (!(error instanceof RpcFailure && error.code === RpcErrorCode.MethodNotFound)) searchFailed = true;
        });
      }
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  });
  /** One machine names no machine. */
  let several = $derived(workspace.machines.length > 1);
  /** A heading names its machine as a project card does (lib/machine-host.ts): this app's own goes unsaid. */
  const home = $derived(machines.find(machine => machine.store === workspace.primary)?.id);

  /** Every thread under the heading of its state (lib/palette.ts), a bot's under Bots; the list orders and cuts them. */
  let threadData = $derived.by(() => {
    const items: PaletteItem[] = [];
    const places = new Map<string, Place>();
    for (const machine of machines) {
      const live = new Set(machine.store.threads.map(thread => thread.id));
      const every = [...machine.store.threads, ...(shelved.get(machine.store) ?? []).filter(thread => !live.has(thread.id))];
      const projects = new Map(machine.store.projects.map(project => [project.id, project]));
      const byId = new Map(every.map(thread => [thread.id, thread]));
      for (const thread of every) {
        if (thread.incognito) continue;
        const project = thread.projectId ? projects.get(thread.projectId) ?? null : null;
        const id = `thread:${machine.store.threadKey(thread.id)}`;
        const bot = project ? null : agentDirectory(machine.store).ownerOf(thread);
        const botThread = !project && (bot !== null || !!thread.agentSessionId || !!thread.teamId);
        const section = botThread ? BOTS_SECTION : threadGroup(thread, threadState(thread, rowAsks(machine.store, thread.id)));
        const parentThread = thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined;
        const parent = parentThread?.title ?? null;
        places.set(id, { machine, project, thread, bot, parent });
        if (thread.archived && thread.parentThreadId && !projectThread(thread, parentThread)) continue;
        if (botThread && thread.archived) continue;
        const label = bot && thread.agentSessionId ? bot.name : thread.title;
        const metadata: [FieldName, string | null | undefined][] = [
          ['title', label], ['project', project ? projectName(project) : undefined],
          ['model', machine.store.modelOf(thread)?.name], ['model', thread.model], ['model', thread.providerId],
          ['branch', thread.branch], ['pr', thread.pullRequest ? `#${thread.pullRequest.number}` : undefined],
          ['machine', several ? machine.label : undefined], ['parent', parent],
          ['keywords', thread.status], ['keywords', bot?.name], ['keywords', bot ? thread.title : undefined],
        ];
        items.push({
          id,
          kind: 'thread',
          label,
          fields: metadata.flatMap(([field, value]) => value ? [{ field, text: value }] : []),
          section,
          at: thread.lastUserMessageAt ?? thread.createdAt
        });
      }
    }
    return { items, places };
  });

  const mentionRows = $derived.by(() => {
    const rows = new Map<string, { item: PaletteItem; place: Place; hit: ThreadMessageMatch }>();
    for (const { machine, hit } of mentions) {
      const place = threadData.places.get(`thread:${machine.store.threadKey(hit.threadId)}`);
      if (!place?.thread) continue;
      const label = place.bot && place.thread.agentSessionId ? place.bot.name : place.thread.title;
      const id = `mention:${JSON.stringify([machine.id, hit.messageId])}`;
      rows.set(id, { item: { id, kind: 'mention', label }, place, hit });
    }
    return rows;
  });

  /** Every project, a new thread in it once picked: the list offers them only to a query. */
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

  const snapshot = { sections: [] as PaletteSection[] };
  /** The headings and their rows: threads by state, then projects, bots and commands. */
  let sections = $derived.by((): PaletteSection[] => {
    // Keep the exit animation's rows without subscribing a closed search to live updates.
    if (!store.paletteOpen) return snapshot.sections;
    const ranked = paletteSections(query, [...threadData.items, ...projectData.items, ...commandItems]);
    const results = [...mentionRows.values()].map(row => row.item);
    if (results.length > 0) {
      const afterThreads = ranked.findLastIndex(section => section.kind === 'thread') + 1;
      ranked.splice(afterThreads, 0, { id: 'mentions', kind: 'mention', items: results });
    }
    return snapshot.sections = ranked;
  });
  /** The rows in the order they are drawn: what the arrows walk. */
  let rows = $derived(sections.flatMap(section => section.items));
  let selected = $derived(Math.max(0, rows.findIndex(item => item.id === selection)));

  // The walk starts over on what the user typed, never on the list being
  // rebuilt: the core pushes a `thread.updated` a second per live agent, and
  // the selection cannot jump back to the top under his fingers.
  $effect(() => {
    void query;
    untrack(() => { selection = null; keyed = false; });
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
    // A thread or a new one takes the main card back from desktop Activity and switches a phone to chat.
    if (item.kind !== 'command' || item.id === 'new-thread') {
      inbox.open = false;
      onopen?.();
    }
    if (item.kind === 'mention') {
      const mention = mentionRows.get(item.id);
      if (!mention) return;
      const { hit, place } = mention;
      const target = place.machine.store;
      const match = { messageId: hit.messageId, query: mentionsQuery || mentionQuery };
      if (workspace.machines.length) void workspace.select(target, hit.threadId, undefined, { match });
      else { target.showChat(); void target.open(hit.threadId, true, { match }); }
      return;
    }
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
    let next: number;
    if (event.key === 'ArrowDown') next = (selected + 1) % rows.length;
    else if (event.key === 'ArrowUp') next = (selected - 1 + rows.length) % rows.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else return;
    selection = rows[next]!.id;
    keyed = true;
    event.preventDefault();
  }

  function headingOf(section: PaletteSection): string {
    if (section.id === BOTS_SECTION) return strings.agents.heading;
    if (section.kind === 'project') return strings.palette.projects;
    if (section.kind === 'command') return strings.palette.commands;
    if (section.kind === 'mention') return strings.palette.mentions;
    return strings.palette.groups[section.id as keyof typeof strings.palette.groups] ?? section.id;
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

{#snippet highlighted(label: string, ranges: SearchRange[] = [])}
  {#each ranges as { start, end }, index}{label.slice(ranges[index - 1]?.end ?? 0, start)}<mark>{label.slice(start, end)}</mark>{/each}{label.slice(ranges.at(-1)?.end ?? 0)}
{/snippet}

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
      <div class="field">
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
        {#if phoneWidth.current}
          <button type="button" class="ghost icon" aria-label={strings.common.close} onclick={close}><X size={16} /></button>
        {:else}
          <span class="kbd ui-label-box"><span class="ui-label">{keyCap('Escape')}</span></span>
        {/if}
      </div>
      <div class="list" role="listbox" bind:this={list} data-testid="palette-list">
        {#each sections as section, at (section.id)}
          {@const first = offset(at)}
          <div class="section" data-testid="palette-section" data-section={section.id}>
            <div class="section-label" data-testid="palette-heading">{headingOf(section)}</div>
            {#each section.items as item, n (item.id)}
              {@const index = first + n}
              {@const mention = mentionRows.get(item.id)}
              {@const place = mention?.place ?? placeOf(item.id)}
              <button
                type="button"
                class="row"
                class:selected={index === selected}
                class:keyed={keyed && index === selected}
                class:sub={!!place?.parent}
                class:two-lines={!!mention || !!item.matchHint}
                role="option"
                tabindex="-1"
                aria-selected={index === selected}
                data-index={index}
                data-testid="palette-row"
                data-palette-id={item.id}
                onmousemove={() => { selection = item.id; keyed = false; }}
                onclick={() => pick(item)}
              >
                <!-- The slot says where the row lives: a thread's project, a bot's picture, a subagent's turn off its parent. The state reads at the right. -->
                <span class="mark-slot">
                  {#if mention}<MessageSquare size={15} strokeWidth={1.75} />
                  {:else if place?.bot}<AgentAvatar kind="profile" id={place.bot.id} name={place.bot.name} avatar={place.bot.avatar} size={16} />
                  {:else if place?.thread?.teamId}<AgentAvatar kind="team" id={place.thread.teamId} name={place.thread.title} size={16} />
                  {:else if !place?.thread && item.kind === 'project' && place?.project}<ProjectTile project={place.project} store={place.machine.store} size={16} />
                  {:else if place?.parent}<span class="sub-mark" aria-hidden="true"><CornerDownRight size={14} /></span>
                  {:else if place?.thread && place.project}<ProjectTile project={place.project} store={place.machine.store} size={16} />{/if}
                </span>
                <span class="copy" class:sub={!!place?.parent && !mention}>
                  <span class="title-line">
                    <span class="label ui-label">{@render highlighted(item.label, item.titleRanges)}</span>
                    {#if mention}
                      {#if place?.project}<span class="mention-place">{projectName(place.project)}</span>{/if}
                      {#if place && hostName(place.machine, machines, home)}<MachinePlace host={hostName(place.machine, machines, home)!} />{/if}
                      <time datetime={new Date(mention.hit.messageCreatedAt).toISOString()}>{relativeTime(mention.hit.messageCreatedAt, now)}</time>
                    {/if}
                  </span>
                  {#if mention}
                    <span class="detail mention-snippet"><span class="speaker">{strings.palette.speakers[mention.hit.role]}</span> {@render highlighted(mention.hit.snippet, messageMatchRanges(mention.hit.snippet, mentionTerms))}</span>
                  {:else if item.matchHint}
                    <span class="detail" data-testid="palette-match-hint">{strings.palette.matchFields[item.matchHint.field]} {@render highlighted(item.matchHint.text, item.matchHint.ranges)}</span>
                  {/if}
                </span>
                {#if place?.parent && !mention}{@const [before, after = ''] = strings.palette.subagentOf.split('{parent}')}<span class="parent ui-label" data-testid="palette-parent"><span class="joint">{before}</span><span class="parent-title">{place.parent}</span>{#if after}<span class="joint">{after}</span>{/if}</span>{/if}
                {#if mention}
                  <!-- The time and place are on this result's title line. -->
                {:else if place?.thread}
                  {#if place.project && !place.parent}<span class="where" data-testid="palette-where"><span class="ui-label">{projectName(place.project)}</span>{#if hostName(place.machine, machines, home)}<MachinePlace host={hostName(place.machine, machines, home)!} />{/if}</span>{/if}
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
      {#if searchFailed}<p class="search-hint subtle" role="status" data-testid="palette-search-hint">{strings.palette.searchFailed}</p>{/if}
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
    height: 52px;
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
    margin-top: var(--space-2);
  }

  /* The overlay's head form, as Menu's headings. */
  .section-label {
    padding: var(--space-2) var(--overlay-row-pad) var(--space-1);
    color: var(--color-subtle);
  }

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

  .copy {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .title-line {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .label, .detail, .mention-place {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label {
    flex: 1;
    min-width: 0;
    font-weight: 400;
    line-height: 1.3;
  }

  .row.two-lines {
    min-height: calc(var(--overlay-row) + var(--space-4));
    height: auto;
    padding-block: var(--space-1);
  }

  .detail, time, .mention-place {
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    line-height: 1.3;
  }

  .mention-place { max-width: 30%; }
  time { flex: none; }
  .speaker { color: var(--color-subtle); }
  @media (max-width: 600px) {
    .mention-snippet { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal; }
  }
  mark { color: var(--color-foreground); background: var(--color-accent-soft); border-radius: var(--radius-sm); }
  .row.selected mark { background: color-mix(in oklch, var(--color-accent) 28%, transparent); }

  /* A subagent's title gives its room to the parent's name only past its own width. */
  .copy.sub { flex: 0 1 auto; }
  /* A helper stands under its state like any thread, a step back: smaller, in the quiet ink, until it is the row Enter takes. */
  .row.sub { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .row.sub.selected { color: var(--color-foreground); }
  /* Whose thread it is, quiet at the row's end: the heading says its state, this says its project. */
  .where { flex: 0 1 auto; display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; max-width: 38%; font-size: var(--text-sm); color: var(--color-subtle); }
  .where .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where :global(.machine-place) { flex: none; }
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

  .empty {
    padding: 14px 10px;
    text-align: center;
    font-size: var(--text-sm);
  }

  .search-hint {
    margin: 0;
    padding: var(--space-2) calc(var(--overlay-pad) + var(--overlay-row-pad));
    font-size: var(--text-sm);
  }

</style>
