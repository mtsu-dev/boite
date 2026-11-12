<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ThreadId } from '@boite/contracts';
  import { Closing } from '../../lib/closing.svelte';
  import { projectName } from '../../lib/format';
  import type { ProjectGroup } from '../../lib/project-rows';
  import { strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { workspace } from '../../lib/workspace.svelte';
  import ProjectSearch from '../ProjectSearch.svelte';

  /**
   * The arrow beside a request's Accept: the app's search over this machine's
   * conversations and bots, to put the asking thread in touch with the one the
   * owner picks instead of the Operator's choice. `skip` leaves a thread out,
   * the Operator's own.
   */
  let { store, testid, label, skip, onpick, disabled = false, children }: {
    store: Store; testid: string; label: string; skip?: ThreadId; onpick: (threadId: ThreadId) => void; disabled?: boolean; children: Snippet;
  } = $props();
  const labels = $derived(strings.contacts.requests.pick);

  const popover = new Closing();
  let trigger = $state<HTMLButtonElement | undefined>(undefined);
  let byKeyboard = $state(false);
  const machine = $derived(workspace.machinesOr(store).find(entry => entry.store === store)!);

  /** Most recent first: the conversation the owner has in mind is likely one they just used. */
  const groups = $derived.by<ProjectGroup[]>(() => {
    const rows = store.threads
      .filter(thread => !thread.archived && !thread.incognito && !thread.parentThreadId && !thread.teamId && !thread.councilId && thread.id !== skip)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(thread => {
        const project = store.projects.find(entry => entry.id === thread.projectId) ?? null;
        const place = project ? projectName(project) : '';
        return {
          id: thread.id, label: thread.title, hint: place, title: thread.title, active: false,
          tile: project ? { project, store } : null, machine,
          fields: [{ text: thread.title }, ...(place ? [{ text: place, penalty: 5 }] : [])]
        };
      });
    return rows.length > 0 ? [{ id: machine.id, machine: null, rows }] : [];
  });

  function open(keyboard = false) {
    byKeyboard = keyboard;
    popover.show();
  }
  function close(refocus: boolean) {
    popover.hide();
    if (refocus) trigger?.focus({ preventScroll: true });
  }
  function onkeydown(event: KeyboardEvent) {
    if (popover.open && event.key === 'Escape') { event.stopPropagation(); popover.hide(); return; }
    if (popover.open || event.key !== 'ArrowDown') return;
    event.preventDefault();
    open(true);
  }
</script>

<span class="choice">
  <button type="button" class="arrow" {disabled} aria-haspopup="dialog" aria-expanded={popover.open} aria-label={label} title={label} data-testid={testid}
    bind:this={trigger} onclick={event => { event.stopPropagation(); if (popover.open) popover.hide(); else open(); }} {onkeydown}>
    {@render children()}
  </button>
  <ProjectSearch {popover} {testid} {label} {groups} several={false} {byKeyboard} empty={labels.empty} placeholder={labels.search} noMatch={labels.none}
    onpick={id => { popover.hide(); onpick(id as ThreadId); }} onclose={close} />
</span>

<style>
  .choice { position: relative; display: inline-flex; }
  .arrow { cursor: pointer; }
</style>
