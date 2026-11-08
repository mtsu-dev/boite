<script lang="ts">
  import { machineName, listedName, isThisPC, machineHealth, workspace } from '../lib/workspace.svelte';
  import { Monitor, TriangleAlert } from '@lucide/svelte';
  import { strings } from '../lib/strings';
  import type { Snippet } from 'svelte';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import { separator, type MenuItem } from '../lib/menu';

  /**
   * The rail's machines button and its menu; the limits live at the foot of
   * the list column (QuotaLine.svelte). One
   * machine that is connected says nothing, so nothing is drawn; a second
   * machine, a filter or a connection in trouble brings back one icon, the
   * chosen machine's name beside it only while it filters the list. A remote
   * machine that is merely switched off is grey in the menu and raises no
   * warning (`machineHealth`).
   */
  let { store, filter = null, onfilter, testid = 'machine-status', card }: {
    store: Store; filter?: string | null; onfilter?: (id: string | null) => void; testid?: string;
    /** The rail's name card, drawn beside the button in place of the native tooltip: the name, then the trouble or the machine it filters on. */
    card?: Snippet<[string, string | null]>;
  } = $props();

  const machines = $derived([...workspace.machinesOr(store)]
    .sort((a, b) => Number(isThisPC(b)) - Number(isThisPC(a))));
  const health = $derived(new Map(machines.map(m => [m, machineHealth(m, store)])));
  const issues = $derived(machines.filter(m => health.get(m) === 'lost').length);
  const tones = { ready: 'success', connecting: 'warning', offline: 'neutral', lost: 'danger' } as const;
  const chosen = $derived(filter === null ? null : machines.find(m => m.id === filter) ?? null);
  const shown = $derived(machines.length > 1 || issues > 0 || chosen !== null);
  const name = strings.machines.filter;
  const trouble = $derived(issues > 0 ? `${issues} ${strings.connection.issues}` : null);
  const label = $derived(trouble ? `${name} · ${trouble}` : name);
  const items = $derived<MenuItem[]>([
    ...(machines.length > 1 ? [
      { id: 'all', label: strings.machines.all, checked: filter === null, radio: true },
      ...machines.map(m => ({ id: m.id, label: listedName(m), status: { tone: tones[health.get(m)!], label: health.get(m) === 'offline' ? strings.connection.offline : strings.connection[m.store.connection] }, checked: m.id === filter, radio: true })),
      separator('manage-separator')
    ] : []),
    { id: 'manage', label: strings.connection.manage, icon: 'settings' }
  ]);
  function choose(id: string) {
    if (id === 'manage') store.showSettings('machines');
    else onfilter?.(id === 'all' ? null : id);
  }
</script>

<!-- The wrapper stays, empty, so the connection state is always readable on it. -->
<div class="machines" class:problem={issues > 0} class:filtered={chosen !== null} data-testid={testid === 'machine-status' ? 'status-connection' : `${testid}-status`} data-state={store.connection} aria-live="polite">
  {#if shown}
    <Menu {items} onpick={choose} {label} variant="ghost" {testid} titled={!card}>
      {#if issues}<TriangleAlert size={16} />{:else}<Monitor size={16} />{/if}
      {#if chosen}<span class="name ui-label">{machineName(chosen)}</span>{/if}
    </Menu>
    {@render card?.(name, trouble ?? (chosen ? machineName(chosen) : null))}
  {/if}
</div>

<style>
  .machines { min-width: 0; color: var(--color-muted-foreground); }
  .machines :global(.trigger) { font-size: var(--text-xs); }
  /* A filter hides threads, so while one is on the button says which machine. */
  .filtered :global(.trigger) { width: auto; max-width: 160px; padding: 0 8px; gap: 6px; background: var(--color-active); color: var(--color-foreground); }
  /* min-width: a flex item never shrinks below its text otherwise, and a long
     name ran out of the button instead of ending in an ellipsis. */
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .problem { color: var(--color-live); }
  .problem :global(.trigger) { color: var(--color-live); }
</style>
