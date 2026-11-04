import { threadBusy } from '@boite/contracts';
import { upkeepOf } from './agent-upkeep';
import { fill, strings } from './strings';
import type { Store } from './store.svelte';
import type { Surface, SurfaceKind } from './right-panel.svelte';
import { hiddenKind } from './surface-labels';

/**
 * The strip's own order: these surfaces always have a tab, open or not, so
 * the panel reads the same in every thread; the rest wait under More.
 */
export const PRIMARY: readonly SurfaceKind[] = ['changes', 'files', 'agent-browser', 'tasks', 'agents'];

/** A tab of the strip: an open surface, or a kind of `PRIMARY` not open yet. */
export type StripItem = { key: string; kind: SurfaceKind; surface?: Surface };

export function stripItems(surfaces: readonly Surface[], available: (kind: SurfaceKind) => boolean): StripItem[] {
  const items: StripItem[] = [];
  const placed = new Set<string>();
  for (const kind of PRIMARY) {
    const open = surfaces.find((surface) => surface.kind === kind);
    if (open) { items.push({ key: open.id, kind, surface: open }); placed.add(open.id); }
    else if (!hiddenKind(kind) && available(kind)) items.push({ key: `kind:${kind}`, kind });
  }
  for (const surface of surfaces) if (!placed.has(surface.id)) items.push({ key: surface.id, kind: surface.kind, surface });
  return items;
}

/**
 * The counts the strip's tabs carry while there is one: the working tree's
 * changed files on Changes, the subagents and workflow runs at work on Agents.
 * Built during a component's setup.
 */
export class PanelCounts {
  readonly #store: () => Store;
  #changes = $state<number | null>(null);

  /** Subagents and workflow runs at work for the open thread. */
  readonly atWork = $derived.by(() => {
    const store = this.#store();
    const thread = store.openThread;
    if (!thread) return 0;
    const agents = (store.delegation?.agents ?? []).filter((agent) => threadBusy(agent.thread) && !upkeepOf(store).has(agent.thread.id)).length;
    const native = (store.delegation?.nativeAgents ?? []).filter((agent) => agent.status === 'running').length;
    return agents + native + store.workflowsOf(thread.id).filter((run) => run.status === 'running').length;
  });

  constructor(store: () => Store) {
    this.#store = store;
    /**
     * The changed files, read again when a turn ends. Only a thread Boite knows
     * a branch for asks: a folder outside git would answer an error.
     */
    const key = $derived.by(() => {
      const thread = store().openThread;
      return thread?.branch ? `${thread.id}\n${thread.turns.at(-1)?.finishedAt ?? ''}` : '';
    });
    $effect(() => {
      const id = store().openThread?.id;
      if (!key || !id) { this.#changes = null; return; }
      let live = true;
      void store().gitStatus(id).then((answer) => { if (live) this.#changes = answer ? answer.changes.length : null; });
      return () => { live = false; };
    });
  }

  of(kind: SurfaceKind): { value: number; label: string } | null {
    const changes = this.#changes;
    if (kind === 'changes' && changes) return { value: changes, label: fill(strings.rightPanel.changesCount, { count: String(changes) }) };
    if (kind === 'agents' && this.atWork > 0) return { value: this.atWork, label: fill(strings.rightPanel.agentsCount, { count: String(this.atWork) }) };
    return null;
  }
}
