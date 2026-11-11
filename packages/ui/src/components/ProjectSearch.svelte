<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Check, FolderOpen, Search } from '@lucide/svelte';
  import type { Closing } from '../lib/closing.svelte';
  import { focusInitial } from '../lib/focus';
  import { mobileOverlay } from '../lib/mobile-history';
  import { scoreFields } from '../lib/palette';
  import type { ProjectGroup, ProjectRow } from '../lib/project-rows';
  import { fill, strings } from '../lib/strings';
  import MachineIcon from './MachineIcon.svelte';
  import ProjectTile from './ProjectTile.svelte';

  /**
   * The project search both pickers open: the draft's "Change project"
   * (`ProjectChoice.svelte`) and a thread's "Move to project"
   * (`MoveProjectPicker.svelte`). A field over the rows, grouped by machine when
   * there are several; the keyboard stays in the field, the arrows move the
   * highlighted row and Enter takes it. Typing ranks every machine's rows in
   * one list, each word on the name, the machine or the folder ("boite m2").
   * Only the rows scroll, and the dialog keeps inside the window.
   *
   * The owner shows and hides `popover`: a pick and a close are only told.
   */
  let { popover, testid, label, groups, several, byKeyboard = false, empty, footer, onpick, onclose }: {
    popover: Closing;
    testid: string;
    label: string;
    groups: ProjectGroup[];
    /** Rows of a ranked list name their machine. */
    several: boolean;
    /** Opened by a key: the field takes the keys even on a phone, where a tap leaves the keyboard down. */
    byKeyboard?: boolean;
    /** What an empty list says before anything is typed. */
    empty?: string;
    /** An action under the list that never scrolls away, the drafts' "Open a folder". */
    footer?: { id: string; label: string };
    onpick: (id: string) => void;
    /** `refocus`: closed from the keyboard, which goes back where it came from. */
    onclose: (refocus: boolean) => void;
  } = $props();

  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLDivElement | undefined>(undefined);
  const listId = `project-search-${Math.random().toString(36).slice(2)}`;
  let query = $state('');
  let highlight = $state(0);

  /** Typed, one list over every machine, best first, the palette's ranking (`lib/palette.ts`). */
  let typed = $derived(query.trim().length > 0);
  let shown = $derived.by<ProjectGroup[]>(() => {
    if (!typed) return groups;
    const ranked = groups
      .flatMap((group) => group.rows)
      .map((row, at) => ({ row, at, score: scoreFields(query, row.fields) }))
      .filter((entry): entry is { row: ProjectRow; at: number; score: number } => entry.score !== null && entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.at - b.at)
      .map((entry) => entry.row);
    return ranked.length ? [{ id: 'ranked', machine: null, rows: ranked }] : [];
  });

  /** What the arrows walk: the rows in screen order, then the footer's action. */
  let order = $derived([...shown.flatMap((group) => group.rows.map((row) => row.id)), ...(footer ? [footer.id] : [])]);
  let none = $derived(shown.length === 0);

  $effect(() => {
    void query;
    highlight = 0;
  });

  /**
   * Each opening starts from an empty field, one opened again during its exit
   * too. The field takes the keyboard on a desktop; on a phone it would raise
   * the keyboard over the list. The checked row starts highlighted.
   */
  $effect(() => {
    if (!popover.open) return;
    untrack(() => {
      query = '';
      highlight = 0;
    });
    void tick().then(() => {
      if (byKeyboard) input?.focus({ preventScroll: true });
      else focusInitial(input, input?.closest<HTMLElement>('[role=dialog]'));
      const at = order.findIndex((id) => shown.some((group) => group.rows.some((row) => row.id === id && row.active)));
      if (at >= 0) move(at);
    });
  });

  // A phone's Back closes the list.
  $effect(() => { if (popover.open) return mobileOverlay(() => onclose(false)); });

  /** The keys to the field again, from an owner opened a second time while up. */
  export function focus(): void {
    input?.focus({ preventScroll: true });
  }

  /**
   * The list opens where the command palette does, under the title bar and
   * centred, on `<body>`: from the heading it had only the space above it,
   * three rows on a laptop.
   */
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  function move(at: number) {
    highlight = at;
    // The footer's action sits outside the scrolled list and is always in view.
    list?.querySelector<HTMLElement>(`#${listId}-${at}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      // Modal: the page behind the scrim takes no keys. The rows are walked with the arrows.
      event.preventDefault();
      input?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      // A first Escape clears what was typed, the next one closes.
      if (query !== '') query = '';
      else onclose(true);
      return;
    }
    if (event.key === 'Enter') {
      // Enter also confirms an input method's candidate: that one is not a pick.
      if (event.isComposing || event.keyCode === 229) return;
      const id = order[highlight];
      event.preventDefault();
      // A query nothing answers takes nothing: Enter is not a way to the footer's action.
      if (!id || (id === footer?.id && typed && none)) return;
      onpick(id);
      return;
    }
    if (order.length === 0) return;
    if (event.key === 'ArrowDown') move((highlight + 1) % order.length);
    else if (event.key === 'ArrowUp') move((highlight - 1 + order.length) % order.length);
    else if (event.key === 'PageDown') move(Math.min(order.length - 1, highlight + 8));
    else if (event.key === 'PageUp') move(Math.max(0, highlight - 8));
    else return;
    event.preventDefault();
  }

  const optionId = (id: string) => `${listId}-${order.indexOf(id)}`;
</script>

{#if popover.shown}
  <div
    class="scrim"
    class:closing={popover.closing}
    role="presentation"
    use:portal
    use:popover.attach
    onanimationend={popover.end}
    onclick={(event) => { if (event.target === event.currentTarget) onclose(false); }}
  >
  <div
    class="popover"
    class:closing={popover.closing}
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    {onkeydown}
    data-testid="{testid}-menu"
  >
    <label class="search">
      <Search size={14} strokeWidth={1.75} />
      <input
        bind:this={input}
        bind:value={query}
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={order[highlight] ? `${listId}-${highlight}` : undefined}
        aria-autocomplete="list"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder={strings.thread.searchProjects}
        aria-label={strings.thread.searchProjects}
        data-testid="{testid}-search"
      />
    </label>

    <div class="rows" role="listbox" id={listId} aria-label={label} bind:this={list} data-testid="{testid}-list">
      {#each shown as group (group.id)}
        {#if group.machine}<div class="group ui-label" role="presentation"><MachineIcon icon={group.machine.icon} os={group.machine.store.core?.os} size={12} />{group.machine.label}</div>{/if}
        {#each group.rows as row (row.id)}
          <button
            type="button"
            class="row"
            class:highlight={order[highlight] === row.id}
            class:active={row.active}
            role="option"
            aria-selected={row.active}
            tabindex="-1"
            id={optionId(row.id)}
            data-row
            data-value={row.id}
            title={row.title}
            onpointermove={() => (highlight = order.indexOf(row.id))}
            onclick={() => onpick(row.id)}
          >
            {#if row.tile}<ProjectTile project={row.tile.project} store={row.tile.store} size={20} />{:else}<span class="blank" aria-hidden="true"><FolderOpen size={14} strokeWidth={1.75} /></span>{/if}
            <span class="name ui-label">{row.label}</span>
            <span class="hint ui-label">{row.hint}</span>
            {#if typed && several}<span class="machine ui-label"><MachineIcon icon={row.machine.icon} os={row.machine.store.core?.os} size={12} />{row.machine.label}</span>{/if}
            <span class="check" aria-hidden="true">{#if row.active}<Check size={15} strokeWidth={2} />{/if}</span>
          </button>
        {/each}
      {/each}
      {#if none}<p class="empty" data-testid="{testid}-empty">{!typed && empty !== undefined ? empty : fill(strings.thread.noProjectMatch, { query: query.trim() })}</p>{/if}
    </div>

    {#if footer}
      <button
        type="button"
        class="row folder"
        class:highlight={order[highlight] === footer.id && !(typed && none)}
        tabindex="-1"
        id={optionId(footer.id)}
        data-row
        data-value={footer.id}
        onpointermove={() => (highlight = order.indexOf(footer.id))}
        onclick={() => onpick(footer.id)}
      >
        <span class="blank" aria-hidden="true"><FolderOpen size={14} strokeWidth={1.75} /></span>
        <span class="name ui-label">{footer.label}</span>
      </button>
    {/if}
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

  .popover {
    width: min(520px, calc(100vw - 24px));
    max-height: min(70vh, 520px);
    display: flex;
    flex-direction: column;
    padding: var(--overlay-pad);
    /* The overlay card every menu, sheet and dialog wears (app.css). */
    background: var(--overlay-surface);
    border: 1px solid var(--overlay-edge);
    border-radius: var(--radius-overlay);
    box-shadow: var(--shadow-overlay);
    /* The list reads at the body size even under the heading's large type. */
    font-size: var(--text-base);
    font-weight: 400;
    letter-spacing: normal;
    line-height: normal;
    text-align: left;
    overflow: hidden;
    animation: pop var(--dur-2) var(--ease-out-quint);
  }

  .popover.closing {
    animation-name: pop-out;
    pointer-events: none;
  }

  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control);
    padding: 0 10px;
    margin-bottom: 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-subtle);
    transition: border-color var(--dur-2) var(--ease-out-quint);
  }

  .search:focus-within {
    border-color: var(--color-edge);
    color: var(--color-muted-foreground);
  }

  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-foreground);
    font-size: var(--text-sm);
  }

  .search input:focus {
    outline: none;
  }

  /* Only the rows scroll: the field above and the footer's action below stay put. */
  .rows {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .rows > * {
    flex: none;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    /* The overlay's head form, as Menu's headings. */
    padding: var(--space-2) var(--overlay-row-pad) var(--space-1);
    color: var(--color-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  /* One line a project: its tile, its name, its folder, then the machine and the mark. */
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: auto;
    min-height: var(--overlay-row);
    padding: var(--space-1) var(--overlay-row-pad);
    border: none;
    border-radius: var(--radius-overlay-row);
    background: transparent;
    color: var(--color-foreground);
    text-align: left;
    cursor: pointer;
  }

  /* The row Enter takes, as in the command palette: the selection wash and a bar on its edge. */
  .row.highlight {
    background: var(--color-accent-soft);
    box-shadow: inset 2px 0 0 var(--color-muted-foreground);
  }

  .row:active {
    transform: none;
    background: var(--color-active);
  }

  .check {
    flex: none;
    display: inline-flex;
    width: 15px;
    color: var(--color-accent);
  }

  .machine {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }

  .blank {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    color: var(--color-muted-foreground);
  }

  .name {
    flex: none;
    max-width: 55%;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder .name {
    flex: 1;
    max-width: none;
    font-weight: 400;
    color: var(--color-muted-foreground);
  }

  .folder.highlight .name {
    color: var(--color-foreground);
  }

  /* After the name, filling the line: a long path ends in an ellipsis, the full one is in the title. */
  .hint {
    flex: 1;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder {
    flex: none;
    min-height: var(--control);
    margin-top: 6px;
    position: relative;
  }

  .folder::before {
    content: '';
    position: absolute;
    top: -4px;
    left: 6px;
    right: 6px;
    height: 1px;
    background: var(--color-border);
  }

  .empty {
    margin: 0;
    padding: 18px 8px;
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
  }

  @media (max-width: 720px) {
    .scrim { padding-top: 12px; }
    .search { height: var(--control-touch); }
    .row { min-height: var(--touch-target); }
  }
</style>
