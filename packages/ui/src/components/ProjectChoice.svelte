<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import type { Project, ProjectId } from '@boite/contracts';
  import { Closing } from '../lib/closing.svelte';
  import { focusComposer } from '../lib/focus';
  import { shortPath } from '../lib/format';
  import { projectRow, searchFields, type ProjectGroup, type ProjectRow } from '../lib/project-rows';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace, type Machine } from '../lib/workspace.svelte';
  import ProjectSearch from './ProjectSearch.svelte';

  /**
   * The draft's project dropdown: the project search (`ProjectSearch.svelte`)
   * over every machine's drafts and projects, grouped by machine when there are
   * several, and for the owner the way to open a folder. A pick hands the
   * keyboard back to the composer. The find chord opens it on a draft
   * (`store.projectChoiceRequest`).
   */
  /** `phone`: the copy the phone's welcome draws; the find chord opens the one the width shows. */
  let { store, testid, phone = false, selection, children }: {
    store: Store; testid: string; phone?: boolean; children: Snippet;
    /** Reuse the search for an action on an existing project, without changing the draft. */
    selection?: {
      machines: Machine[];
      projects: (owner: Store) => readonly Project[];
      onpick: (owner: Store, project: Project) => void;
      label: string;
      empty: string;
    };
  } = $props();

  const OPEN_FOLDER = 'open-folder';

  const popover = new Closing();
  /** One machine names no machine. */
  const machines = $derived(selection?.machines ?? workspace.machinesOr(store));
  const label = $derived(selection?.label ?? strings.thread.changeProject);
  const footer = $derived(!selection && store.owner ? { id: OPEN_FOLDER, label: strings.drafts.pickFolder } : undefined);
  let several = $derived(workspace.machines.length > 1 || machines.length > 1);
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  let search = $state<ProjectSearch | undefined>(undefined);
  /** Opened by the find chord: the search takes the keys even on a phone, where a tap leaves the keyboard down. */
  let byKeyboard = $state(false);

  /** Every machine's drafts first, whether the core has made them yet or not, then its live projects. */
  let groups = $derived.by<ProjectGroup[]>(() => {
    // The machine on screen first: its projects are the likeliest pick.
    const ordered = [...machines.filter((m) => m.store === store), ...machines.filter((m) => m.store !== store)];
    return ordered.map((machine) => {
      const here = machine.store === store;
      const drafts = selection ? undefined : machine.store.draftsProject;
      const rows: ProjectRow[] = [
        ...(!selection ? [{
          id: JSON.stringify([machine.id, null]),
          label: strings.drafts.name,
          hint: drafts ? shortPath(drafts.path) : '',
          title: strings.drafts.hint,
          active: here && store.draftInDrafts,
          tile: drafts ? { project: drafts, store: machine.store } : null,
          machine,
          fields: searchFields(strings.drafts.name, machine, '', several)
        }] : []),
        ...(selection ? selection.projects(machine.store) : machine.store.projects)
          .filter((entry) => entry.id !== drafts?.id && entry.archived !== true)
          .map((entry) => projectRow(entry, machine, { several, active: !selection && here && entry.id === store.draft?.projectId }))
      ];
      return { id: machine.id, machine: several ? machine : null, rows };
    }).filter(group => group.rows.length > 0);
  });

  /**
   * The find chord on a draft: only the copy on screen opens, the phone's
   * heading or the computer's. Each machine's store counts its own asks, so a
   * draft moved to another machine starts from that one's count and opens nothing.
   */
  let seen = untrack(() => ({ store, request: store.projectChoiceRequest }));
  $effect(() => {
    const owner = store;
    const request = owner.projectChoiceRequest;
    if (seen.store !== owner || request === seen.request) {
      seen = { store: owner, request };
      return;
    }
    seen = { store: owner, request };
    untrack(() => {
      if (selection || !trigger || window.matchMedia('(max-width: 720px)').matches !== phone) return;
      if (popover.open) search?.focus();
      else open(true);
    });
  });

  function open(keyboard = false) {
    byKeyboard = keyboard;
    popover.show();
  }

  /** Closed from the keyboard, it gives the keys to the composer: the next thing typed is the prompt. */
  function close(refocus: boolean) {
    popover.hide();
    if (refocus && (selection || !focusComposer())) trigger?.focus({ preventScroll: true });
  }

  async function pick(id: string) {
    popover.hide();
    if (selection) {
      const row = groups.flatMap(group => group.rows).find(row => row.id === id);
      if (row?.tile) selection.onpick(row.machine.store, row.tile.project);
      trigger?.focus({ preventScroll: true });
      return;
    }
    if (id === OPEN_FOLDER) {
      store.projectPickerOpen = true;
      return;
    }
    const [machineId, projectId] = JSON.parse(id) as [string, ProjectId | null];
    const target = workspace.machines.find((m) => m.id === machineId)?.store ?? store;
    if (target === store) store.setDraftProject(projectId);
    else if (projectId !== null) await workspace.select(target, undefined, projectId);
    else await workspace.select(target).then(() => target.startDraft(null));
    // Another machine draws its own composer: the focus waits for it.
    await tick();
    focusComposer();
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (popover.open && event.key === 'Escape') {
      event.stopPropagation();
      popover.hide();
      return;
    }
    if (popover.open || event.key !== 'ArrowDown') return;
    event.preventDefault();
    open(true);
  }
</script>

<div class="choice">
  <button
    type="button"
    class="trigger"
    class:chip={!!selection}
    aria-haspopup="dialog"
    aria-expanded={popover.open}
    aria-label={label}
    title={label}
    data-testid={testid}
    bind:this={trigger}
    onclick={(event) => { event.stopPropagation(); if (popover.open) popover.hide(); else open(); }}
    onkeydown={onTriggerKeydown}
  >
    {@render children()}
  </button>

  <ProjectSearch
    bind:this={search}
    {popover}
    {testid}
    {label}
    {groups}
    {several}
    {byKeyboard}
    {footer}
    empty={selection?.empty}
    onpick={(id) => void pick(id)}
    onclose={close}
  />
</div>

<style>
  .choice {
    position: relative;
    display: inline-flex;
  }

  /* A word inside the heading: it takes the sentence's type and only fills under the pointer. */
  .trigger {
    cursor: pointer;
    gap: 6px;
  }

  .trigger:not(.chip) {
    height: auto;
    padding: 2px 6px;
    gap: 4px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    border-radius: var(--radius-md);
    transition: background var(--dur-2) var(--ease-out-quint);
  }

  .trigger:not(.chip):hover,
  .trigger:not(.chip)[aria-expanded='true'] {
    background: var(--color-hover);
  }
</style>
