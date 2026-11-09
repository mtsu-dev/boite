<script lang="ts">
  import { machineName, listedName, isThisPC, machineHealth, workspace } from '../lib/workspace.svelte';
  import { Monitor, TriangleAlert } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { Snippet } from 'svelte';
  import type { Store } from '../lib/store.svelte';
  import Menu from './Menu.svelte';
  import { separator, type MenuItem } from '../lib/menu';

  /**
   * The rail's machines button and its menu; the limits live at the foot of
   * the list column (QuotaLine.svelte). One
   * machine that is connected says nothing, so nothing is drawn; a second
   * machine, a filter or a connection in trouble brings back one icon, the
   * chosen machine's name beside it only while it filters the list. Its card
   * and its name say which machine it is and how it is: "Studio: Connected".
   * A remote machine that is merely switched off is grey in the menu and
   * raises no warning (`machineHealth`).
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
  // Off by choice or by sleep, not a fault: quiet, in the status grammar's grey, named in the tooltip and the name.
  const away = $derived(machines.filter(m => health.get(m) === 'offline'));
  const trouble = $derived(issues > 0 ? `${issues} ${strings.connection.issues}`
    : away.length > 0 ? away.map(m => fill(strings.connection.nameOffline, { name: machineName(m) })).join(', ') : null);
  const stateOf = (m: (typeof machines)[number]) => health.get(m) === 'offline' ? strings.connection.offline : strings.connection[m.store.connection];
  /** Each machine and its state, the chosen one alone while it filters: what the glyph means, in words. */
  const states = $derived((chosen ? [chosen] : machines).map(m => fill(strings.machines.state, { name: machineName(m), state: stateOf(m) })).join(', '));
  const note = $derived(issues > 0 ? `${trouble}. ${states}` : states);
  const label = $derived(`${name} · ${note}`);
  const items = $derived<MenuItem[]>([
    ...(machines.length > 1 ? [
      { id: 'all', label: strings.machines.all, checked: filter === null, radio: true },
      ...machines.map(m => ({ id: m.id, label: health.get(m) === 'offline' ? fill(strings.connection.nameOffline, { name: listedName(m) }) : listedName(m), status: { tone: tones[health.get(m)!], label: stateOf(m) }, checked: m.id === filter, radio: true })),
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
      <!-- The rail's optical size and stroke (the chat icon's), and one connection dot: green while this machine is connected, grey while one is away. -->
      {#if issues}<TriangleAlert size={19} />{:else}<Monitor size={19} />{#if away.length > 0}<span class="dot off" data-testid="machine-offline" aria-hidden="true"></span>{:else if store.connection === 'ready'}<span class="dot on" data-testid="machine-online" aria-hidden="true"></span>{/if}{/if}
      {#if chosen}<span class="name ui-label">{machineName(chosen)}</span>{/if}
    </Menu>
    {@render card?.(name, note)}
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
  .machines :global(.trigger) { position: relative; }
  /* On the screen's lower right corner (the glyph is 19 px in the middle of the button), cut out of the chrome:
     the phone header's dot (MobileNavigation.svelte), so a connection reads the same on both. */
  .dot { position: absolute; left: calc(50% + 5px); top: calc(50% - 1px); width: 7px; height: 7px; border-radius: var(--radius-full); box-shadow: 0 0 0 2px var(--color-frame); }
  .dot.on { background: var(--color-success); }
  .dot.off { background: var(--color-subtle); }
  .machines :global(.trigger:hover .dot) { box-shadow: 0 0 0 2px var(--color-hover); }
  .problem { color: var(--color-caution); }
  .problem :global(.trigger) { color: var(--color-caution); }
</style>
